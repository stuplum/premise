import { readFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { glob } from "glob";
import type { DecisionAst, DecisionDriver } from "./decision-model.js";
import { parseDecision } from "./decision-parser.js";
import { calculateFingerprint } from "./fingerprint.js";
import { discoverPremises } from "./provider.js";
import { createDefaultProviders } from "./providers/default-providers.js";

type KnowledgeSource = {
  content: string;
  id: string;
  kind: string;
  uri: string;
};

type DecisionSource = {
  content: string;
  decision: DecisionAst;
  uri: string;
};

type DriverReview = {
  fingerprint: string;
  id: string;
  kind: string;
  uri: string;
};

type DecisionReview = {
  decision: {
    fingerprint: string;
    id: string;
    uri: string;
  };
  drivers: DriverReview[];
  version: 1;
};

export type DecisionRequiringReview = {
  decision: DecisionSource;
  drivers: KnowledgeSource[];
};

export async function findDecisionsRequiringReview({
  projectDirectory,
}: {
  projectDirectory: string;
}): Promise<DecisionRequiringReview[]> {
  const knowledge = await loadDecisionKnowledge({ projectDirectory });
  const activeDecisions = findActiveDecisions(knowledge.decisions);
  const results = await Promise.all(
    activeDecisions.map(async (decision) => {
      const drivers = await resolveDrivers({
        decision,
        knowledge,
        projectDirectory,
      });
      const review = await readReview({
        decisionId: decision.decision.id,
        projectDirectory,
      });

      if (reviewMatches({ decision, drivers, review })) {
        return undefined;
      }

      return { decision, drivers };
    }),
  );

  return results
    .filter((result): result is DecisionRequiringReview => Boolean(result))
    .sort((left, right) =>
      left.decision.decision.id.localeCompare(right.decision.decision.id),
    );
}

export async function reviewDecision({
  decisionId,
  projectDirectory,
}: {
  decisionId: string;
  projectDirectory: string;
}): Promise<void> {
  const knowledge = await loadDecisionKnowledge({ projectDirectory });
  const decision = knowledge.decisions.find(
    ({ decision: candidate }) => candidate.id === decisionId,
  );
  if (!decision) {
    throw new Error(`Unknown decision ${decisionId}`);
  }

  const activeDecisionIds = new Set(
    findActiveDecisions(knowledge.decisions).map(({ decision }) => decision.id),
  );
  if (!activeDecisionIds.has(decisionId)) {
    throw new Error(`Decision ${decisionId} has been superseded`);
  }

  const drivers = await resolveDrivers({
    decision,
    knowledge,
    projectDirectory,
  });
  const review = createReview({ decision, drivers });
  const directory = join(projectDirectory, ".premise/reviews");
  await mkdir(directory, { recursive: true });
  await writeFile(
    reviewPath({ decisionId, projectDirectory }),
    `${JSON.stringify(review, null, 2)}\n`,
    "utf8",
  );
}

async function loadDecisionKnowledge({
  projectDirectory,
}: {
  projectDirectory: string;
}) {
  const [decisions, premises] = await Promise.all([
    discoverDecisions({ projectDirectory }),
    discoverPremiseSources({ projectDirectory }),
  ]);
  validateSupersessions(decisions);
  return { decisions, premises };
}

async function discoverDecisions({
  projectDirectory,
}: {
  projectDirectory: string;
}): Promise<DecisionSource[]> {
  const uris = await glob("**/*.decision", {
    cwd: projectDirectory,
    ignore: [".git/**", ".premise/**", "node_modules/**"],
    nodir: true,
  });
  const decisions = await Promise.all(
    uris.sort().map(async (uri) => {
      const content = await readFile(join(projectDirectory, uri), "utf8");
      return { content, decision: parseDecision(content), uri };
    }),
  );
  requireUniqueIds({
    entries: decisions.map(({ decision, uri }) => ({ id: decision.id, uri })),
    kind: "decision",
  });
  return decisions;
}

async function discoverPremiseSources({
  projectDirectory,
}: {
  projectDirectory: string;
}): Promise<KnowledgeSource[]> {
  const discoveries = await discoverPremises({
    projectDirectory,
    providers: createDefaultProviders({ silentCucumber: true }),
  });
  return Promise.all(
    discoveries.map(async ({ premise }) => ({
      content: await readFile(
        await resolveProjectSource({
          projectDirectory,
          source: premise.assertion.ref.uri,
        }),
        "utf8",
      ),
      id: premise.id,
      kind: "premise",
      uri: premise.assertion.ref.uri,
    })),
  );
}

async function resolveDrivers({
  decision,
  knowledge,
  projectDirectory,
}: {
  decision: DecisionSource;
  knowledge: {
    decisions: DecisionSource[];
    premises: KnowledgeSource[];
  };
  projectDirectory: string;
}): Promise<KnowledgeSource[]> {
  return Promise.all(
    decision.decision.drivers.map(async (driver) => {
      try {
        return await resolveDriver({ driver, knowledge, projectDirectory });
      } catch (error) {
        if (driver.kind === "premise" && isUnknownReference(error)) {
          throw new Error(
            `Decision ${decision.decision.id} in ${decision.uri} references unknown premise ${driver.id}`,
          );
        }
        throw error;
      }
    }),
  );
}

async function resolveDriver({
  driver,
  knowledge,
  projectDirectory,
}: {
  driver: DecisionDriver;
  knowledge: {
    decisions: DecisionSource[];
    premises: KnowledgeSource[];
  };
  projectDirectory: string;
}): Promise<KnowledgeSource> {
  if (driver.kind === "premise") {
    const premise = knowledge.premises.find(({ id }) => id === driver.id);
    if (!premise) {
      throw new Error(`Unknown premise ${driver.id}`);
    }
    return premise;
  }

  if (driver.kind === "decision") {
    const source = knowledge.decisions.find(
      ({ decision }) => decision.id === driver.id,
    );
    if (!source) {
      throw new Error(`Unknown decision ${driver.id}`);
    }
    return {
      content: source.content,
      id: source.decision.id,
      kind: "decision",
      uri: source.uri,
    };
  }

  if (driver.kind === "source") {
    const path = await resolveProjectSource({
      projectDirectory,
      source: driver.id,
    });
    return {
      content: await readFile(path, "utf8"),
      id: driver.id,
      kind: "source",
      uri: driver.id,
    };
  }

  throw new Error(`Unsupported decision driver ${driver.kind} ${driver.id}`);
}

async function resolveProjectSource({
  projectDirectory,
  source,
}: {
  projectDirectory: string;
  source: string;
}) {
  try {
    const directory = await realpath(projectDirectory);
    const path = await realpath(resolve(directory, source));
    const relativePath = relative(directory, path);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error(`${source} must be inside the project`);
    }
    return path;
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("must be inside the project")) {
      throw error;
    }
    throw new Error(`Cannot resolve source ${source}`);
  }
}

