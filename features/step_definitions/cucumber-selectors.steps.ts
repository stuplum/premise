import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Given, Then } from "@cucumber/cucumber";
import type { SpawnSyncReturns } from "node:child_process";

type SelectorWorld = {
  projectDirectory: string;
  result?: SpawnSyncReturns<string>;
};

Given("two scenario premises exercise separate artifacts in one feature", async function (this: SelectorWorld) {
  const cucumberApi = pathToFileURL(resolve("src/cucumber.ts")).href;
  const files = {
    "features/payments.feature": `Feature: Payments
  @PAY-001
  Scenario: Take a payment
    When a payment is taken

  @PAY-002
  Scenario: Cancel a payment
    When a payment is cancelled
`,
    "src/payment.ts": "export function payment() { return 'paid'; }",
    "src/cancellation.ts": "export function cancellation() { return 'cancelled'; }",
    "features/step_definitions/payments.steps.ts": `import { When } from ${JSON.stringify(cucumberApi)};
import { payment } from '../../src/payment.ts';
import { cancellation } from '../../src/cancellation.ts';
When('a payment is taken', () => { payment(); });
When('a payment is cancelled', () => { cancellation(); });
`,
  };
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const destination = join(this.projectDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }));
});

Then("context excludes premise {string}", function (this: SelectorWorld, id: string) {
  assert.ok(this.result);
  assert.equal(`${this.result.stdout}${this.result.stderr}`.includes(id), false);
});
