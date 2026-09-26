import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { glob } from "glob";
import type { AgentSessionInput } from "./agent-model.js";
import { agentSessionUri } from "./agent-project.js";
import { parseDecision } from "./decision-parser.js";

export type AgentSession = AgentSessionInput & {
  version: 1;
  decisions: Array<{ content: string; id: string; uri: string }>;
};

export async function resolveAgentSessionInput({
  projectDirectory,
  sessionId,
}: AgentSessionInput): Promise<AgentSessionInput> {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new Error("A nonempty agent session ID is required");
  }
  return { projectDirectory: await realpath(projectDirectory), sessionId };
}


export async function readSessionDecision({
  projectDirectory,
  uri,
}: {
  projectDirectory: string;
  uri: string;
}): Promise<string> {
  const path = await resolveSessionPath(projectDirectory, join(projectDirectory, uri));
  return readFile(path, "utf8");
}

export async function readAgentSession(
  input: AgentSessionInput,
): Promise<AgentSession | undefined> {
  const uri = agentSessionUri(input.sessionId);
  let content: string;
  try {
    const path = await resolveSessionPath(input.projectDirectory, join(input.projectDirectory, uri));
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Cannot read agent session ${uri}: ${errorMessage(error)}`);
  }
  try {
    const session: unknown = JSON.parse(content);
    if (!isAgentSession(session, input)) {
      throw new Error("Invalid session identity or decision snapshot");
    }
    return session;
  } catch (error) {
    throw new Error(`Invalid agent session ${uri}: ${errorMessage(error)}. Restore the original session snapshot; do not replace it with the current decision history.`);
  }
}

export async function createAgentSession(
  input: AgentSessionInput,
): Promise<AgentSession> {
  const uris = await glob("**/*.decision", {
    cwd: input.projectDirectory,
    ignore: [".git/**", ".premise/**", "node_modules/**"],
    nodir: true,
  });
  const decisions: AgentSession["decisions"] = [];
  const ids = new Set<string>();
  for (const uri of uris.sort()) {
    try {
      const content = await readSessionDecision({ projectDirectory: input.projectDirectory, uri });
      const { id } = parseDecision(content);
      if (ids.has(id)) {
        throw new Error(`Duplicate decision ID ${id}`);
      }
      ids.add(id);
      decisions.push({ content, id, uri });
    } catch (error) {
      throw new Error(`Cannot snapshot decision ${uri}: ${errorMessage(error)}. Repair the decision source before starting the session.`);
    }
  }
  const session: AgentSession = { ...input, decisions, version: 1 };
  const destination = join(input.projectDirectory, agentSessionUri(input.sessionId));
  const stateDirectory = join(input.projectDirectory, ".premise");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await resolveSessionPath(input.projectDirectory, stateDirectory);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await resolveSessionPath(input.projectDirectory, dirname(destination));
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(`${JSON.stringify(session, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, destination);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }
  } finally {
    await unlink(temporary);
  }
  const saved = await readAgentSession(input);
  if (!saved) {
    throw new Error("Agent session disappeared while it was being created");
  }
  return saved;
}

function isAgentSession(
  value: unknown,
  input: AgentSessionInput,
): value is AgentSession {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("projectDirectory" in value) ||
    value.projectDirectory !== input.projectDirectory ||
    !("sessionId" in value) ||
    value.sessionId !== input.sessionId ||
    !("decisions" in value) ||
    !Array.isArray(value.decisions)
  ) {
    return false;
  }
  const uris = new Set<string>();
  const ids = new Set<string>();
  for (const decision of value.decisions) {
    if (
      typeof decision !== "object" ||
      decision === null ||
      !("content" in decision) ||
      typeof decision.content !== "string" ||
      !("id" in decision) ||
      typeof decision.id !== "string" ||
      !("uri" in decision) ||
      typeof decision.uri !== "string" ||
      !decision.uri.endsWith(".decision") ||
      isAbsolute(decision.uri) ||
      decision.uri.includes("\\") ||
      decision.uri.split("/").some((part: string) => part === "" || part === "." || part === "..") ||
      uris.has(decision.uri) ||
      ids.has(decision.id) ||
      parseDecision(decision.content).id !== decision.id
    ) {
      return false;
    }
    uris.add(decision.uri);
    ids.add(decision.id);
  }
  return true;
}

async function resolveSessionPath(projectDirectory: string, path: string): Promise<string> {
  const resolved = await realpath(path);
  const local = relative(projectDirectory, resolved);
  if (local === "" || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`${path} must remain inside the project, including symbolic links`);
  }
  return resolved;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
