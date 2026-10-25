#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConfigurationError, RefusedError } from "./errors.js";
import { evaluateRepository } from "./evaluate.js";
import { checkExitCode, formatEvaluations } from "./format.js";
import { refreshDecision } from "./refresh.js";
import { errorMessage } from "./text.js";

const usage = "Usage: premise <check | refresh <ADR-ID> | signoff --base <ref> | context <file> | render --out <dir>>";

export async function run({ args, projectDirectory }: { args: string[]; projectDirectory: string }): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "check":
      return runCheck({ args: rest, projectDirectory });
    case "refresh":
      return runRefresh({ args: rest, projectDirectory });
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

function requireArgumentCount({ args, count }: { args: string[]; count: number }): void {
  if (args.length !== count) {
    throw new ConfigurationError(usage);
  }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run({ args: process.argv.slice(2), projectDirectory: process.cwd() }).catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    return error instanceof RefusedError ? 1 : 2;
  });
}
