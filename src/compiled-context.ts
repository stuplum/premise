import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import type {
  Evidence,
  Premise,
  PremiseEvaluation,
} from "./provider.js";

export type CompiledPremise = Premise & {
  evidence: Evidence[];
  provider: string;
};

export type ArtifactContext = {
  artifact: string;
  premises: CompiledPremise[];
  version: 2;
};

const compiledDirectory = ".premise/compiled";

export async function compilePremiseEvaluations({
  evaluations,
  projectDirectory,
}: {
  evaluations: PremiseEvaluation[];
  projectDirectory: string;
}) {
  const contexts = new Map<string, Map<string, CompiledPremise>>();

  for (const { premise, provider, result } of evaluations) {
    if (result.status !== "established") {
      continue;
    }
    const evidence = (result.evidence ?? []).map((item) =>
      item.role === "assertion"
        ? item
        : {
            ...item,
            uri: normalizeCompiledArtifact({
              projectDirectory,
              uri: item.uri,
            }),
          },
    );
    const compiledPremise: CompiledPremise = {
      ...premise,
      evidence,
      provider,
    };

    for (const item of evidence.filter(({ role }) => role !== "assertion")) {
      const artifact = normalizeCompiledArtifact({
        projectDirectory,
        uri: item.uri,
      });
      const artifactPremises = contexts.get(artifact) ?? new Map();
      artifactPremises.set(premise.id, compiledPremise);
      contexts.set(artifact, artifactPremises);
    }
  }

  const directory = resolveProjectPath({
    projectDirectory,
    relativePath: compiledDirectory,
  });
  await rm(directory, { force: true, recursive: true });

  await Promise.all(
    [...contexts.entries()].map(async ([artifact, premises]) => {
      const path = join(directory, `${artifact}.json`);
      const context: ArtifactContext = {
        artifact,
        premises: [...premises.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        version: 2,
      };
      await writeContext({ context, path });
    }),
  );
}

export async function readArtifactContext({
  artifact,
  projectDirectory,
}: {
  artifact: string;
  projectDirectory: string;
}): Promise<ArtifactContext | undefined> {
  const relativeArtifact = await normalizeArtifactPath({
    artifact,
    projectDirectory,
  });
  return readContext({
    artifact: relativeArtifact,
    projectDirectory,
  });
}

export async function readArtifactSources({
  artifact,
  projectDirectory,
}: {
  artifact: string;
  projectDirectory: string;
}) {
  const context = await readArtifactContext({ artifact, projectDirectory });
  if (!context) {
    return [];
  }
  const sources = [
    ...new Set(
      context.premises.map(({ assertion }) => assertion.ref.uri),
    ),
  ].sort();
  return Promise.all(
    sources.map(async (source) => ({
      content: await readPremiseSource({ projectDirectory, source }),
      source,
    })),
  );
}

async function readPremiseSource({
  projectDirectory,
  source,
}: {
  projectDirectory: string;
  source: string;
}) {
  try {
    return await readFile(
      resolveProjectPath({ projectDirectory, relativePath: source }),
      "utf8",
    );
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(
        `Premise source ${source} no longer exists. Run premise test.`,
      );
    }
    throw error;
  }
}

async function readContext({
  artifact,
  projectDirectory,
}: {
  artifact: string;
  projectDirectory: string;
}) {
  const path = resolveProjectPath({
    projectDirectory,
    relativePath: `${compiledDirectory}/${artifact}.json`,
  });

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }

  return parseArtifactContext({
    content,
    expectedArtifact: artifact,
    path,
  });
}