function validateSupersessions(decisions: DecisionSource[]): void {
  const byId = new Map(decisions.map((source) => [source.decision.id, source]));
  const successors = new Map<string, string>();

  for (const { decision } of decisions) {
    const supersededId = decision.supersedes?.id;
    if (!supersededId) {
      continue;
    }
    if (!byId.has(supersededId)) {
      throw new Error(
        `Decision ${decision.id} supersedes unknown decision ${supersededId}`,
      );
    }
    const existing = successors.get(supersededId);
    if (existing) {
      throw new Error(
        `Decision ${supersededId} is superseded by both ${existing} and ${decision.id}`,
      );
    }
    successors.set(supersededId, decision.id);
  }

  for (const id of byId.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      if (visited.has(current)) {
        throw new Error(`Decision supersession cycle includes ${current}`);
      }
      visited.add(current);
      current = successors.get(current);
    }
  }
}

function findActiveDecisions(decisions: DecisionSource[]): DecisionSource[] {
  const supersededIds = new Set(
    decisions
      .map(({ decision }) => decision.supersedes?.id)
      .filter((id): id is string => Boolean(id)),
  );
  return decisions.filter(({ decision }) => !supersededIds.has(decision.id));
}

function createReview({
  decision,
  drivers,
}: {
  decision: DecisionSource;
  drivers: KnowledgeSource[];
}): DecisionReview {
  return {
    decision: {
      fingerprint: calculateFingerprint(decision.content),
      id: decision.decision.id,
      uri: decision.uri,
    },
    drivers: drivers.map(({ content, id, kind, uri }) => ({
      fingerprint: calculateFingerprint(content),
      id,
      kind,
      uri,
    })),
    version: 1,
  };
}

function reviewMatches({
  decision,
  drivers,
  review,
}: {
  decision: DecisionSource;
  drivers: KnowledgeSource[];
  review: DecisionReview | undefined;
}) {
  if (!review) {
    return false;
  }
  const current = createReview({ decision, drivers });
  return JSON.stringify(current) === JSON.stringify(review);
}

async function readReview({
  decisionId,
  projectDirectory,
}: {
  decisionId: string;
  projectDirectory: string;
}): Promise<DecisionReview | undefined> {
  const path = reviewPath({ decisionId, projectDirectory });
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }

  try {
    const value: unknown = JSON.parse(content);
    if (!isDecisionReview(value, decisionId)) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error(`Invalid decision review receipt: ${relative(projectDirectory, path)}`);
  }
}

function isDecisionReview(
  value: unknown,
  decisionId: string,
): value is DecisionReview {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.decision)) {
    return false;
  }
  if (
    value.decision.id !== decisionId ||
    typeof value.decision.uri !== "string" ||
    !isFingerprint(value.decision.fingerprint) ||
    !Array.isArray(value.drivers)
  ) {
    return false;
  }
  return value.drivers.every(
    (driver) =>
      isRecord(driver) &&
      typeof driver.id === "string" &&
      typeof driver.kind === "string" &&
      typeof driver.uri === "string" &&
      isFingerprint(driver.fingerprint),
  );
}

function reviewPath({
  decisionId,
  projectDirectory,
}: {
  decisionId: string;
  projectDirectory: string;
}) {
  return join(
    projectDirectory,
    ".premise/reviews",
    `${encodeURIComponent(decisionId)}.json`,
  );
}

function requireUniqueIds({
  entries,
  kind,
}: {
  entries: Array<{ id: string; uri: string }>;
  kind: string;
}): void {
  const sources = new Map<string, string>();
  for (const { id, uri } of entries) {
    const existing = sources.get(id);
    if (existing && existing !== uri) {
      throw new Error(`Duplicate ${kind} ID ${id}: ${existing}, ${uri}`);
    }
    sources.set(id, uri);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isUnknownReference(error: unknown) {
  return error instanceof Error && error.message.startsWith("Unknown ");
}
