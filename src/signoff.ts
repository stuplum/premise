import { parse } from "yaml";
import { checkText, type CheckSources } from "./check-text.js";
import { classify } from "./classifiers/classify.js";
import { SIGNOFF_QUESTION, type ClassifierResult, type ClassifierRuntime, type SignoffPayload } from "./classifiers/types.js";
import { CONFIG_FILE, classifierName, loadConfig, parseConfig } from "./config.js";
import { loadDecisions } from "./decisions.js";
import { fingerprintOf } from "./fingerprint.js";
import { readAtRef, requireCommit } from "./git.js";
import type { ClassifierConfig, Config, Decision } from "./model.js";
import { recoverSignedText } from "./recovery.js";
import { loadReports } from "./reports/load.js";
import type { Reports } from "./reports/model.js";
import { currentSources } from "./sources.js";
import { stableJson } from "./stable-json.js";
import { arrayOf, compareText, isRecord } from "./text.js";

export type SignoffVerdict = "passed" | "reconsider" | "needs-human";

export type SignoffOutcome = {
  decisionId: string;
  classifier: string;
  model: string;
  changed: string[];
  verdict: SignoffVerdict;
  detail: string;
};

type SignedLink = { check: string; fingerprint: string };

type SignoffContext = {
  projectDirectory: string;
  base: string;
  config: Config;
  reports: Reports;
  sources: CheckSources;
};

type PreparedChanges =
  | { status: "ready"; changes: SignoffPayload["changes"] }
  | { status: "blocked"; reason: string };

type BaseDecision = {
  signoff: string;
  fields: { status: unknown; title: unknown; context: unknown; because: unknown };
  fingerprints: Map<string, string>;
};

type BaseState = { status: "absent" } | { status: "unreadable" } | { status: "present"; decision: BaseDecision };

export async function signoff({
  projectDirectory,
  base,
  runtime,
}: {
  projectDirectory: string;
  base: string;
  runtime: ClassifierRuntime;
}): Promise<SignoffOutcome[]> {
  const config = await loadConfig({ projectDirectory });
  const decisions = await loadDecisions({ projectDirectory, config });
  await requireCommit({ projectDirectory, ref: base });
  const reports = await loadReports({ projectDirectory, config });
  const baseConfig = await configAtRef({ projectDirectory, ref: base });
  const context: SignoffContext = {
    projectDirectory,
    base,
    config,
    reports,
    sources: await currentSources({ projectDirectory, config, reports }),
  };
  const outcomes: SignoffOutcome[] = [];
  for (const decision of decisions) {
    const baseState = await decisionAtRef({
      projectDirectory,
      ref: base,
      uri: decision.uri,
      defaultSignoff: baseConfig?.signoff.default ?? "human",
    });
    const baseDecision = baseState.status === "present" ? baseState.decision : undefined;
    const name = classifierName(baseDecision?.signoff ?? decision.signoff) ?? classifierName(decision.signoff);
    if (name === undefined) {
      continue;
    }
    const baseFingerprints = baseDecision?.fingerprints ?? new Map<string, string>();
    const changed = changedLinks({ decision, baseFingerprints });
    if (changed.length === 0 || (decision.status !== "accepted" && baseDecision?.fields.status === decision.status)) {
      continue;
    }
    const headClassifier = config.classifiers[name];
    const classifier = baseConfig?.classifiers[name];
    const identity = {
      decisionId: decision.id,
      classifier: name,
      model: (classifier ?? headClassifier)?.model ?? "unknown",
      changed: changed.map((link) => link.check),
    };
    const blocker = decisionBlocker({ decision, baseState, base });
    if (blocker !== undefined) {
      outcomes.push({ ...identity, verdict: "needs-human", detail: blocker });
      continue;
    }
    if (classifier === undefined || stableJson(classifier) !== stableJson(headClassifier)) {
      outcomes.push({ ...identity, verdict: "needs-human", detail: `classifier ${name} is not configured the same at ${base}` });
      continue;
    }
    const prepared = await prepareChanges({ context, decision, changed, baseFingerprints });
    if (prepared.status === "blocked") {
      outcomes.push({ ...identity, verdict: "needs-human", detail: prepared.reason });
      continue;
    }
    const payload: SignoffPayload = {
      question: SIGNOFF_QUESTION,
      decision: { id: decision.id, title: decision.title, context: decision.context, because: decision.because },
      changes: prepared.changes,
    };
    outcomes.push({ ...identity, ...verdictFor({ result: await classify({ payload, classifier, runtime }), classifier }) });
  }
  return outcomes;
}

export function formatSignoff({ outcomes }: { outcomes: SignoffOutcome[] }): string {
  if (outcomes.length === 0) {
    return "No classifier sign-off needed.\n";
  }
  return outcomes
    .map(
      (outcome) =>
        `${outcome.decisionId} ${outcome.verdict} via ${outcome.classifier} (${outcome.model}): ${outcome.detail}; changed ${outcome.changed.join(", ")}\n`,
    )
    .join("");
}

export function signoffExitCode({ outcomes }: { outcomes: SignoffOutcome[] }): 0 | 1 {
  return outcomes.every((outcome) => outcome.verdict === "passed") ? 0 : 1;
}

