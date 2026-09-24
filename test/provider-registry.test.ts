import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoverPremises,
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

test("premise discovery validates identities without evaluating assertions", async () => {
  let evaluated = false;
  const provider = createProvider({
    dialects: ["gherkin"],
    id: "cucumber",
    onEvaluate: () => {
      evaluated = true;
    },
    premises: [behaviourPremise],
  });

  const discoveries = await discoverPremises({
    projectDirectory: "/project",
    providers: [provider],
  });

  assert.equal(evaluated, false);
  assert.deepEqual(discoveries, [
    { premise: behaviourPremise, provider },
  ]);
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

test("prepared provider sessions isolate interleaved project evaluations", async () => {
  const provider = createProvider({
    dialects: ["gherkin"],
    id: "cucumber",
    premises: [behaviourPremise],
    projectScopedEvidence: true,
  });

  const projectA = await provider.prepare({ projectDirectory: "/project-a" });
  const projectB = await provider.prepare({ projectDirectory: "/project-b" });
  const [premiseA] = await projectA.discover();
  const [premiseB] = await projectB.discover();

  assert.deepEqual(await projectA.evaluate(premiseA), {
    evidence: [
      { role: "assertion", uri: "/project-a/features/payment.feature" },
    ],
    status: "established",
  });
  assert.deepEqual(await projectB.evaluate(premiseB), {
    evidence: [
      { role: "assertion", uri: "/project-b/features/payment.feature" },
    ],
    status: "established",
  });
});

function createProvider({
  dialects,
  id,
  onEvaluate,
  premises,
  projectScopedEvidence = false,
}: {
  dialects: string[];
  id: string;
  onEvaluate?: () => void;
  premises: Premise[];
  projectScopedEvidence?: boolean;
}): PremiseProvider {
  return {
    dialects,
    id,
    async prepare({ projectDirectory }) {
      return {
        async discover() {
          return premises;
        },
        async evaluate(premise) {
          onEvaluate?.();
          return {
            evidence: [
              {
                role: "assertion",
                uri: projectScopedEvidence
                  ? `${projectDirectory}/${premise.assertion.ref.uri}`
                  : premise.assertion.ref.uri,
              },
            ],
            status: "established",
          };
        },
      };
    },
  };
}
