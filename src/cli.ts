#!/usr/bin/env node

import { runExecutableRequirements } from "./executable-requirements.js";
import { readArtifactSources } from "./compiled-context.js";
import {
  findDecisionsRequiringReview,
  reviewDecision,
  type DecisionRequiringReview,
} from "./decision-awareness.js";
import { evaluatePremises, type PremiseEvaluation } from "./provider.js";
import { createDefaultProviders } from "./providers/default-providers.js";

try {
  await run({ arguments: process.argv.slice(2), projectDirectory: process.cwd() });
} catch (error) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}

async function run({
  arguments: arguments_,
  projectDirectory,
}: {
  arguments: string[];
  projectDirectory: string;
}) {
  const [command, ...commandArguments] = arguments_;

  switch (command) {
    case "test":
      requireNoArguments({ command, commandArguments });
      await runTests({ projectDirectory });
      return;
    case "context":
      await runContext({ commandArguments, projectDirectory });
      return;
    case "check":
      requireNoArguments({ command, commandArguments });
      await runCheck({ projectDirectory });
      return;
    case "review":
      await runReview({ commandArguments, projectDirectory });
      return;
    default:
      throw new Error("Usage: premise <test|context|check|review>");
  }
}

async function runCheck({ projectDirectory }: { projectDirectory: string }) {
  const evaluations = await evaluatePremises({
    projectDirectory,
    providers: createDefaultProviders({ silentCucumber: true }),
  });
  const affectedDecisions = await findDecisionsRequiringReview({
    evaluations,
    projectDirectory,
  });

  for (const evaluation of evaluations) {
    writeUnestablishedPremise(evaluation);
  }

  for (const affected of affectedDecisions) {
    writeAffectedDecision(affected);
  }

  if (
    evaluations.some(({ result }) => result.status !== "established") ||
    affectedDecisions.length > 0
  ) {
    process.exitCode = 1;
  }
}

function writeUnestablishedPremise({
  premise,
  provider,
  result,
}: PremiseEvaluation) {
  if (result.status === "established") {
    return;
  }

  if (result.status === "unknown") {
    process.stdout.write(
      `${premise.id} unknown via ${provider}: ${result.reason}\n`,
    );
    return;
  }

  process.stdout.write(
    [
      `${premise.id} failed via ${provider}.`,
      ...result.diagnostics.map(({ message, uri }) =>
        uri ? `- ${message} (${uri})` : `- ${message}`,
      ),
      "",
    ].join("\n"),
  );
}

function writeAffectedDecision({
  decision,
  drivers,
  reasons,
}: DecisionRequiringReview): void {
  process.stdout.write(
    [
      `Reconsider decision ${decision.decision.id}: ${decision.decision.title}`,
      "",
      ...reasons.map(({ message }) => `Reason: ${message}`),
      "",
      ...drivers.flatMap((driver) => [
        `Driver source: ${driver.uri}`,
        driver.content.trim(),
        "",
      ]),
      "",
      `Decision source: ${decision.uri}`,
      decision.content.trim(),
      "",
      "After reconsidering:",
      `- If it remains valid, run: premise review ${decision.decision.id}`,
      "- If it no longer applies, add a new decision with Supersedes and review the new decision.",
      "",
    ].join("\n"),
  );
}

async function runReview({
  commandArguments,
  projectDirectory,
}: {
  commandArguments: string[];
  projectDirectory: string;
}) {
  const [decisionId, ...remainingArguments] = commandArguments;
  if (!decisionId || remainingArguments.length > 0) {
    throw new Error("Usage: premise review <decision-id>");
  }
  await reviewDecision({ decisionId, projectDirectory });
}

async function runContext({
  commandArguments,
  projectDirectory,
}: {
  commandArguments: string[];
  projectDirectory: string;
}) {
  const [artifact, ...remainingArguments] = commandArguments;

  if (!artifact || remainingArguments.length > 0) {
    throw new Error("Usage: premise context <artifact>");
  }

  const sources = await readArtifactSources({ artifact, projectDirectory });
  if (sources.length === 0) {
    process.stdout.write(`No compiled context for ${artifact}\n`);
    return;
  }
  for (const source of sources) {
    process.stdout.write(`${source.content.trim()}\n`);
  }
}

async function runTests({ projectDirectory }: { projectDirectory: string }) {
  const success = await runExecutableRequirements({ projectDirectory });

  if (!success) {
    process.exitCode = 1;
  }
}

function requireNoArguments({
  command,
  commandArguments,
}: {
  command: string;
  commandArguments: string[];
}) {
  if (commandArguments.length > 0) {
    throw new Error(`premise ${command} does not accept arguments`);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