async function writeContext({
  context,
  path,
}: {
  context: ArtifactContext;
  path: string;
}) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(context, null, 2)}\n`, "utf8");
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function resolveProjectPath({
  projectDirectory,
  relativePath,
}: {
  projectDirectory: string;
  relativePath: string;
}) {
  const directory = resolve(projectDirectory);
  const path = resolve(directory, relativePath);

  if (relative(directory, path).startsWith("..")) {
    throw new Error(`${relativePath} must be inside the project`);
  }

  return path;
}

function normalizeCompiledArtifact({
  projectDirectory,
  uri,
}: {
  projectDirectory: string;
  uri: string;
}) {
  const directory = resolve(projectDirectory);
  const path = resolveProjectPath({ projectDirectory, relativePath: uri });
  const artifact = relative(directory, path);
  if (artifact === "" || isAbsolute(artifact)) {
    throw new Error(`${uri} must identify an artifact inside the project`);
  }
  return normalizePath(artifact);
}

function normalizePath(path: string) {
  return path.split("\\").join("/");
}

async function normalizeArtifactPath({
  artifact,
  projectDirectory,
}: {
  artifact: string;
  projectDirectory: string;
}) {
  const directory = await realpath(projectDirectory);
  let artifactPath = resolve(directory, artifact);
  try {
    artifactPath = await realpath(artifactPath);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
  const relativeArtifact = relative(directory, artifactPath);

  if (
    relativeArtifact === "" ||
    relativeArtifact.startsWith("..") ||
    isAbsolute(relativeArtifact)
  ) {
    throw new Error(`${artifact} must be inside the project`);
  }

  return normalizePath(relativeArtifact);
}

function parseArtifactContext({
  content,
  expectedArtifact,
  path,
}: {
  content: string;
  expectedArtifact: string;
  path: string;
}): ArtifactContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw invalidCompiledContext(path);
  }

  if (isRecord(parsed) && parsed.version === 1) {
    throw new Error(
      `Compiled context version 1 is no longer supported: ${path}. Run premise test to regenerate it.`,
    );
  }

  if (
    !isRecord(parsed) ||
    !hasOnlyKeys({ keys: ["artifact", "premises", "version"], value: parsed }) ||
    parsed.version !== 2 ||
    parsed.artifact !== expectedArtifact ||
    !Array.isArray(parsed.premises) ||
    parsed.premises.length === 0
  ) {
    throw invalidCompiledContext(path);
  }

  const premiseIds = new Set<string>();
  for (const premise of parsed.premises) {
    if (
      !isCompiledPremise(premise, expectedArtifact) ||
      premiseIds.has(premise.id)
    ) {
      throw invalidCompiledContext(path);
    }
    premiseIds.add(premise.id);
  }

  return parsed as ArtifactContext;
}

function isCompiledPremise(
  premise: unknown,
  expectedArtifact: string,
): premise is CompiledPremise {
  return (
    isRecord(premise) &&
    hasOnlyKeys({
      keys: ["assertion", "description", "evidence", "id", "provider", "type"],
      value: premise,
    }) &&
    isNonEmptyString(premise.id) &&
    isNonEmptyString(premise.description) &&
    isNonEmptyString(premise.type) &&
    isNonEmptyString(premise.provider) &&
    isAssertion(premise.assertion) &&
    Array.isArray(premise.evidence) &&
    premise.evidence.length > 0 &&
    premise.evidence.every(isEvidence) &&
    premise.evidence.some(
      ({ role, uri }) => role !== "assertion" && uri === expectedArtifact,
    )
  );
}

function isAssertion(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys({ keys: ["dialect", "ref"], value }) &&
    isNonEmptyString(value.dialect) &&
    isRecord(value.ref) &&
    hasOnlyKeys({ keys: ["selector", "uri"], value: value.ref }) &&
    isNonEmptyString(value.ref.uri) &&
    (value.ref.selector === undefined || isNonEmptyString(value.ref.selector))
  );
}

function isEvidence(value: unknown): value is Evidence {
  return (
    isRecord(value) &&
    hasOnlyKeys({ keys: ["range", "role", "uri"], value }) &&
    isNonEmptyString(value.uri) &&
    (value.role === undefined || isNonEmptyString(value.role)) &&
    (value.range === undefined || isSourceRange(value.range))
  );
}

function isSourceRange(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys({ keys: ["end", "start"], value }) &&
    isSourcePosition(value.start) &&
    isSourcePosition(value.end)
  );
}

function isSourcePosition(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys({ keys: ["column", "line"], value }) &&
    Number.isInteger(value.column) &&
    Number(value.column) > 0 &&
    Number.isInteger(value.line) &&
    Number(value.line) > 0
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasOnlyKeys({
  keys,
  value,
}: {
  keys: string[];
  value: Record<string, unknown>;
}) {
  const allowedKeys = new Set(keys);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidCompiledContext(path: string) {
  return new Error(`Invalid compiled context: ${path}`);
}
