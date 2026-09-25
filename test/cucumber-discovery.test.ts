import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { discoverPremises } from "../src/provider.js";
import { createCucumberProvider } from "../src/providers/cucumber-provider.js";

const declarations = [
  {
    kind: "Feature",
    source: "@PAY-001\nFeature: Take payments\n  Scenario: Pay\n    Then paid\n  Scenario: Retry\n    Then paid\n",
    description: "Take payments",
    line: 2,
    column: 1,
  },
  {
    kind: "Rule",
    source: "Feature: Payments\n  @PAY-001\n  Rule: Accept valid payments\n    Scenario: Pay\n      Then paid\n    Scenario: Retry\n      Then paid\n",
    description: "Accept valid payments",
    line: 3,
    column: 3,
  },
  {
    kind: "Scenario",
    source: "Feature: Payments\n  @PAY-001\n  Scenario: Accept a payment\n    Then paid\n",
    description: "Accept a payment",
    line: 3,
    column: 3,
  },
  {
    kind: "Scenario Outline",
    source: "Feature: Payments\n  @PAY-001\n  Scenario Outline: Accept <method>\n    Then paid with <method>\n    Examples: Methods\n      | method |\n      | card   |\n      | cash   |\n",
    description: "Accept <method>",
    line: 3,
    column: 3,
  },
  {
    kind: "Examples",
    source: "Feature: Payments\n  Scenario Outline: Accept <method>\n    Then paid with <method>\n    @PAY-001\n    Examples: Supported methods\n      | method |\n      | card   |\n      | cash   |\n    Examples: Other methods\n      | method |\n      | cheque |\n",
    description: "Supported methods",
    line: 5,
    column: 5,
  },
];

for (const { kind, source, description, line, column } of declarations) {
  test(`discovers a premise at its tagged ${kind} rather than its inherited scenarios`, async (t) => {
    const premises = await discoverSource(t, source);
    assert.equal(premises.length, 1);
    const { premise } = premises[0];
    assert.equal(premise.id, "PAY-001");
    assert.equal(premise.description, description);
    assert.equal(premise.assertion.ref.selector, "@PAY-001");
    assert.equal(premise.assertion.ref.uri, "features/payments.feature");
    assert.deepEqual(premise.assertion.ref.range, {
      start: { line, column },
      end: { line, column },
    });
  });
}

test("inherits a feature identity through rules, outlines and examples without redeclaring it", async (t) => {
  const premises = await discoverSource(t, [
    "@PAY-001",
    "Feature: Payment methods",
    "  Rule: Supported methods",
    "    Scenario Outline: Accept <method>",
    "      Then paid with <method>",
    "      Examples: Cards",
    "        | method |",
    "        | credit |",
    "        | debit  |",
    "      Examples: Cash",
    "        | method |",
    "        | cash   |",
  ].join("\n"));
  assert.deepEqual(premises.map(({ premise }) => ({ id: premise.id, description: premise.description })), [
    { id: "PAY-001", description: "Payment methods" },
  ]);
});

for (const { placement, source, locations } of [
  {
    placement: "separate scenarios",
    source: "Feature: Payments\n  @PAY-001\n  Scenario: Pay\n    Then paid\n  @PAY-001\n  Scenario: Retry\n    Then paid\n",
    locations: ["2:3", "5:3"],
  },
  {
    placement: "a feature and its scenario",
    source: "@PAY-001\nFeature: Payments\n  @PAY-001\n  Scenario: Pay\n    Then paid\n",
    locations: ["1:1", "3:3"],
  },
  {
    placement: "the same node twice",
    source: "@PAY-001 @PAY-001\nFeature: Payments\n  Scenario: Pay\n    Then paid\n",
    locations: ["1:1", "1:10"],
  },
]) {
  test(`rejects an identity declared on ${placement} with both declaration locations`, async (t) => {
    await assert.rejects(discoverSource(t, source), (error: Error) => {
      assert.match(error.message, /Duplicate.*PAY-001/i);
      for (const location of locations) {
        assert.ok(error.message.includes(`features/payments.feature:${location}`));
      }
      return true;
    });
  });
}

for (const { kind, source } of [
  { kind: "Feature", source: "@PAY-001\nFeature: Payments\n" },
  { kind: "Rule", source: "Feature: Payments\n  @PAY-001\n  Rule: Payments\n" },
  { kind: "Scenario", source: "Feature: Payments\n  @PAY-001\n  Scenario: Payments\n" },
  { kind: "Scenario Outline", source: "Feature: Payments\n  @PAY-001\n  Scenario Outline: Payments\n    Then paid with <method>\n    Examples: No methods\n      | method |\n" },
  { kind: "Examples", source: "Feature: Payments\n  Scenario Outline: Payments\n    Then paid with <method>\n    @PAY-001\n    Examples: No methods\n      | method |\n    Examples: Other methods\n      | method |\n      | card   |\n" },
]) {
  test(`rejects a tagged ${kind} without executable scenarios or rows`, async (t) => {
    await assert.rejects(discoverSource(t, source), (error: Error) => {
      assert.match(error.message, /PAY-001/);
      assert.match(error.message, /features\/payments\.feature:\d+:\d+/);
      assert.match(error.message, /no executable/i);
      return true;
    });
  });
}

test("reports invalid tag placement as a located Gherkin parse error", async (t) => {
  await assert.rejects(discoverSource(t, "Feature: Payments\n  @PAY-001\n  Background: Prepare\n    Given ready\n  Scenario: Pay\n    Then paid\n"), (error: Error) => {
    assert.match(error.message, /Gherkin/i);
    assert.match(error.message, /features\/payments\.feature:3:/);
    assert.match(error.message, /Background/);
    return true;
  });
});

test("does not discover IDs in comments, descriptions, doc strings or table cells", async (t) => {
  const premises = await discoverSource(t, [
    "# @FAKE-001",
    "Feature: Payments",
    "  Text about @FAKE-002",
    "  @PAY-001",
    "  Scenario: Pay",
    "    Given a note:",
    '      """',
    "      @FAKE-003",
    '      """',
    "    Then paid:",
    "      | @FAKE-004 |",
  ].join("\n"));
  assert.deepEqual(premises.map(({ premise }) => premise.id), ["PAY-001"]);
});

test("describes untagged features using their Gherkin name without inventing a stable ID", async (t) => {
  const [{ premise }] = await discoverSource(t, "Feature: Take payments\n  Scenario: Pay\n    Then paid\n");
  assert.equal(premise.id, "cucumber:features/payments.feature");
  assert.equal(premise.description, "Take payments");
  assert.equal(premise.assertion.ref.selector, undefined);
});

async function discoverSource(t: TestContext, source: string) {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-discovery-"));
  t.after(() => rm(projectDirectory, { recursive: true, force: true }));
  await mkdir(join(projectDirectory, "features"));
  await writeFile(join(projectDirectory, "features/payments.feature"), source, "utf8");
  return discoverPremises({
    projectDirectory,
    providers: [createCucumberProvider({ silent: true })],
  });
}
