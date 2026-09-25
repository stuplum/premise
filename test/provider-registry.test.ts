import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoverPremises,
  evaluatePremises,
  type EvaluationResult,
  type Premise,
  type PremiseProvider,
} from "../src/provider.js";
import { createArtifactContextProjection } from "../src/context-projection.js";

const behaviourPremise: Premise = {
  assertion: {
    dialect: "gherkin",
    ref: {
      selector: "@PAY-001",
      uri: "features/payment.feature",
    },
  },
  description: "A valid payment is accepted",
  id: "PAY-001",
  type: "behaviour",
};

for (const [field, value] of [
  ["id", "other-cucumber"],
  ["id", "Acme:runner"],
  ["id", "acme:runner:extra"],
  ["id", "acme:runner\n"],
  ["dialect", "Gherkin"],
  ["dialect", "acme:custom_schema"],
  ["dialect", "acme:"],
  ["dialect", "acme:-schema"],
]) {
  test(`rejects invalid provider ${field} ${JSON.stringify(value)} before preparing any provider`, async () => {
    let prepared = false;
    const first = createProvider({ onPrepare: () => { prepared = true; }, premises: [] });
    const invalid = createProvider({
      dialects: field === "dialect" ? [value] : ["gherkin"],
      id: field === "id" ? value : "acme:runner",
      premises: [],
    });

    await assert.rejects(
      discoverPremises({ projectDirectory: "/project", providers: [first, invalid] }),
      /Invalid (provider ID|dialect)/,
    );
    assert.equal(prepared, false);
  });
}

for (const [field, value] of [
  ["type", "behavior"],
  ["type", "acme:data--quality"],
  ["dialect", "Gherkin"],
]) {
  test(`rejects invalid discovered ${field} before evaluating any premise`, async () => {
    let evaluated = false;
    const first = createProvider({ onEvaluate: () => { evaluated = true; } });
    const invalidPremise: Premise = {
      ...behaviourPremise,
      id: "PAY-002",
      ...(field === "type"
        ? { type: value }
        : { assertion: { ...behaviourPremise.assertion, dialect: value } }),
    };

    await assert.rejects(
      evaluatePremises({
        projectDirectory: "/project",
        providers: [first, createProvider({ id: "acme:runner", premises: [invalidPremise] })],
      }),
      /Invalid (premise type|dialect)/,
    );
    assert.equal(evaluated, false);
  });
}

for (const status of ["established", "failed"] as const) {
  test(`rejects ambiguous evidence roles in ${status} results`, async () => {
    const provider = createProvider({
      result: {
        diagnostics: [],
        evidence: [{ role: "execution", uri: "src/payment.ts" }],
        status,
      },
    });

    await assert.rejects(
      evaluatePremises({ projectDirectory: "/project", providers: [provider] }),
      /Invalid evidence role/,
    );
  });
}

test("projects third-party vocabulary without confusing a namespaced assertion role with the canonical role", async () => {
  const provider = createProvider({
    dialects: ["shared-vocabulary:payment-schema"],
    id: "acme:payment-checker",
    premises: [{
      ...behaviourPremise,
      assertion: {
        dialect: "shared-vocabulary:payment-schema",
        ref: { selector: "#/Payment", uri: "schema/Payment.json" },
      },
      type: "finance:payment-policy",
    }],
    result: {
      evidence: [
        { role: "assertion", uri: "schema/Payment.json" },
        { role: "shared-vocabulary:assertion", uri: "src/payment.ts" },
      ],
      status: "established",
    },
  });
  const evaluations = await evaluatePremises({ projectDirectory: "/project", providers: [provider] });
  const projection = createArtifactContextProjection({
    artifact: "src/payment.ts",
    decisions: [],
    evaluations,
  });

  assert.deepEqual(projection.knowledge, [{
    description: "A valid payment is accepted",
    dialect: "shared-vocabulary:payment-schema",
    id: "PAY-001",
    kind: "premise",
    premiseType: "finance:payment-policy",
    provider: "acme:payment-checker",
    source: { selector: "#/Payment", uri: "schema/Payment.json" },
    state: { status: "established" },
  }]);
  assert.deepEqual(createArtifactContextProjection({
    artifact: "schema/Payment.json",
    decisions: [],
    evaluations,
  }).knowledge, []);
});

test("premise discovery does not evaluate assertions", async () => {
  let evaluated = false;
  await discoverPremises({
    projectDirectory: "/project",
    providers: [createProvider({ onEvaluate: () => { evaluated = true; } })],
  });
  assert.equal(evaluated, false);
});

test("a provider cannot return a premise in a dialect it does not support", async () => {
  await assert.rejects(
    evaluatePremises({
      projectDirectory: "/project",
      providers: [createProvider({ dialects: ["dependency-cruiser"], id: "dependency-cruiser" })],
    }),
    /does not support dialect/,
  );
});

test("premise identities must be unique across providers", async () => {
  await assert.rejects(
    evaluatePremises({
      projectDirectory: "/project",
      providers: [createProvider(), createProvider({ id: "acme:other-cucumber" })],
    }),
    /Duplicate premise/,
  );
});

function createProvider({
  dialects = ["gherkin"],
  id = "cucumber",
  onEvaluate,
  onPrepare,
  premises = [behaviourPremise],
  result = { status: "established" },
}: {
  dialects?: string[];
  id?: string;
  onEvaluate?: () => void;
  onPrepare?: () => void;
  premises?: Premise[];
  result?: EvaluationResult;
} = {}): PremiseProvider {
  return {
    dialects,
    id,
    async prepare() {
      onPrepare?.();
      return {
        async discover() {
          return premises;
        },
        async evaluate() {
          onEvaluate?.();
          return result;
        },
      };
    },
  };
}
