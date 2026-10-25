#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { defaultRuntime } from "./classifiers/types.js";
import { decisionsForFile, formatContext } from "./context.js";
import { ConfigurationError, RefusedError } from "./errors.js";
import { evaluateRepository } from "./evaluate.js";
import { checkExitCode, formatEvaluations } from "./format.js";
import { GITHUB_API_URL, githubApprovals } from "./github.js";
import { refreshDecision } from "./refresh.js";
import { renderDecisions } from "./render.js";
import { formatSignoff, signoff, signoffExitCode, type Approvals } from "./signoff.js";
import { errorMessage } from "./text.js";

const usage =
  "Usage: premise <check | refresh <ADR-ID> | signoff --base <ref> [--pull-request <n> [--repository <owner/name>]] | context <file> | render --out <dir>>";

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
  const options = parseOptions({ args, names: ["base", "pull-request", "repository"] });
  if (!options.base) {
    throw new ConfigurationError(usage);
  }
  const approvals = await pullRequestApprovals({ projectDirectory, options });
  const outcomes = await signoff({ projectDirectory, base: options.base, runtime: defaultRuntime({ projectDirectory }), approvals });
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
  const value = parseOptions({ args, names: [name] })[name];
  if (!value) {
    throw new ConfigurationError(usage);
  }
  return value;
}

function parseOptions({ args, names }: { args: string[]; names: string[] }): Record<string, string | undefined> {
  try {
    const parsed = parseArgs({
      args,
      options: Object.fromEntries(names.map((name) => [name, { type: "string" as const }])),
      strict: true,
      allowPositionals: false,
    });
    return Object.fromEntries(names.map((name) => [name, typeof parsed.values[name] === "string" ? parsed.values[name] : undefined]));
  } catch {
    throw new ConfigurationError(usage);
  }
}

async function pullRequestApprovals({
  projectDirectory,
  options,
}: {
  projectDirectory: string;
  options: Record<string, string | undefined>;
}): Promise<Approvals | undefined> {
  const pullRequest = options["pull-request"];
  if (pullRequest === undefined) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/.test(pullRequest)) {
    throw new ConfigurationError("--pull-request must be a positive whole number");
  }
  const repository = options.repository || process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new ConfigurationError("--pull-request needs --repository or GITHUB_REPOSITORY");
  }
  return githubApprovals({
    projectDirectory,
    repository,
    pullRequest: Number(pullRequest),
    token: process.env.GITHUB_TOKEN ?? "",
    apiUrl: process.env.GITHUB_API_URL || GITHUB_API_URL,
  });
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run({ args: process.argv.slice(2), projectDirectory: process.cwd() }).catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    return error instanceof RefusedError ? 1 : 2;
  });
}
