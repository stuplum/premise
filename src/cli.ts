#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { defaultRuntime } from "./classifiers/types.js";
import { decisionsForFile, formatContext } from "./context.js";
import { ConfigurationError, RefusedError } from "./errors.js";
import { evaluateRepository } from "./evaluate.js";
import { checkExitCode, formatEvaluations } from "./format.js";
import { refreshDecision } from "./refresh.js";
import { renderDecisions } from "./render.js";
import { formatSignoff, signoff, signoffExitCode } from "./signoff.js";
import { errorMessage } from "./text.js";

const usage = "Usage: premise <check | refresh <ADR-ID> | signoff --base <ref> | context <file> | render --out <dir>>";

export async function run({ args, projectDirectory }: { args: string[]; projectDirectory: string }): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "check":
      return runCheck({ args: rest, projectDirectory });
    case "refresh":
      return runRefresh({ args: rest, projectDirectory });
    case "signoff":
      return runSignoff({ args: rest, projectDirectory });
    case "context":
      return runContext({ args: rest, projectDirectory });
    case "render":
      return runRender({ args: rest, projectDirectory });
    default:
      throw new ConfigurationError(usage);
  }
}

async function runCheck({ args, projectDirectory }: { args: string[]; projectDirectory: string }): Promise<number> {
  requireArgumentCount({ args, count: 0 });
  const { evaluations } = await evaluateRepository({ projectDirectory });
  process.stdout.write(formatEvaluations({ evaluations }));
  return checkExitCode({ evaluations });
}

async function runRefresh({ args, projectDirectory }: { args: string[]; projectDirectory: string }): Promise<number> {
  requireArgumentCount({ args, count: 1 });
  const result = await refreshDecision({ projectDirectory, decisionId: args[0] ?? "" });
  const lines = [result.uri, ...result.fingerprints.map(({ check, fingerprint }) => `  ${check} ${fingerprint}`)];
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  return 0;
}

async function runSignoff({ args, projectDirectory }: { args: string[]; projectDirectory: string }): Promise<number> {
  const base = requiredOption({ args, name: "base" });
  const outcomes = await signoff({ projectDirectory, base, runtime: defaultRuntime({ projectDirectory }) });
  process.stdout.write(formatSignoff({ outcomes }));
  return signoffExitCode({ outcomes });
}

async function runContext({ args, projectDirectory }: { args: string[]; projectDirectory: string }): Promise<number> {
  requireArgumentCount({ args, count: 1 });
  process.stdout.write(formatContext(await decisionsForFile({ projectDirectory, file: args[0] ?? "" })));
  return 0;
}

async function runRender({ args, projectDirectory }: { args: string[]; projectDirectory: string }): Promise<number> {
  const out = requiredOption({ args, name: "out" });
  const written = await renderDecisions({ projectDirectory, out });
  process.stdout.write(written.map((uri) => `${uri}\n`).join(""));
  return 0;
}

function requireArgumentCount({ args, count }: { args: string[]; count: number }): void {
  if (args.length !== count) {
    throw new ConfigurationError(usage);
  }
}

function requiredOption({ args, name }: { args: string[]; name: string }): string {
  let value: string | undefined;
  try {
    const parsed = parseArgs({ args, options: { [name]: { type: "string" } }, strict: true, allowPositionals: false });
    const option = parsed.values[name];
    value = typeof option === "string" ? option : undefined;
  } catch {
    throw new ConfigurationError(usage);
  }
  if (!value) {
    throw new ConfigurationError(usage);
  }
  return value;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run({ args: process.argv.slice(2), projectDirectory: process.cwd() }).catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    return error instanceof RefusedError ? 1 : 2;
  });
}
