import { resolveCheck, type CheckResult } from "./check-results.js";
import { checkText, type CheckSources } from "./check-text.js";
import { loadConfig } from "./config.js";
import { loadDecisions } from "./decisions.js";
import { fingerprintOf } from "./fingerprint.js";
import type { Config, Decision } from "./model.js";
import { recoverSignedText, type Recovery } from "./recovery.js";
import { loadReports } from "./reports/load.js";
import type { Reports } from "./reports/model.js";
import { currentSources } from "./sources.js";
import { compareText } from "./text.js";

export type Drift = "unsigned" | "unavailable" | "changed";

export type LinkKind = "supported_by" | "enforced_by";

export type LinkEvaluation = {
  check: string;
  kind: LinkKind;
  result: CheckResult;
  text?: string;
  fingerprint?: string;
  drift?: Drift;
  recovery?: Recovery;
};

export type DecisionState = "violated" | "reconsider" | "stale" | "holds";

export type DecisionEvaluation = { decision: Decision; state: DecisionState; links: LinkEvaluation[] };

export type RepositoryEvaluation = { config: Config; decisions: Decision[]; evaluations: DecisionEvaluation[] };

type EvaluationContext = { projectDirectory: string; config: Config; reports: Reports; sources: CheckSources };

export async function evaluateRepository({ projectDirectory }: { projectDirectory: string }): Promise<RepositoryEvaluation> {
  const config = await loadConfig({ projectDirectory });
  const decisions = await loadDecisions({ projectDirectory, config });
  const reports = await loadReports({ projectDirectory, config });
  const context: EvaluationContext = {
    projectDirectory,
    config,
    reports,
    sources: await currentSources({ projectDirectory, config, reports }),
  };
  const evaluations: DecisionEvaluation[] = [];
  for (const decision of decisions.filter((candidate) => candidate.status === "accepted")) {
    evaluations.push(await evaluateDecision({ decision, context }));
  }
  return { config, decisions, evaluations };
}

async function evaluateDecision({
  decision,
  context,
}: {
  decision: Decision;
  context: EvaluationContext;
}): Promise<DecisionEvaluation> {
  const links = [
    ...decision.supportedBy.map((link) => ({ ...link, kind: "supported_by" as const })),
    ...decision.enforcedBy.map((link) => ({ ...link, kind: "enforced_by" as const })),
  ].sort((left, right) => compareText(left.check, right.check) || compareText(left.kind, right.kind));
  const evaluated: LinkEvaluation[] = [];
  for (const link of links) {
    const text = await checkText({ id: link.check, sources: context.sources });
    const drift = driftOf({ text, fingerprint: link.fingerprint });
    evaluated.push({
      ...link,
      result: resolveCheck({ id: link.check, reports: context.reports }),
      text,
      drift,
      recovery:
        drift === "changed" && link.fingerprint !== undefined
          ? await recoverSignedText({
              projectDirectory: context.projectDirectory,
              config: context.config,
              reports: context.reports,
              decisionUri: decision.uri,
              check: link.check,
              fingerprint: link.fingerprint,
              ref: "HEAD",
            })
          : undefined,
    });
  }
  return { decision, state: deriveState(evaluated), links: evaluated };
}

function driftOf({ text, fingerprint }: { text: string | undefined; fingerprint: string | undefined }): Drift | undefined {
  if (text === undefined) {
    return "unavailable";
  }
  if (fingerprint === undefined) {
    return "unsigned";
  }
  return fingerprintOf(text) === fingerprint ? undefined : "changed";
}

function deriveState(links: LinkEvaluation[]): DecisionState {
  if (links.some((link) => link.kind === "enforced_by" && link.result.status === "failed")) {
    return "violated";
  }
  if (links.some((link) => link.result.status === "unknown" || (link.kind === "supported_by" && link.result.status === "failed"))) {
    return "reconsider";
  }
  return links.some((link) => link.drift !== undefined) ? "stale" : "holds";
}
