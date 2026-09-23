import type { DecisionAst } from "./decision-model.js";

export function validateDecision(decision: DecisionAst): void {
  if (decision.supersedes?.id === decision.id) {
    throw new Error(`Decision ${decision.id} cannot supersede itself`);
  }
}
