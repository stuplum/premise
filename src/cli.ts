#!/usr/bin/env node

import { runAgentContext, runAgentStart, runAgentStop } from "./agent-lifecycle.js";
import { runExecutableRequirements } from "./executable-requirements.js";
import { projectArtifactContext } from "./context-projection.js";
import { renderArtifactContext } from "./context-renderer.js";
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
    case "agent":
      await runAgent({ commandArguments, projectDirectory });
      return;
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
      throw new Error("Usage: premise <test|context|check|review|agent>");
  }
}

async function runAgent({
  commandArguments,
  projectDirectory,
}: {
  commandArguments: string[];
  projectDirectory: string;
}) {
  const [action, ...arguments_] = commandArguments;
  const context = action === "context";
  const offset = context ? 1 : 0;
  const sessionId = arguments_[offset + 1];
  if (
    (action !== "start" && action !== "stop" && !context) ||
    arguments_.length !== offset + 2 ||
    arguments_[offset] !== "--session" ||
    !sessionId?.trim() ||
    sessionId.startsWith("--") ||
    (context && !arguments_[0]?.trim())
  ) {
    throw new Error("Usage: premise agent <start|stop> --session <id> | premise agent context <artifact> --session <id>");
  }
  const input = { projectDirectory, sessionId };
  const report = context
    ? await runAgentContext({ ...input, artifact: arguments_[0] })
    : action === "start"
      ? await runAgentStart(input)
      : await runAgentStop(input);
  process.stdout.write(`${JSON.stringify(report)}\n`);
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

  const evaluations = await evaluatePremises({
    projectDirectory,
    providers: createDefaultProviders({ silentCucumber: true }),
  });
  const context = await projectArtifactContext({
    artifact,
    evaluations,
    projectDirectory,
  });
  if (context.knowledge.length === 0) {
    process.stdout.write(`No context for ${artifact}\n`);
    return;
  }
  process.stdout.write(renderArtifactContext(context));
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
