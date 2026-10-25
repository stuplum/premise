import { describeResult } from "./check-results.js";
import type { DecisionEvaluation, LinkEvaluation } from "./evaluate.js";

export function formatEvaluations({ evaluations }: { evaluations: DecisionEvaluation[] }): string {
  if (evaluations.length === 0) {
    return "No accepted decisions.\n";
  }
  return evaluations.map(formatEvaluation).join("");
}

export function checkExitCode({ evaluations }: { evaluations: DecisionEvaluation[] }): 0 | 1 {
  return evaluations.every((evaluation) => evaluation.state === "holds" || isWarningOnly(evaluation)) ? 0 : 1;
}

function formatEvaluation(evaluation: DecisionEvaluation): string {
  const warning = isWarningOnly(evaluation) ? " (warning: signoff none)" : "";
  return `${[`${evaluation.decision.id} ${evaluation.state}${warning}`, ...evaluation.links.flatMap(formatLink)].join("\n")}\n`;
}

function formatLink(link: LinkEvaluation): string[] {
  const drift = link.drift === undefined ? "" : `, drift: ${link.drift}`;
  return [`  ${link.kind} ${link.check}: ${describeResult(link.result)}${drift}`, ...recoveryLines(link)];
}

function recoveryLines(link: LinkEvaluation): string[] {
  if (link.recovery === undefined) {
    return [];
  }
  if (link.recovery.status === "unrecoverable") {
    return [`    signed text unrecoverable: ${link.recovery.reason}`];
  }
  return [
    `    signed at ${link.recovery.commit.slice(0, 7)}:`,
    ...indented(link.recovery.text),
    "    current:",
    ...indented(link.text ?? ""),
  ];
}

function indented(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `      ${line}`);
}

function isWarningOnly(evaluation: DecisionEvaluation): boolean {
  return evaluation.state === "stale" && evaluation.decision.signoff === "none";
}
