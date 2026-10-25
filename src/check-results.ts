import type { Reports } from "./reports/model.js";
import { compareText } from "./text.js";

export type CheckResult =
  | { status: "passed" }
  | { status: "failed"; detail: string }
  | { status: "unknown"; detail: string };

export function resolveCheck({ id, reports }: { id: string; reports: Reports }): CheckResult {
  const cases = reports.cases.filter((testCase) => testCase.checks.includes(id));
  const rules = reports.rules.filter((rule) => rule.name === id);
  if (cases.length === 0 && rules.length === 0) {
    return { status: "unknown", detail: "not found in any report" };
  }
  const failing = cases.filter((testCase) => testCase.outcome === "failed");
  const violated = rules.filter((rule) => rule.violated);
  const failures = [
    ...(failing.length > 0 ? [`${countOf({ count: failing.length, noun: "failing case" })} in ${sourcesOf(failing)}`] : []),
    ...(violated.length > 0 ? [`rule violated in ${sourcesOf(violated)}`] : []),
  ];
  if (failures.length > 0) {
    return { status: "failed", detail: failures.join("; ") };
  }
  const skipped = cases.filter((testCase) => testCase.outcome === "skipped");
  const unknowns = [
    ...(skipped.length > 0 ? [`${countOf({ count: skipped.length, noun: "skipped case" })} in ${sourcesOf(skipped)}`] : []),
    ...[...new Set(rules.flatMap((rule) => (rule.blindReason === undefined ? [] : [rule.blindReason])))],
  ];
  if (unknowns.length > 0) {
    return { status: "unknown", detail: unknowns.join("; ") };
  }
  return { status: "passed" };
}

export function describeResult(result: CheckResult): string {
  return result.status === "passed" ? "passed" : `${result.status} (${result.detail})`;
}

function sourcesOf(items: { source: string }[]): string {
  return [...new Set(items.map((item) => item.source))].sort(compareText).join(", ");
}

function countOf({ count, noun }: { count: number; noun: string }): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
