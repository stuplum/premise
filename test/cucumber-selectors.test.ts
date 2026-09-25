import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { createCucumberProvider } from "../src/providers/cucumber-provider.js";

const cucumberApi = pathToFileURL(resolve("src/cucumber.ts")).href;

test("separate premises retain independent outcomes and execution evidence with a shared background", async (t) => {
  const projectDirectory = await createProject(t, {
    feature: `Feature: Payments
  Background:
    Given a shared account

  @PAY-001
  Scenario: Take a payment
    When a payment is taken

  @PAY-002
  Scenario: Cancel a payment
    When a payment is cancelled
    Then cancellation fails
`,
    sources: {
      "src/account.ts": "export function account() { return 'account'; }",
      "src/payment.ts": "export function payment() { return 'paid'; }",
      "src/cancellation.ts": "export function cancellation() { return 'cancelled'; }",
    },
    steps: `import { Given, When, Then } from ${JSON.stringify(cucumberApi)};
import { account } from '../../src/account.ts';
import { payment } from '../../src/payment.ts';
import { cancellation } from '../../src/cancellation.ts';
Given('a shared account', () => { account(); });
When('a payment is taken', () => { payment(); });
When('a payment is cancelled', () => { cancellation(); });
Then('cancellation fails', () => { throw new Error('cancellation rejected'); });
`,
  });
  const session = await createCucumberProvider({ silent: true }).prepare({ projectDirectory });
  const premises = await session.discover();
  assert.deepEqual(premises.map(({ id, assertion }) => [id, assertion.ref.selector]), [
    ["PAY-001", "@PAY-001"],
    ["PAY-002", "@PAY-002"],
  ]);
  const paymentResult = await session.evaluate(premises[0]);
  const cancellationResult = await session.evaluate(premises[1]);
  assert.equal(paymentResult.status, "established");
  assert.equal(cancellationResult.status, "failed");
  assert.notEqual(paymentResult.status, "unknown");
  assert.notEqual(cancellationResult.status, "unknown");
  if (paymentResult.status === "unknown" || cancellationResult.status === "unknown") return;
  assert.deepEqual(paymentResult.evidence?.filter(({ role }) => role === "executed").map(({ uri }) => uri).sort(), ["src/account.ts", "src/payment.ts"]);
  assert.deepEqual(cancellationResult.evidence?.filter(({ role }) => role === "executed").map(({ uri }) => uri).sort(), ["src/account.ts", "src/cancellation.ts"]);
});

test("inherited feature premises include shared scenarios without broadening a scenario premise", async (t) => {
  const projectDirectory = await createProject(t, {
    feature: `@ALL-001
Feature: Shared execution
  @ONE-001
  Scenario: Establish the narrower claim
    Then this claim holds

  Scenario: Fail the broader claim
    Then this claim fails
`,
    steps: `import { Then } from ${JSON.stringify(cucumberApi)};
Then('this claim holds', () => {});
Then('this claim fails', () => { throw new Error('claim failed'); });
`,
  });
  const session = await createCucumberProvider({ silent: true }).prepare({ projectDirectory });
  const premises = await session.discover();
  const broad = premises.find(({ id }) => id === "ALL-001");
  const narrow = premises.find(({ id }) => id === "ONE-001");
  assert.ok(broad);
  assert.ok(narrow);
  assert.equal((await session.evaluate(narrow)).status, "established");
  assert.equal((await session.evaluate(broad)).status, "failed");
});

test("rule and outline premises inherit examples while an examples premise selects only its own rows", async (t) => {
  const projectDirectory = await createProject(t, {
    feature: `Feature: Example scopes
  @RULE-001
  Rule: Validate payments
    Background:
      Given the payment rule is active

    @FLOW-001
    Scenario Outline: Submit a payment
      Then the amount <amount> is valid

      @VALID-001
      Examples: Positive amounts
        | amount |
        | 10     |
        | 20     |

      @INVALID-001
      Examples: Invalid amounts
        | amount |
        | -1     |

  Rule: Unrelated rule
    Scenario: Unrelated missing step
      Then this unrelated step is not defined
`,
    steps: `import assert from 'node:assert/strict';
import { Given, Then } from ${JSON.stringify(cucumberApi)};
Given('the payment rule is active', function () { this.active = true; });
Then('the amount {int} is valid', function (amount) { assert.equal(this.active, true); assert.ok(amount > 0); });
`,
  });
  const session = await createCucumberProvider({ silent: true }).prepare({ projectDirectory });
  const premises = await session.discover();
  for (const [id, status] of [["VALID-001", "established"], ["INVALID-001", "failed"], ["FLOW-001", "failed"], ["RULE-001", "failed"]]) {
    const premise = premises.find((candidate) => candidate.id === id);
    assert.ok(premise, `Missing ${id}`);
    const result = await session.evaluate(premise);
    assert.equal(result.status, status, id);
    if (result.status === "failed") {
      assert.ok(result.diagnostics.every(({ message }) => !message.includes("could not load")), id);
    }
  }
});

test("a single scenario premise excludes unrelated scenarios during both loading and execution", async (t) => {
  const projectDirectory = await createProject(t, {
    feature: `Feature: Selected scenario
  @ONE-001
  Scenario: Tagged claim
    Then this claim holds

  Scenario: Unrelated scenario
    Then this unrelated step is not defined
`,
    steps: `import { Then } from ${JSON.stringify(cucumberApi)};
Then('this claim holds', () => {});
`,
  });
  const session = await createCucumberProvider({ silent: true }).prepare({ projectDirectory });
  const [premise] = await session.discover();
  assert.equal((await session.evaluate(premise)).status, "established");
});

async function createProject(t: TestContext, { feature, sources = {}, steps }: {
  feature: string;
  sources?: Record<string, string>;
  steps: string;
}) {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-selectors-"));
  t.after(() => rm(projectDirectory, { recursive: true, force: true }));
  const files = {
    ...sources,
    "features/payments.feature": feature,
    "features/step_definitions/payments.steps.ts": steps,
  };
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const destination = join(projectDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }));
  return projectDirectory;
}
