import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { agentSessionEnabled, resolveHookProject } from "../agent-project.js";

type HookHost = "codex" | "claude";

const hosts: Record<HookHost, { label: string; adapter: string; timeoutEnv: string }> = {
  codex: { label: "Codex", adapter: "dist/adapters/codex.js", timeoutEnv: "PREMISE_CODEX_TIMEOUT_MS" },
  claude: { label: "Claude Code", adapter: "dist/adapters/claude.js", timeoutEnv: "PREMISE_CLAUDE_TIMEOUT_MS" },
};

async function readInput(label: string): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  const timer = setTimeout(() => process.stdin.destroy(new Error(`Timed out reading ${label} hook input`)), 5_000);
  try {
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 1024 * 1024) {
        throw new Error(`${label} hook input exceeds 1 MiB`);
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

async function launch(host: HookHost): Promise<void> {
  const { label, adapter, timeoutEnv } = hosts[host];
  const raw = await readInput(label);
  const input = JSON.parse(raw);
  const event = process.argv[2];
  if (!input || typeof input.cwd !== "string" || !isAbsolute(input.cwd) ||
      typeof input.session_id !== "string" || !input.session_id.trim() ||
      !["SessionStart", "PreToolUse", "Stop"].includes(event ?? "") || input.hook_event_name !== event) {
    throw new Error(`Invalid ${label} hook identity or working directory`);
  }
  const projectDirectory = await resolveHookProject({ host, cwd: input.cwd });
  let packagePath: string;
  try {
    packagePath = createRequire(join(projectDirectory, "package.json")).resolve("@stuplum/premise/package.json");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND")) {
      throw error;
    }
    if (!await agentSessionEnabled({ projectDirectory, sessionId: input.session_id })) {
      process.stdout.write("{}\n");
      return;
    }
    throw new Error(`Install @stuplum/premise in ${projectDirectory} before using the Premise hooks`);
  }
  const timeoutMs = Number(process.env[timeoutEnv] ?? 550_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 550_000) {
    throw new Error(`${timeoutEnv} must be an integer from 1 to 550000, below the bundled hook's 600-second deadline`);
  }
  const child = spawn(process.execPath, [join(dirname(packagePath), adapter), event!], {
    cwd: projectDirectory,
    detached: process.platform !== "win32",
    stdio: ["pipe", "inherit", "inherit"],
  });
  let timedOut = false;
  const terminate = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        child.kill(signal);
      }
    }
  };
  const interrupted = () => terminate("SIGTERM");
  const timer = setTimeout(() => {
    timedOut = true;
    terminate("SIGKILL");
  }, timeoutMs);
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
      child.stdin.on("error", reject);
      child.stdin.end(raw);
    });
    if (timedOut) {
      throw new Error(`Premise hook timed out after ${timeoutMs} ms. Verification was not established; investigate the slow check before claiming completion.`);
    }
    if (code !== 0) {
      throw new Error(`Installed Premise hook did not complete successfully (${code ?? "signal"})`);
    }
  } finally {
    clearTimeout(timer);
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    terminate("SIGKILL");
  }
}

export async function launchHook(host: HookHost): Promise<void> {
  try {
    await launch(host);
  } catch (error) {
    process.stderr.write(`Premise hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
