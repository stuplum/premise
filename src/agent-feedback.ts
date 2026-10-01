import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAdvisory, AgentReport, AgentSessionInput } from "./agent-model.js";

export function renderAgentReport(report: AgentReport): string {
  return [
    `Premise: ${report.status}.`,
    ...report.blockers.map((blocker) =>
      `${blocker.kind}${blocker.id ? ` ${blocker.id}` : ""}${blocker.state ? ` (${blocker.state})` : ""}: ${blocker.message}${blocker.source ? ` [${blocker.source.uri}]` : ""}`,
    ),
    ...report.advisories.map((advisory) =>
      `ADVICE ${advisory.id} (${advisory.status}): ${advisory.message}${advisory.probability === undefined ? "" : ` [probability ${advisory.probability}]`}`,
    ),
    ...(report.advisories.length > 0
      ? ["Jev advice is not executable evidence or an approval requirement. Consider and communicate it; do not change code merely to obtain model approval."]
      : []),
    ...(report.instructions ? [report.instructions] : []),
  ].join("\n");
}

export function agentOrientation(input: AgentSessionInput): string {
  const cli = shellQuote(fileURLToPath(new URL("./cli.js", import.meta.url)));
  const prefix = `cd ${shellQuote(input.projectDirectory)} && node ${cli}`;
  return [
    "Premise tracks executable requirements, decision reviews, and immutable decision history for this session.",
    "Inspect relevant premises and decisions before changing an implementation. Reconsider stale decisions explicitly: reaffirm a still-valid decision with review, or add a replacement with Supersedes and review the replacement. Never rewrite or delete the original decision.",
    `Context: ${prefix} agent context '<artifact>' --session ${shellQuote(input.sessionId)}`,
    `Fresh completion check: ${prefix} agent stop --session ${shellQuote(input.sessionId)}`,
    `Record an intentional decision review: ${prefix} review '<decision-id>'`,
    "Completion checks rerun executable providers and block failed/unknown premises, stale reviews, changed history, and configuration/session errors. A previous pass is not evidence for later edits. Jev is optional advice only.",
    "This is a main-session completion workflow, not a security boundary. Subagents do not receive an independent completion guarantee; operator interruption and disabled/modified hooks can bypass the workflow.",
  ].join("\n");
}


export async function localArtifact({
  path,
  cwd,
  projectDirectory,
  readSelector = false,
}: {
  path: string;
  cwd: string;
  projectDirectory: string;
  readSelector?: boolean;
}): Promise<string | undefined> {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path) || path.includes("\0")) {
    return undefined;
  }
  let candidate = path;
  if (readSelector) {
    candidate = candidate.replace(/:(?:raw|img|conflicts|-?\d[\d,+-]*)(?::(?:raw|img|conflicts|-?\d[\d,+-]*))*$/, "");
    candidate = candidate.replace(/%3a/gi, ":").replace(/%3f/gi, "?").replace(/%23/gi, "#");
  }
  let absolute = resolve(cwd, candidate);
  try {
    if (!(await stat(absolute)).isFile()) {
      return undefined;
    }
    absolute = await realpath(absolute);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
    if (readSelector) {
      return undefined;
    }
  }
  const artifact = relative(projectDirectory, absolute);
  if (!artifact || artifact === ".." || artifact.startsWith(`..${sep}`) || isAbsolute(artifact)) {
    return undefined;
  }
  return artifact.split(sep).join("/");
}

export async function claimAdvisoryFeedback({
  input,
  advisories,
  canContinue,
  alreadyDelivered = false,
}: {
  input: AgentSessionInput;
  advisories: AgentAdvisory[];
  canContinue: boolean;
  alreadyDelivered?: boolean;
}): Promise<boolean> {
  if (advisories.length === 0) {
    return false;
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(
    advisories.map(({ id, status, message, probability, model }) => ({ id, status, message, probability, model }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  )).digest("hex");
  const directory = join(input.projectDirectory, ".premise", "agent-feedback");
  const path = join(directory, `${createHash("sha256").update(input.sessionId).digest("hex")}.json`);
  let previous: unknown;
  try {
    previous = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
  if (typeof previous === "object" && previous !== null && "fingerprint" in previous && previous.fingerprint === fingerprint) {
    return false;
  }
  if (!alreadyDelivered && !canContinue) {
    return false;
  }
  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify({ fingerprint })}\n`, "utf8");
  return !alreadyDelivered;
}

export function adapterError(error: unknown): string {
  return `Premise could not complete its workflow: ${error instanceof Error ? error.message : String(error)}. Resolve this error before claiming verification.`;
}


function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
