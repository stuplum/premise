import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  parseDecision,
  type DecisionAst,
  type DecisionDriver,
} from "../../src/index.js";

type DecisionParserWorld = {
  decision?: DecisionAst;
  decisionSource?: string;
  parseError?: Error;
};

Given(
  "the decision source:",
  function (this: DecisionParserWorld, source: string) {
    this.decisionSource = source;
  },
);

When("the decision is parsed", function (this: DecisionParserWorld) {
  try {
    this.decision = parseDecision(requiredDecisionSource(this));
  } catch (error) {
    this.parseError = error instanceof Error ? error : new Error(String(error));
  }
});

Then(
  "the parsed decision is:",
  function (
    this: DecisionParserWorld,
    expectedRows: { raw: () => string[][] },
  ) {
    const decision = requiredDecision(this);
    const expected = Object.fromEntries(expectedRows.raw());

    assert.equal(decision.id, expected.id);
    assert.equal(decision.title, expected.title);
    assert.equal(decision.type, "Decision");
    assert.equal(decision.choice.text, expected.choice);
    assert.equal(decision.rationale.text, expected.rationale);
    assert.equal(decision.supersedes?.id, expected.supersedes);
  },
);

Then(
  "the decision starts at line {int} column {int}",
  function (this: DecisionParserWorld, line: number, column: number) {
    assert.deepEqual(requiredDecision(this).location, { line, column });
  },
);

Then(
  "the choice starts at line {int} column {int}",
  function (this: DecisionParserWorld, line: number, column: number) {
    assert.deepEqual(requiredDecision(this).choice.location, { line, column });
  },
);

Then(
  "its drivers are:",
  function (
    this: DecisionParserWorld,
    expectedRows: { hashes: () => DecisionDriver[] },
  ) {
    assert.deepEqual(
      requiredDecision(this).drivers.map(({ id, kind }) => ({ id, kind })),
      expectedRows.hashes(),
    );
  },
);

Then(
  "its accepted costs are:",
  function (this: DecisionParserWorld, expectedRows: { raw: () => string[][] }) {
    assert.deepEqual(
      requiredDecision(this).acceptedCosts.map(({ text }) => text),
      expectedRows.raw().flat(),
    );
  },
);

Then("the decision has no accepted costs", function (this: DecisionParserWorld) {
  assert.deepEqual(requiredDecision(this).acceptedCosts, []);
});

Then(
  "the decision does not supersede another decision",
  function (this: DecisionParserWorld) {
    assert.equal(requiredDecision(this).supersedes, undefined);
  },
);

Then(
  "parsing fails with {string}",
  function (this: DecisionParserWorld, expectedMessage: string) {
    assert.match(requiredParseError(this).message, new RegExp(expectedMessage));
  },
);

function requiredDecision(world: DecisionParserWorld): DecisionAst {
  assert.equal(world.parseError, undefined, world.parseError?.message);
  assert.ok(world.decision, "Expected a parsed decision");
  return world.decision;
}

function requiredDecisionSource(world: DecisionParserWorld): string {
  assert.ok(world.decisionSource, "Expected decision source");
  return world.decisionSource.replaceAll("\\n", "\n");
}

function requiredParseError(world: DecisionParserWorld): Error {
  assert.ok(world.parseError, "Expected parsing to fail");
  return world.parseError;
}