async function decisionAtRef({
  projectDirectory,
  ref,
  uri,
  defaultSignoff,
}: {
  projectDirectory: string;
  ref: string;
  uri: string;
  defaultSignoff: string;
}): Promise<BaseState> {
  const content = await readAtRef({ projectDirectory, ref, uri });
  if (content === undefined) {
    return { status: "absent" };
  }
  let document: unknown;
  try {
    document = parse(content);
  } catch {
    return { status: "unreadable" };
  }
  if (!isRecord(document)) {
    return { status: "unreadable" };
  }
  const fingerprints = new Map<string, string>();
  for (const link of [...arrayOf(document.supported_by), ...arrayOf(document.enforced_by)]) {
    if (isRecord(link) && typeof link.check === "string" && typeof link.fingerprint === "string") {
      fingerprints.set(link.check, link.fingerprint);
    }
  }
  return {
    status: "present",
    decision: {
      signoff: typeof document.signoff === "string" ? document.signoff : defaultSignoff,
      fields: {
        status: document.status,
        title: document.title,
        context: document.context,
        because: document.because,
      },
      fingerprints,
    },
  };
}

function decisionBlocker({
  decision,
  baseState,
  base,
}: {
  decision: Decision;
  baseState: BaseState;
  base: string;
}): string | undefined {
  if (baseState.status === "absent") {
    return "decision is new in this pull request";
  }
  if (baseState.status === "unreadable") {
    return `decision at ${base} cannot be read`;
  }
  const baseDecision = baseState.decision;
  if (classifierName(baseDecision.signoff) === undefined) {
    return `sign-off changed from ${baseDecision.signoff} to ${decision.signoff} in this pull request`;
  }
  const headFields: Record<string, unknown> = {
    signoff: decision.signoff,
    status: decision.status,
    title: decision.title,
    context: decision.context,
    because: decision.because,
  };
  const baseFields: Record<string, unknown> = { signoff: baseDecision.signoff, ...baseDecision.fields };
  const changed = Object.keys(headFields).filter((field) => stableJson(headFields[field]) !== stableJson(baseFields[field]));
  return changed.length > 0 ? `decision changed in this pull request: ${changed.join(", ")}` : undefined;
}

async function configAtRef({ projectDirectory, ref }: { projectDirectory: string; ref: string }): Promise<Config | undefined> {
  const content = await readAtRef({ projectDirectory, ref, uri: CONFIG_FILE });
  if (content === undefined) {
    return undefined;
  }
  try {
    return parseConfig({ content });
  } catch {
    return undefined;
  }
}

function changedLinks({
  decision,
  baseFingerprints,
}: {
  decision: Decision;
  baseFingerprints: Map<string, string>;
}): SignedLink[] {
  const byCheck = new Map<string, SignedLink>();
  for (const link of [...decision.supportedBy, ...decision.enforcedBy]) {
    if (link.fingerprint !== undefined && link.fingerprint !== baseFingerprints.get(link.check)) {
      byCheck.set(link.check, { check: link.check, fingerprint: link.fingerprint });
    }
  }
  return [...byCheck.values()].sort((left, right) => compareText(left.check, right.check));
}

async function prepareChanges({
  context,
  decision,
  changed,
  baseFingerprints,
}: {
  context: SignoffContext;
  decision: Decision;
  changed: SignedLink[];
  baseFingerprints: Map<string, string>;
}): Promise<PreparedChanges> {
  const changes: SignoffPayload["changes"] = [];
  for (const link of changed) {
    const after = await checkText({ id: link.check, sources: context.sources });
    if (after === undefined || fingerprintOf(after) !== link.fingerprint) {
      return {
        status: "blocked",
        reason: `${link.check} fingerprint does not match the current text; run premise refresh ${decision.id}`,
      };
    }
    const baseFingerprint = baseFingerprints.get(link.check);
    if (baseFingerprint === undefined) {
      changes.push({ check: link.check, before: "", after });
      continue;
    }
    const recovery = await recoverSignedText({
      projectDirectory: context.projectDirectory,
      config: context.config,
      reports: context.reports,
      decisionUri: decision.uri,
      check: link.check,
      fingerprint: baseFingerprint,
      ref: context.base,
    });
    if (recovery.status === "unrecoverable") {
      return { status: "blocked", reason: `${link.check} signed text unrecoverable: ${recovery.reason}` };
    }
    changes.push({ check: link.check, before: recovery.text, after });
  }
  return { status: "ready", changes };
}

function verdictFor({
  result,
  classifier,
}: {
  result: ClassifierResult;
  classifier: ClassifierConfig;
}): { verdict: SignoffVerdict; detail: string } {
  if (result.status === "unavailable") {
    return { verdict: "needs-human", detail: `classifier unavailable: ${result.reason}` };
  }
  const detail = `probability ${result.probability}`;
  if (result.probability >= classifier.thresholds.established) {
    return { verdict: "passed", detail };
  }
  return { verdict: result.probability <= classifier.thresholds.failed ? "reconsider" : "needs-human", detail };
}
