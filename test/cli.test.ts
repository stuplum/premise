import assert from "node:assert/strict";
import { test } from "node:test";
import { runPremise } from "./support/cli.js";
import { configFile, createDecision, decisionProject, noDbFingerprint } from "./support/fixtures.js";
import { createProject } from "./support/project.js";

test("check exits 0 when every decision holds", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: decisionProject({
      decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db", fingerprint: noDbFingerprint }] })],
    }),
  });

  const result = runPremise({ projectDirectory, args: ["check"] });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^ADR-001 holds$/m);
});

test("check exits 1 when a decision is stale", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: decisionProject({ decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db" }] })] }),
  });

  assert.equal(runPremise({ projectDirectory, args: ["check"] }).status, 1);
});

test("check exits 2 with the reason on a configuration error", async (t) => {
  const projectDirectory = await createProject({ t, files: configFile() });

  const result = runPremise({ projectDirectory, args: ["check"] });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /report reports\/unit\.xml matches no file/);
});

test("an unknown command exits 2 with usage", async (t) => {
  const projectDirectory = await createProject({ t, files: {} });

  const result = runPremise({ projectDirectory, args: ["frobnicate"] });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: premise/);
});
