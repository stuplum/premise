import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentReport, AgentSessionInput } from "../agent-model.js";
import { agentSessionEnabled } from "../agent-project.js";

export type OmpCheckedReport = { report: AgentReport; fingerprint?: string };

export async function repositoryFingerprint(projectDirectory: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const ancestors = new Set<string>();
  const excluded: Record<string, true> = { ".premise/agent-sessions": true, ".premise/agent-feedback": true };

  async function visit(path: string, uri: string): Promise<void> {
    signal.throwIfAborted();
    const before = await lstat(path, { bigint: true });
    signal.throwIfAborted();
    hash.update(JSON.stringify([uri, Number(before.mode)]));
    if (before.isSymbolicLink()) {
      const target = await readlink(path);
      hash.update(JSON.stringify(["link", target]));
      await visit(await realpath(path), uri);
    } else if (before.isDirectory()) {
      const canonical = await realpath(path);
      if (ancestors.has(canonical)) {
        throw new Error(`Cannot fingerprint cyclic directory link at ${uri || "."}`);
      }
      ancestors.add(canonical);
      try {
        const names = (await readdir(path)).sort();
        for (const name of names) {
          const child = uri ? `${uri}/${name}` : name;
          if (name !== ".git" && name !== "node_modules" && !Object.hasOwn(excluded, child)) {
            await visit(join(path, name), child);
          }
        }
      } finally {
        ancestors.delete(canonical);
      }
    } else if (before.isFile()) {
      hash.update(JSON.stringify(["file", before.size.toString()]));
      const file = await open(path, "r");
      try {
        let position = 0;
        while (true) {
          signal.throwIfAborted();
          const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
          if (bytesRead === 0) {
            break;
          }
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
      } finally {
        await file.close();
      }
    } else {
      throw new Error(`Cannot fingerprint non-regular repository entry ${uri}`);
    }
    const after = await lstat(path, { bigint: true });
    if (before.ino !== after.ino || before.mode !== after.mode || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new Error(`Repository changed while fingerprinting ${uri || "."}; wait for writes to finish and retry completion`);
    }
    signal.throwIfAborted();
  }

  await visit(projectDirectory, "");
  return hash.digest("hex");
}

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
  const before = await repositoryFingerprint(input.projectDirectory, signal);
  const output = await runOmpCommand(input, ["agent", "stop", "--session", input.sessionId], signal);
  const report: AgentReport = JSON.parse(output);
  if (!["passed", "blocked", "inactive"].includes(report.status) || !Array.isArray(report.blockers) || !Array.isArray(report.advisories)) {
    throw new Error("Premise evaluator returned an invalid completion report; check the installed Premise CLI");
  }
  const after = await repositoryFingerprint(input.projectDirectory, signal);
  return { report, ...(before === after ? { fingerprint: after } : {}) };
}
