import { spawn } from "node:child_process";

export type CucumberRepositoryPaths = {
  inputs: string[];
  outputs: string[];
};

const cucumberApi = import.meta.resolve("@cucumber/cucumber/api");
const tsxLoader = import.meta.resolve("tsx");
const discoveryScript = `
import { loadConfiguration } from ${JSON.stringify(cucumberApi)};
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const terminate = () => {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(process.pid), "/t", "/f"], { stdio: "ignore" });
    process.exit(1);
  }
  process.kill(-process.pid, "SIGKILL");
};
process.once("disconnect", terminate);
process.channel?.unref();
if (!process.connected) terminate();
const cwd = process.argv[1];
const sink = { write() { return true; } };
const { runConfiguration } = await loadConfiguration({}, {
  cwd,
  env: process.env,
  stdout: sink,
  stderr: sink,
});
process.send({
  inputs: [
    ...runConfiguration.sources.paths,
    ...runConfiguration.support.importPaths,
    ...runConfiguration.support.requirePaths,
    ...[runConfiguration.formats.stdout, ...Object.values(runConfiguration.formats.files)]
      .filter((path) => typeof path === "string" && (
        path.startsWith(".") || path.startsWith("/") || path.startsWith("file:") || /^[a-zA-Z]:[/\\\\]/.test(path)
      ))
      .map((path) => path.startsWith("file:") ? fileURLToPath(path) : path),
  ],
  outputs: Object.keys(runConfiguration.formats.files),
});
`;

export async function discoverCucumberRepositoryPaths(
  projectDirectory: string,
  signal: AbortSignal,
): Promise<CucumberRepositoryPaths> {
  signal.throwIfAborted();
  const child = spawn(
    process.versions.bun ? "node" : process.execPath,
    [
      "--import",
      tsxLoader,
      "--input-type=module",
      "--eval",
      discoveryScript,
      projectDirectory,
    ],
    {
      cwd: projectDirectory,
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let diagnostics = "";
  let discovered: CucumberRepositoryPaths | undefined;
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
      termination = Promise.resolve();
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
          failure = new Error(`Cannot terminate Cucumber configuration discovery: ${String(error)}`);
          child.kill("SIGKILL");
        }
      }
    }
  };
  const abort = () => {
    failure = new Error(
      "Cucumber configuration discovery was interrupted; retry completion to run a fresh check",
    );
    terminate();
  };
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    diagnostics = (diagnostics + chunk).slice(-16 * 1024);
  });
  child.on("message", (message: unknown) => {
    if (isCucumberRepositoryPaths(message)) {
      discovered = message;
    } else {
      failure = new Error("Cucumber configuration discovery returned invalid paths");
      terminate();
    }
  });
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) {
      abort();
    }
    await new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        reject(
          new Error(
            `Cannot start Cucumber configuration discovery: ${error.message}`,
          ),
        );
      });
      child.once("close", (code, killedBy) => {
        if (failure) {
          reject(failure);
        } else if (code !== 0) {
          reject(
            new Error(
              `Cucumber configuration discovery exited ${
                killedBy ? `on ${killedBy}` : `with code ${code}`
              }${diagnostics.trim() ? `: ${diagnostics.trim()}` : ""}`,
            ),
          );
        } else {
          resolve();
        }
      });
    });
    signal.throwIfAborted();
    if (!discovered) {
      throw new Error("Cucumber configuration discovery returned no paths");
    }
    return discovered;
  } finally {
    signal.removeEventListener("abort", abort);
    terminate();
    await termination;
  }
}

function isCucumberRepositoryPaths(
  value: unknown,
): value is CucumberRepositoryPaths {
  if (!value || typeof value !== "object") {
    return false;
  }
  const paths = value as Record<string, unknown>;
  return (
    Array.isArray(paths.inputs) &&
    paths.inputs.every((path) => typeof path === "string") &&
    Array.isArray(paths.outputs) &&
    paths.outputs.every((path) => typeof path === "string")
  );
}
