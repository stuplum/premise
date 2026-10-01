import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AgentReport, AgentSessionInput } from "../agent-model.js";
import { agentSessionEnabled } from "../agent-project.js";
import {
  createRepositorySnapshot,
  type RepositorySnapshot,
} from "../repository-snapshot.js";

export type OmpCheckedReport = {
  report: AgentReport;
  fingerprint?: string;
  snapshot?: RepositorySnapshot;
};

export async function runOmpCommand(input: AgentSessionInput, arguments_: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const child = spawn(process.versions.bun ? "node" : process.execPath, [fileURLToPath(new URL("../cli.js", import.meta.url)), ...arguments_], {
    cwd: input.projectDirectory,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let diagnostics = "";
  let failure: Error | undefined;
  let termination: Promise<void> | undefined;
  const terminate = () => {
    if (termination || !child.pid) {
      return;
    }
    if (process.platform === "win32") {
      termination = new Promise<void>((resolve, reject) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        killer.once("error", reject);
        killer.once("exit", () => resolve());
      });
      void termination.catch(() => child.kill("SIGKILL"));
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
        termination = Promise.resolve();
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
          failure = new Error(`Cannot terminate the Premise evaluator: ${String(error)}`);
          child.kill("SIGKILL");
        }
      }
    }
  };
  const abort = () => {
    failure = new Error("Premise evaluation was interrupted; retry completion to run a fresh check");
    terminate();
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (output.length + chunk.length > 8 * 1024 * 1024) {
      failure = new Error("Premise evaluator output exceeded 8 MiB; reduce provider output and retry");
      terminate();
    } else {
      output += chunk;
    }
  });
  child.stderr.on("data", (chunk: string) => {
    diagnostics = (diagnostics + chunk).slice(-16 * 1024);
  });
  signal.addEventListener("abort", abort, { once: true });
  try {
    const closed = new Promise<void>((resolve, reject) => {
      child.once("error", (error) => reject(new Error(`Cannot start the Premise evaluator: ${error.message}. Ensure Node.js 20 or newer and the installed Premise CLI are available.`)));
      child.once("close", (code, killedBy) => {
        if (failure) {
          reject(failure);
        } else if (code !== 0) {
          reject(new Error(`Premise evaluator exited ${killedBy ? `on ${killedBy}` : `with code ${code}`}${diagnostics.trim() ? `: ${diagnostics.trim()}` : ""}`));
        } else {
          resolve();
        }
      });
    });
    if (signal.aborted) {
      abort();
    }
    await closed;
    signal.throwIfAborted();
    return output;
  } finally {
    signal.removeEventListener("abort", abort);
    terminate();
    await termination;
  }
}

export async function evaluateOmpCheck(input: AgentSessionInput, signal: AbortSignal): Promise<OmpCheckedReport> {
  if (!await agentSessionEnabled(input)) {
    return { report: { status: "inactive", blockers: [], advisories: [] } };
  }
  const snapshot = await createRepositorySnapshot(input.projectDirectory, signal);
  const before = await snapshot.fingerprint(signal);
  const output = await runOmpCommand(input, ["agent", "stop", "--session", input.sessionId], signal);
  const report: AgentReport = JSON.parse(output);
  if (!["passed", "blocked", "inactive"].includes(report.status) || !Array.isArray(report.blockers) || !Array.isArray(report.advisories)) {
    throw new Error("Premise evaluator returned an invalid completion report; check the installed Premise CLI");
  }
  const after = await snapshot.fingerprint(signal);
  return {
    report,
    snapshot,
    ...(before === after ? { fingerprint: after } : {}),
  };
}
