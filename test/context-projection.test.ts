import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createArtifactContextProjection,
  type DecisionContextInput,
} from "../src/context-projection.js";
import type { PremiseEvaluation } from "../src/provider.js";

test("projects live provider evidence and decision context for an artifact", () => {
  const artifact = "src/orders/update-order.ts";
  const evaluations: PremiseEvaluation[] = [
    {
      premise: {
        assertion: {
          dialect: "gherkin",
          ref: { selector: "@ORDER-007", uri: "features/orders.feature" },
        },
        description: "A dispatched order cannot be modified",
        id: "ORDER-007",
        type: "behaviour",
      },
      provider: "cucumber",
      result: {
        evidence: [
          { role: "assertion", uri: "features/orders.feature" },
          { role: "executed", uri: artifact },
        ],
        status: "established",
      },
    },
    {
      premise: {
        assertion: {
          dialect: "dependency-cruiser",
          ref: {
            selector: "ARCH-003",
            uri: ".dependency-cruiser.json",
          },
        },
        description: "Order domain code must not depend on HTTP",
        id: "ARCH-003",
        type: "architecture",
      },
      provider: "dependency-cruiser",
      result: {
        evidence: [
          { role: "assertion", uri: ".dependency-cruiser.json" },
          { role: "subject", uri: artifact },
        ],
        status: "established",
      },
    },
  ];
  const decisions: DecisionContextInput[] = [
    {
      drivers: [{ id: "ARCH-003", kind: "premise" }],
      id: "AUTH-004",
      source: { selector: "AUTH-004", uri: "decisions/AUTH-004.decision" },
      state: {
        reasons: [
          {
            id: "ARCH-003",
            kind: "premise",
            message: "Supporting premise ARCH-003 failed.",
            status: "failed",
          },
        ],
        status: "reconsider",
      },
      title: "Authenticate payment updates",
    },
  ];

  const projection = createArtifactContextProjection({
    artifact,
    decisions,
    evaluations,
  });

  assert.deepEqual(projection, {
    artifact,
    knowledge: [
      {
        description: "Order domain code must not depend on HTTP",
        dialect: "dependency-cruiser",
        id: "ARCH-003",
        kind: "premise",
        premiseType: "architecture",
        provider: "dependency-cruiser",
        source: {
          selector: "ARCH-003",
          uri: ".dependency-cruiser.json",
        },
        state: { status: "established" },
      },
      {
        description: "A dispatched order cannot be modified",
        dialect: "gherkin",
        id: "ORDER-007",
        kind: "premise",
        premiseType: "behaviour",
        provider: "cucumber",
        source: { selector: "@ORDER-007", uri: "features/orders.feature" },
        state: { status: "established" },
      },
      {
        description: "Authenticate payment updates",
        id: "AUTH-004",
        kind: "decision",
        source: {
          selector: "AUTH-004",
          uri: "decisions/AUTH-004.decision",
        },
        state: {
          reasons: [
            {
              id: "ARCH-003",
              kind: "premise",
              message: "Supporting premise ARCH-003 failed.",
              status: "failed",
            },
          ],
          status: "reconsider",
        },
      },
    ],
  });
});

test("projects decisions related directly to an artifact without provider premises", () => {
  const projection = createArtifactContextProjection({
    artifact: "src/orders/update-order.ts",
    decisions: [
      {
        drivers: [{ id: "src/orders/update-order.ts", kind: "source" }],
        id: "ORDER-004",
        source: {
          selector: "ORDER-004",
          uri: "decisions/ORDER-004.decision",
        },
        state: { status: "established" },
        title: "Persist order updates",
      },
    ],
    evaluations: [],
  });

  assert.deepEqual(
    projection.knowledge.map(({ id, kind }) => ({ id, kind })),
    [{ id: "ORDER-004", kind: "decision" }],
  );
});
