import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluatePremises,
  type Premise,
  type PremiseProvider,
} from "../src/provider.js";

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

test("evaluations retain independent premise, dialect, and provider identities", async () => {
  const provider = createProvider({
    dialects: ["gherkin"],
    id: "cucumber",
    premises: [behaviourPremise],
  });

  const [evaluation] = await evaluatePremises({
    projectDirectory: "/project",
    providers: [provider],
  });

  assert.deepEqual(evaluation, {
    premise: behaviourPremise,
    provider: "cucumber",
    result: {
      evidence: [{ role: "assertion", uri: "features/payment.feature" }],
      status: "established",
    },
  });
});

test("a provider cannot return a premise in a dialect it does not support", async () => {
  const provider = createProvider({
    dialects: ["dependency-cruiser"],
    id: "dependency-cruiser",
    premises: [behaviourPremise],
  });

  await assert.rejects(
    evaluatePremises({
      projectDirectory: "/project",
      providers: [provider],
    }),
    /Provider dependency-cruiser does not support dialect gherkin for premise PAY-001/,
  );
});

test("premise identities must be unique across providers", async () => {
  const cucumber = createProvider({
    dialects: ["gherkin"],
    id: "cucumber",
    premises: [behaviourPremise],
  });
  const otherCucumber = createProvider({
    dialects: ["gherkin"],
    id: "other-cucumber",
    premises: [behaviourPremise],
  });

  await assert.rejects(
    evaluatePremises({
      projectDirectory: "/project",
      providers: [cucumber, otherCucumber],
    }),
    /Duplicate premise PAY-001 from providers cucumber and other-cucumber/,
  );
});

function createProvider({
  dialects,
  id,
  premises,
}: {
  dialects: string[];
  id: string;
  premises: Premise[];
}): PremiseProvider {
  return {
    dialects,
    id,
    async discover() {
      return premises;
    },
    async evaluate(premise) {
      return {
        evidence: [{ role: "assertion", uri: premise.assertion.ref.uri }],
        status: "established",
      };
    },
  };
}
