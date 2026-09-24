import type { Diagnostic, PremiseEvaluation } from "./provider.js";

export type ReconsiderationReason = {
  id: string;
  kind: "decision" | "premise" | "review";
  message: string;
  status: "failed" | "reconsider" | "stale" | "unknown";
};

export type KnowledgeState =
  | { status: "established" }
  | { diagnostics: Diagnostic[]; status: "failed" }
  | { reason: string; status: "unknown" }
  | { reasons: ReconsiderationReason[]; status: "reconsider" };

export function knowledgeStateFromEvaluation({
  result,
}: PremiseEvaluation): Exclude<KnowledgeState, { status: "reconsider" }> {
  if (result.status === "established") {
    return { status: "established" };
  }
  if (result.status === "unknown") {
    return { reason: result.reason, status: "unknown" };
  }
  return { diagnostics: result.diagnostics, status: "failed" };
}
