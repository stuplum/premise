import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { discoverPremises, type DiscoveredPremise } from "../../src/provider.js";
import { createCucumberProvider } from "../../src/providers/cucumber-provider.js";

type DiscoveryWorld = {
  projectDirectory: string;
  discoveredPremises?: DiscoveredPremise[];
  discoveryError?: Error;
};

Given("the discovery feature contains:", async function (this: DiscoveryWorld, source: string) {
  await mkdir(join(this.projectDirectory, "features"), { recursive: true });
  await writeFile(join(this.projectDirectory, "features/payments.feature"), source, "utf8");
});

When("I discover the behavioural premises", async function (this: DiscoveryWorld) {
  try {
    this.discoveredPremises = await discoverPremises({
      projectDirectory: this.projectDirectory,
      providers: [createCucumberProvider({ silent: true })],
    });
  } catch (error) {
    assert.ok(error instanceof Error);
    this.discoveryError = error;
  }
});

Then(
  "discovery finds premise {string} described as {string} at line {int} column {int}",
  function (this: DiscoveryWorld, id: string, description: string, line: number, column: number) {
    assert.equal(this.discoveryError, undefined);
    assert.ok(this.discoveredPremises);
    assert.equal(this.discoveredPremises.length, 1);
    const { premise } = this.discoveredPremises[0];
    assert.equal(premise.id, id);
    assert.equal(premise.description, description);
    assert.deepEqual(premise.assertion.ref.range, {
      start: { line, column },
      end: { line, column },
    });
  },
);

Then(
  "discovery rejects {string} at line {int} column {int}",
  function (this: DiscoveryWorld, id: string, line: number, column: number) {
    assert.ok(this.discoveryError, "Expected discovery to reject the declaration");
    assert.ok(this.discoveryError.message.includes(id));
    assert.ok(this.discoveryError.message.includes(`features/payments.feature:${line}:${column}`));
  },
);
