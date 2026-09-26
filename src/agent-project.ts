import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentSessionInput } from "./agent-model.js";

export async function resolveAgentProject(cwd: string): Promise<string> {
  const original = await realpath(cwd);
  let directory = original;
  while (true) {
    if (await exists(join(directory, "premise.json")) || await exists(join(directory, ".premise"))) {
      return directory;
    }
    if (await exists(join(directory, ".git"))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return original;
    }
    directory = parent;
  }
}

export function agentSessionUri(sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex");
  return `.premise/agent-sessions/${key}.json`;
}

export async function agentSessionEnabled({ projectDirectory, sessionId }: AgentSessionInput): Promise<boolean> {
  return await exists(join(projectDirectory, "premise.json")) ||
    await exists(join(projectDirectory, agentSessionUri(sessionId)));
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
