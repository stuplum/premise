import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentAdvisory,
  AgentBlocker,
  AgentReport,
  AgentSessionInput,
} from "./agent-model.js";
import { agentSessionUri } from "./agent-project.js";
import {
  createAgentSession,
  readAgentSession,
  readSessionDecision,
  resolveAgentSessionInput,
  type AgentSession,
} from "./agent-session.js";
import {
  projectArtifactContext,
  type ArtifactContextProjection,
} from "./context-projection.js";
import { evaluateDecisions } from "./decision-awareness.js";
import { reviewWithJev } from "./jev-review.js";
import { evaluatePremises, type PremiseEvaluation } from "./provider.js";
import { createDefaultProviders } from "./providers/default-providers.js";
import { readConfiguration } from "./repository.js";

const premiseCommand = `node ${quoteShellArgument(fileURLToPath(new URL("./cli.js", import.meta.url)))}`;

export async function runAgentStart(input: AgentSessionInput): Promise<AgentReport> {
  const resolved = await resolveAgentSessionInput(input);
  const instructions = orientation(resolved.sessionId);
  let session: AgentSession | undefined;
  try {
    session = await readAgentSession(resolved);
  } catch (error) {
    return {
      status: "blocked",
      blockers: [{ kind: "session", source: { uri: agentSessionUri(resolved.sessionId) }, message: errorMessage(error) }],
      advisories: [],
      instructions,
    };
  }
  let configured: boolean;
  try {
    configured = await configurationExists(resolved.projectDirectory);
  } catch (error) {
    return {
      status: "blocked",
      blockers: [{ kind: "evaluation", source: { uri: "premise.json" }, message: errorMessage(error) }],
      advisories: [],
      instructions,
    };
  }
  if (!configured && !session) {
    return { status: "inactive", blockers: [], advisories: [], instructions: "No premise.json is present; this repository has not enabled the Premise agent gate." };
  }
  const blockers: AgentBlocker[] = [];
  if (!session) {
    try {
      session = await createAgentSession(resolved);
    } catch (error) {
      blockers.push({ kind: "session", source: { uri: agentSessionUri(resolved.sessionId) }, message: errorMessage(error) });
    }
  }
  if (!configured) {
    blockers.push(missingConfiguration());
  } else {
    try {
      await readConfiguration(resolved);
    } catch (error) {
      blockers.push({ kind: "evaluation", source: { uri: "premise.json" }, message: `${errorMessage(error)}. Repair premise.json before proceeding.` });
    }
  }
  if (session) {
    blockers.push(...await checkDecisionHistory(session));
  }
  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    advisories: [],
    instructions: session && session.decisions.length > 0
      ? `${instructions}\nHistorical decisions: ${session.decisions.map(({ id, uri }) => `${id} (${uri})`).join(", ")}.`
      : instructions,
  };
}

export async function runAgentStop(input: AgentSessionInput): Promise<AgentReport> {
  const resolved = await resolveAgentSessionInput(input);
  const blockers: AgentBlocker[] = [];
  let session: AgentSession | undefined;
  try {
    session = await readAgentSession(resolved);
  } catch (error) {
    blockers.push({ kind: "session", source: { uri: agentSessionUri(resolved.sessionId) }, message: errorMessage(error) });
  }
  let configured = false;
  try {
    configured = await configurationExists(resolved.projectDirectory);
  } catch (error) {
    blockers.push({ kind: "evaluation", source: { uri: "premise.json" }, message: errorMessage(error) });
  }
  if (!configured && !session && blockers.length === 0) {
    return { status: "inactive", blockers: [], advisories: [] };
  }
  if (!session && !blockers.some(({ kind }) => kind === "session")) {
    blockers.push({
      kind: "session",
      source: { uri: agentSessionUri(resolved.sessionId) },
      message: `No start snapshot exists for this session. Run ${premiseCommand} agent start --session ${quoteShellArgument(resolved.sessionId)} before making changes. If this session already started, restore its original snapshot instead of replacing the decision history.`,
    });
  }
  if (!configured) {
    blockers.push(missingConfiguration());
  }
  let evaluations: PremiseEvaluation[] | undefined;
  if (configured) {
    try {
      await readConfiguration(resolved);
      evaluations = await evaluatePremises({
        projectDirectory: resolved.projectDirectory,
        providers: createDefaultProviders({ silentCucumber: true }),
      });
      for (const { premise, provider, result } of evaluations) {
        if (result.status === "established") {
          continue;
        }
        const detail = result.status === "unknown"
          ? result.reason
          : result.diagnostics.map(({ message, uri }) => uri ? `${message} (${uri})` : message).join("; ");
        blockers.push({
          kind: "premise",
          id: premise.id,
          state: result.status,
          source: { uri: premise.assertion.ref.uri },
          message: `${premise.id} at ${premise.assertion.ref.uri} is ${result.status} via ${provider}: ${detail}. Repair the implementation or restore executable evidence, then rerun the completion check. A decision review cannot clear failed or unknown evidence.`,
        });
      }
    } catch (error) {
      blockers.push({ kind: "evaluation", message: `Cannot evaluate the current repository: ${errorMessage(error)}. Repair the configuration or provider failure and rerun the completion check.` });
    }
  }
  if (evaluations) {
    try {
      const decisions = await evaluateDecisions({
        evaluations,
        projectDirectory: resolved.projectDirectory,
      });
      for (const { decision, drivers, state } of decisions) {
        if (state.status !== "reconsider") {
          continue;
        }
        blockers.push({
          kind: "decision",
          id: decision.decision.id,
          state: state.status,
          source: { uri: decision.uri },
          message: `Reconsider ${decision.decision.id} at ${decision.uri}: ${state.reasons.map(({ message }) => message).join(" ")} Driver sources: ${drivers.map(({ id, uri }) => `${id} (${uri})`).join(", ")}. Repair failed or unknown supporting evidence. If the choice remains justified, explicitly reaffirm it with ${premiseCommand} review ${quoteShellArgument(decision.decision.id)}; otherwise retain this record and add a new decision with Supersedes ${decision.decision.id}, then review the replacement.`,
        });
      }
      if (evaluations.length === 0 && decisions.length === 0) {
        blockers.push({ kind: "evaluation", message: "No premises or decisions were discovered in this opted-in repository. Configure executable premises or decision records before claiming verification; an empty evaluation is not evidence." });
      }
    } catch (error) {
      blockers.push({ kind: "evaluation", message: `Cannot evaluate current decision knowledge: ${errorMessage(error)}. Repair the decision sources, drivers or review records; preserve historical decisions and use additive Supersedes replacements.` });
    }
  }
  if (session) {
    blockers.push(...await checkDecisionHistory(session));
  }
  let advisories: AgentAdvisory[] = [];
  try {
    advisories = await reviewWithJev({
      projectDirectory: resolved.projectDirectory,
      originalDecisions: Object.fromEntries((session?.decisions ?? []).map(({ content, uri }) => [uri, content])),
    });
  } catch (error) {
    blockers.push({ kind: "evaluation", source: { uri: "premise.json" }, message: `Cannot load Jev advisory configuration: ${errorMessage(error)}. Repair the local configuration. Jev advice does not replace executable evidence.` });
  }
  return { status: blockers.length === 0 ? "passed" : "blocked", blockers, advisories };
}

