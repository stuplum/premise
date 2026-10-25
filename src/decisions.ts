import { readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { glob } from "glob";
import { CONFIG_FILE } from "./config.js";
import { ConfigurationError } from "./errors.js";
import type { CheckLink, Config, Decision, DecisionStatus, SignoffMode } from "./model.js";
import { parseYaml, validateAgainst } from "./schema.js";
import { compareText } from "./text.js";

type DecisionDocument = {
  id: string;
  title: string;
  status: DecisionStatus;
  date: string;
  context: string;
  options: { name: string; pros?: string[]; cons?: string[] }[];
  decision: string;
  because: string[];
  consequences: string[];
  scope?: string[];
  supported_by?: CheckLink[];
  enforced_by?: CheckLink[];
  signoff?: SignoffMode;
  supersedes?: string;
};

export async function loadDecisions({
  projectDirectory,
  config,
}: {
  projectDirectory: string;
  config: Config;
}): Promise<Decision[]> {
  await requireDecisionsDirectory({ projectDirectory, config });
  const names = await glob("*.yaml", { cwd: join(projectDirectory, config.decisions), nodir: true, posix: true });
  const decisions: Decision[] = [];
  for (const name of names.sort(compareText)) {
    decisions.push(await readDecision({ projectDirectory, uri: posix.join(config.decisions, name), config }));
  }
  await requireConsistentDecisions({ projectDirectory, decisions, config });
  return decisions.sort((left, right) => compareText(left.id, right.id));
}

async function requireDecisionsDirectory({ projectDirectory, config }: { projectDirectory: string; config: Config }): Promise<void> {
  const exists = await stat(join(projectDirectory, config.decisions)).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
  if (!exists) {
    throw new ConfigurationError(`${CONFIG_FILE}: decisions directory ${config.decisions} does not exist`);
  }
}

async function readDecision({
  projectDirectory,
  uri,
  config,
}: {
  projectDirectory: string;
  uri: string;
  config: Config;
}): Promise<Decision> {
  const document = parseYaml({ content: await readFile(join(projectDirectory, uri), "utf8"), uri });
  validateAgainst({ schema: "decision", value: document, uri });
  const decision = document as DecisionDocument;
  if (posix.basename(uri) !== `${decision.id}.yaml`) {
    throw new ConfigurationError(`${uri}: file must be named ${decision.id}.yaml`);
  }
  return {
    id: decision.id,
    title: decision.title,
    status: decision.status,
    date: decision.date,
    context: decision.context,
    options: decision.options.map((option) => ({
      name: option.name,
      pros: option.pros ?? [],
      cons: option.cons ?? [],
    })),
    decision: decision.decision,
    because: decision.because,
    consequences: decision.consequences,
    scope: decision.scope ?? [],
    supportedBy: linksOf(decision.supported_by),
    enforcedBy: linksOf(decision.enforced_by),
    signoff: decision.signoff ?? config.signoff.default,
    supersedes: decision.supersedes,
    uri,
  };
}

function linksOf(links: CheckLink[] = []): CheckLink[] {
  return links.map((link) => (link.fingerprint === undefined ? { check: link.check } : { check: link.check, fingerprint: link.fingerprint }));
}

async function requireConsistentDecisions({
  projectDirectory,
  decisions,
  config,
}: {
  projectDirectory: string;
  decisions: Decision[];
  config: Config;
}): Promise<void> {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const problems: string[] = [];
  for (const decision of decisions) {
    if (!decision.options.some((option) => option.name === decision.decision)) {
      problems.push(`${decision.uri}: decision "${decision.decision}" is not one of the options`);
    }
    if (!config.signoff.allowed.includes(decision.signoff)) {
      problems.push(`${decision.uri}: signoff ${decision.signoff} is not allowed by ${CONFIG_FILE}`);
    }
    if (decision.supersedes !== undefined) {
      const superseded = byId.get(decision.supersedes);
      if (!superseded) {
        problems.push(`${decision.uri}: supersedes ${decision.supersedes}, which does not exist`);
      } else if (superseded.status !== "superseded") {
        problems.push(`${decision.uri}: supersedes ${decision.supersedes}, which is not marked superseded`);
      }
    }
    if (decision.status === "superseded") {
      const successors = decisions.filter((other) => other.supersedes === decision.id).length;
      if (successors !== 1) {
        problems.push(`${decision.uri}: is superseded but is named by ${successors} supersedes`);
      }
    }
    for (const [field, links] of [
      ["supported_by", decision.supportedBy],
      ["enforced_by", decision.enforcedBy],
    ] as const) {
      const seen = new Set<string>();
      for (const link of links) {
        if (seen.has(link.check)) {
          problems.push(`${decision.uri}: ${field} links ${link.check} more than once`);
        }
        seen.add(link.check);
      }
    }
    for (const pattern of decision.scope) {
      const matches = await glob(pattern, {
        cwd: projectDirectory,
        nodir: true,
        dot: true,
        ignore: ["node_modules/**", ".git/**"],
      });
      if (matches.length === 0) {
        problems.push(`${decision.uri}: scope ${pattern} matches no files`);
      }
    }
  }
  if (problems.length > 0) {
    throw new ConfigurationError(problems.join("\n"));
  }
}
