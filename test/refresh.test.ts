import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateRepository } from "../src/evaluate.js";
import { refreshDecision } from "../src/refresh.js";
import { assertConfigurationError, assertRefused } from "./support/assertions.js";
import { runPremise } from "./support/cli.js";
import { createDecision, decisionProject, noDbFingerprint } from "./support/fixtures.js";
import { createProject } from "./support/project.js";

const decisionUri = "decisions/ADR-001.yaml";

const handWritten = [
  "id: ADR-001",
  "# Keeps the database client out of src",
  "title: Keep the database out",
  "status: accepted",
  "date: 2026-10-25",
  "context: |",
  "  Domain code is tested without infrastructure.",
  "options:",
  "  - name: Ports only",
  "decision: Ports only",
  "because:",
  "  - Domain tests run without a database.",
  "consequences: []",
  "enforced_by:",
  "  - check: no-db",
  "",
].join("\n");

async function readDecision(projectDirectory: string): Promise<string> {
  return readFile(join(projectDirectory, decisionUri), "utf8");
}

test("refresh writes fingerprints so the decision holds", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: decisionProject({ decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db" }] })] }),
  });

  const result = await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  assert.deepEqual(result, { uri: decisionUri, fingerprints: [{ check: "no-db", fingerprint: noDbFingerprint }] });
  assert.equal((await evaluateRepository({ projectDirectory })).evaluations[0]?.state, "holds");
});

test("refresh adds a fingerprint and leaves the rest of a hand-written ADR untouched", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: { ...decisionProject({ decisions: [] }), [decisionUri]: handWritten },
  });

  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  assert.equal(
    await readDecision(projectDirectory),
    handWritten.replace("  - check: no-db\n", `  - check: no-db\n    fingerprint: ${noDbFingerprint}\n`),
  );
});

test("refresh replaces an existing fingerprint in place", async (t) => {
  const stale = `sha256:${"0".repeat(64)}`;
  const signed = handWritten.replace("  - check: no-db\n", `  - check: no-db\n    fingerprint: ${stale}\n`);
  const projectDirectory = await createProject({ t, files: { ...decisionProject({ decisions: [] }), [decisionUri]: signed } });

  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  assert.equal(await readDecision(projectDirectory), signed.replace(stale, noDbFingerprint));
});

test("refresh refuses while a linked check fails and leaves the ADR unchanged", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: { ...decisionProject({ decisions: [], violations: ["no-db"] }), [decisionUri]: handWritten },
  });

  await assertRefused({
    action: refreshDecision({ projectDirectory, decisionId: "ADR-001" }),
    pattern: /enforced_by no-db: failed \(rule violated in reports\/depcruise\.json\)/,
  });
  assert.equal(await readDecision(projectDirectory), handWritten);
});

test("refresh refuses while a linked check is unknown and its text unavailable", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: decisionProject({ decisions: [createDecision({ id: "ADR-001", supported_by: [{ check: "PAY-001" }] })] }),
  });

  await assertRefused({
    action: refreshDecision({ projectDirectory, decisionId: "ADR-001" }),
    pattern: /supported_by PAY-001: unknown \(not found in any report\), check text unavailable/,
  });
});

test("refresh refuses a decision that is not accepted", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: decisionProject({ decisions: [createDecision({ id: "ADR-001", status: "proposed" })] }),
  });

  await assertRefused({
    action: refreshDecision({ projectDirectory, decisionId: "ADR-001" }),
    pattern: /ADR-001 is proposed; only accepted decisions are refreshed/,
  });
});

test("refresh of an unknown decision is a configuration error", async (t) => {
  const projectDirectory = await createProject({ t, files: decisionProject({ decisions: [] }) });

  await assertConfigurationError({
    action: refreshDecision({ projectDirectory, decisionId: "ADR-404" }),
    pattern: /No decision ADR-404/,
  });
});

test("the refresh command prints the fingerprints it wrote and needs one ADR ID", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: decisionProject({ decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db" }] })] }),
  });

  const refreshed = runPremise({ projectDirectory, args: ["refresh", "ADR-001"] });
  const missing = runPremise({ projectDirectory, args: ["refresh"] });

  assert.equal(refreshed.status, 0);
  assert.equal(refreshed.stdout, `${decisionUri}\n  no-db ${noDbFingerprint}\n`);
  assert.equal(missing.status, 2);
});
