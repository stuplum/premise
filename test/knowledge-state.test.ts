import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledgeStateFromEvaluation } from "../src/knowledge-state.js";
import type { PremiseEvaluation } from "../src/provider.js";

test("a failed provider evaluation remains failed rather than reconsider", () => {
  const state = knowledgeStateFromEvaluation(
    evaluation({
      diagnostics: [{ message: "Domain imports HTTP" }],
      status: "failed",
    }),
  );

  assert.deepEqual(state, {
    diagnostics: [{ message: "Domain imports HTTP" }],
    status: "failed",
  });
});

test("an unavailable provider evaluation remains unknown", () => {
  const state = knowledgeStateFromEvaluation(
    evaluation({ reason: "No step definitions matched", status: "unknown" }),
  );

  assert.deepEqual(state, {
    reason: "No step definitions matched",
    status: "unknown",
  });
});

function evaluation(
  result: PremiseEvaluation["result"],
): PremiseEvaluation {
  return {
    premise: {
      assertion: {
        dialect: "dependency-cruiser",
        ref: { selector: "ARCH-003", uri: ".dependency-cruiser.json" },
      },
      description: "Domain code must not depend on HTTP",
      id: "ARCH-003",
      type: "architecture",
    },
    provider: "dependency-cruiser",
    result,
  };
}
