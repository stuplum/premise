import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { evaluateDecisions } from "./decision-awareness.js";
import {
  knowledgeStateFromEvaluation,
  type KnowledgeState,
} from "./knowledge-state.js";
import type {
  AssertionReference,
  PremiseEvaluation,
} from "./provider.js";

type ContextDriver = {
  id: string;
  kind: string;
};

export type DecisionContextInput = {
  drivers: ContextDriver[];
  id: string;
  source: AssertionReference;
  state: Extract<
    KnowledgeState,
    { status: "established" } | { status: "reconsider" }
  >;
  title: string;
};

export type PremiseContextEntry = {
  description: string;
  dialect: string;
  id: string;
  kind: "premise";
  premiseType: string;
  provider: string;
  source: AssertionReference;
  state: Exclude<KnowledgeState, { status: "reconsider" }>;
};

export type DecisionContextEntry = {
  description: string;
  id: string;
  kind: "decision";
  source: AssertionReference;
  state: Extract<
    KnowledgeState,
    { status: "established" } | { status: "reconsider" }
  >;
};

export type ContextEntry = PremiseContextEntry | DecisionContextEntry;

export type ArtifactContextProjection = {
  artifact: string;
  knowledge: ContextEntry[];
};

export async function projectArtifactContext({
  artifact,
  evaluations,
  projectDirectory,
}: {
  artifact: string;
  evaluations: PremiseEvaluation[];
  projectDirectory: string;
}): Promise<ArtifactContextProjection> {
  const normalizedArtifact = await resolveArtifactPath({
    artifact,
    projectDirectory,
  });
  const decisions = (await evaluateDecisions({ evaluations, projectDirectory })).map(
    ({ decision, state }) => ({
      drivers: decision.decision.drivers.map(({ id, kind }) => ({ id, kind })),
      id: decision.decision.id,
      source: { selector: decision.decision.id, uri: decision.uri },
      state,
      title: decision.decision.title,
    }),
  );

  return createArtifactContextProjection({
    artifact: normalizedArtifact,
    decisions,
    evaluations,
  });
}

export function createArtifactContextProjection({
  artifact,
  decisions,
  evaluations,
}: {
  artifact: string;
  decisions: DecisionContextInput[];
  evaluations: PremiseEvaluation[];
}): ArtifactContextProjection {
  const premises = evaluations
    .filter((evaluation) => relatesToArtifact({ artifact, evaluation }))
    .map(({ premise, provider, ...evaluation }): PremiseContextEntry => {
      return {
        description: premise.description,
        dialect: premise.assertion.dialect,
        id: premise.id,
        kind: "premise",
        premiseType: premise.type,
        provider,
        source: premise.assertion.ref,
        state: knowledgeStateFromEvaluation({ premise, provider, ...evaluation }),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const relatedKnowledgeIds = new Set(premises.map(({ id }) => id));
  const relatedDecisions: DecisionContextEntry[] = [];
  const remainingDecisions = [...decisions].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  let foundRelatedDecision = true;
  while (foundRelatedDecision) {
    foundRelatedDecision = false;
    for (let index = remainingDecisions.length - 1; index >= 0; index -= 1) {
      const decision = remainingDecisions[index];
      if (!decision || !isRelatedDecision({ artifact, decision, relatedKnowledgeIds })) {
        continue;
      }
      relatedKnowledgeIds.add(decision.id);
      relatedDecisions.push({
        description: decision.title,
        id: decision.id,
        kind: "decision",
        source: decision.source,
        state: decision.state,
      });
      remainingDecisions.splice(index, 1);
      foundRelatedDecision = true;
    }
  }
  relatedDecisions.sort((left, right) => left.id.localeCompare(right.id));

  return {
    artifact,
    knowledge: [...premises, ...relatedDecisions],
  };
}

function relatesToArtifact({
  artifact,
  evaluation,
}: {
  artifact: string;
  evaluation: PremiseEvaluation;
}) {
  const evidence =
    "evidence" in evaluation.result ? evaluation.result.evidence ?? [] : [];
  return evidence.some(
    ({ role, uri }) => role !== "assertion" && normalizePath(uri) === artifact,
  );
}

function isRelatedDecision({
  artifact,
  decision,
  relatedKnowledgeIds,
}: {
  artifact: string;
  decision: DecisionContextInput;
  relatedKnowledgeIds: Set<string>;
}) {
  return decision.drivers.some(
    ({ id, kind }) =>
      (kind === "source" && normalizePath(id) === artifact) ||
      ((kind === "premise" || kind === "decision") &&
        relatedKnowledgeIds.has(id)),
  );
}

function normalizePath(path: string) {
  return path.replace(/^\.\//, "").split("\\").join("/");
}

async function resolveArtifactPath({
  artifact,
  projectDirectory,
}: {
  artifact: string;
  projectDirectory: string;
}) {
  const directory = await realpath(projectDirectory);
  let artifactPath = resolve(directory, artifact);
  try {
    artifactPath = await realpath(artifactPath);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
  const relativeArtifact = relative(directory, artifactPath);

  if (
    relativeArtifact === "" ||
    relativeArtifact.startsWith("..") ||
    isAbsolute(relativeArtifact)
  ) {
    throw new Error(`${artifact} must be inside the project`);
  }

  return normalizePath(relativeArtifact);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