export async function runAgentContext(
  input: AgentSessionInput & { artifact: string },
): Promise<ArtifactContextProjection> {
  if (typeof input.artifact !== "string" || input.artifact.trim().length === 0) {
    throw new Error("An artifact path is required for agent context");
  }
  const resolved = await resolveAgentSessionInput(input);
  const session = await readAgentSession(resolved);
  if (!session) {
    throw new Error(`No start snapshot exists for this session. Run ${premiseCommand} agent start --session ${quoteShellArgument(resolved.sessionId)} before requesting agent context.`);
  }
  if (!await configurationExists(resolved.projectDirectory)) {
    throw new Error(missingConfiguration().message);
  }
  await readConfiguration(resolved);
  const evaluations = await evaluatePremises({
    projectDirectory: resolved.projectDirectory,
    providers: createDefaultProviders({ silentCucumber: true }),
  });
  return projectArtifactContext({
    artifact: input.artifact,
    evaluations,
    projectDirectory: resolved.projectDirectory,
  });
}

async function checkDecisionHistory(session: AgentSession): Promise<AgentBlocker[]> {
  const blockers: AgentBlocker[] = [];
  for (const { content, id, uri } of session.decisions) {
    try {
      if (await readSessionDecision({ projectDirectory: session.projectDirectory, uri }) === content) {
        continue;
      }
      blockers.push({
        kind: "history", id, state: "changed", source: { uri },
        message: `Historical decision ${id} at ${uri} changed during this session. Restore its exact original contents. To change the choice, retain the original and add a new decision with Supersedes ${id}, then review the replacement. Re-reviewing a rewritten record cannot repair history.`,
      });
    } catch (error) {
      blockers.push({
        kind: "history", id, state: "unavailable", source: { uri },
        message: `Cannot read historical decision ${id} at ${uri}: ${errorMessage(error)}. Restore the original record; do not delete or rewrite history. Change a choice by adding a reviewed Supersedes ${id} replacement while retaining the original.`,
      });
    }
  }
  return blockers;
}

async function configurationExists(projectDirectory: string): Promise<boolean> {
  try {
    await lstat(join(projectDirectory, "premise.json"));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function missingConfiguration(): AgentBlocker {
  return {
    kind: "evaluation",
    source: { uri: "premise.json" },
    message: "premise.json is missing from an active Premise session. Restore the repository configuration; removing it cannot deactivate the completion gate.",
  };
}

function orientation(sessionId: string): string {
  const session = quoteShellArgument(sessionId);
  return [
    "Premise is active. This start snapshot is orientation and history protection, not verification or an authoritative security boundary.",
    `Before editing an artifact, inspect its current supporting premises and affected decisions with: ${premiseCommand} agent context <artifact> --session ${session}. Quote artifact paths containing spaces.`,
    `Repair failed or unknown executable evidence. Reconsider affected decisions, then explicitly reaffirm an unchanged choice with ${premiseCommand} review <decision-id>, or retain the original and add a reviewed Supersedes replacement. Never rewrite or delete historical decisions.`,
    `Before completion and after any further edits, run: ${premiseCommand} agent stop --session ${session}. A blocked JSON status prevents completion even though the command exits successfully. A previous pass is not evidence for a changed tree.`,
    "Jev, when configured, provides optional advice only; it cannot approve a mechanical failure or require model approval to pass.",
  ].join("\n");
}

function quoteShellArgument(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
