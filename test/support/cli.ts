import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const tsx = import.meta.resolve("tsx");

export function runPremise({
  projectDirectory,
  args,
  env = {},
}: {
  projectDirectory: string;
  args: string[];
  env?: Record<string, string>;
}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", tsx, cli, ...args], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
