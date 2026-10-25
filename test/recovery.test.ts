import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { checkText } from "../src/check-text.js";
import { loadConfig } from "../src/config.js";
import { fingerprintOf } from "../src/fingerprint.js";
import { recoverSignedText, type Recovery } from "../src/recovery.js";
import type { Reports } from "../src/reports/model.js";
import { currentSources } from "../src/sources.js";
import { configFile, createDecision, decisionFiles, noDbRule, type ConfigDocument } from "./support/fixtures.js";
import { commitAll } from "./support/git.js";
import { createProject, writeFiles } from "./support/project.js";

const decisionUri = "decisions/ADR-001.yaml";
const noReports: Reports = { cases: [], rules: [] };

function feature(total: string): string {
  return ["Feature: Payments", "  @PAY-001", "  Scenario: totals", "    When a payment is made", `    Then the total is ${total}`, ""].join("\n");
}

async function project({ t, config, files }: { t: TestContext; config: ConfigDocument; files: Record<string, string> }) {
  return createProject({ t, files: { ...configFile(config), ...files } });
}

async function sign({
  projectDirectory,
  check,
  reports,
}: {
  projectDirectory: string;
  check: string;
  reports: Reports;
}): Promise<{ fingerprint: string; text: string; commit: string }> {
  const config = await loadConfig({ projectDirectory });
  const text = (await checkText({ id: check, sources: await currentSources({ projectDirectory, config, reports }) })) ?? "";
  const fingerprint = fingerprintOf(text);
  await writeFiles({
    projectDirectory,
    files: decisionFiles({ decisions: [createDecision({ id: "ADR-001", supported_by: [{ check, fingerprint }] })] }),
  });
  return { fingerprint, text, commit: commitAll({ projectDirectory, message: "signed" }) };
}

async function recover({
  projectDirectory,
  check,
  fingerprint,
  reports,
}: {
  projectDirectory: string;
  check: string;
  fingerprint: string;
  reports: Reports;
}): Promise<Recovery> {
  return recoverSignedText({
    projectDirectory,
    config: await loadConfig({ projectDirectory }),
    reports,
    decisionUri,
    check,
    fingerprint,
    ref: "HEAD",
  });
}

function assertUnrecoverable({ recovery, pattern }: { recovery: Recovery; pattern: RegExp }) {
  assert.equal(recovery.status, "unrecoverable");
  assert.match(recovery.status === "unrecoverable" ? recovery.reason : "", pattern);
}

test("Gherkin text is rebuilt from the commit that signed it", async (t) => {
  const projectDirectory = await project({
    t,
    config: { gherkin: "features/**/*.feature" },
    files: { "features/payments.feature": feature("10") },
  });
  const signed = await sign({ projectDirectory, check: "PAY-001", reports: noReports });
  await writeFiles({ projectDirectory, files: { "features/payments.feature": feature("11") } });
  commitAll({ projectDirectory, message: "changed" });

  const recovery = await recover({ projectDirectory, check: "PAY-001", fingerprint: signed.fingerprint, reports: noReports });

  assert.deepEqual(recovery, { status: "recovered", commit: signed.commit, text: signed.text });
});

test("signed text is rebuilt for a project in a subdirectory of the repository", async (t) => {
  const repository = await createProject({ t, files: { "README.md": "root\n" } });
  commitAll({ projectDirectory: repository, message: "root" });
  const projectDirectory = join(repository, "packages/app");
  await writeFiles({
    projectDirectory,
    files: { ...configFile({ gherkin: "features/**/*.feature" }), "features/payments.feature": feature("10") },
  });
  const signed = await sign({ projectDirectory, check: "PAY-001", reports: noReports });
  await writeFiles({ projectDirectory, files: { "features/payments.feature": feature("11") } });

  const recovery = await recover({ projectDirectory, check: "PAY-001", fingerprint: signed.fingerprint, reports: noReports });

  assert.deepEqual(recovery, { status: "recovered", commit: signed.commit, text: signed.text });
});

test("a rule is rebuilt from the JSON dependency-cruiser config at the signing commit", async (t) => {
  const projectDirectory = await project({
    t,
    config: { dependency_cruiser_config: ".dependency-cruiser.json" },
    files: { ".dependency-cruiser.json": JSON.stringify({ forbidden: [noDbRule] }) },
  });
  const signed = await sign({ projectDirectory, check: "no-db", reports: noReports });
  await writeFiles({
    projectDirectory,
    files: { ".dependency-cruiser.json": JSON.stringify({ forbidden: [{ ...noDbRule, to: { path: "mysql" } }] }) },
  });

  const recovery = await recover({ projectDirectory, check: "no-db", fingerprint: signed.fingerprint, reports: noReports });

  assert.deepEqual(recovery, { status: "recovered", commit: signed.commit, text: signed.text });
});

test("a test file is rebuilt from the same path at the signing commit", async (t) => {
  const reports: Reports = { cases: [{ checks: ["A"], outcome: "passed", file: "test/a.test.ts", source: "r.xml" }], rules: [] };
  const projectDirectory = await project({ t, config: {}, files: { "test/a.test.ts": "expect(1);\n" } });
  const signed = await sign({ projectDirectory, check: "A", reports });
  await writeFiles({ projectDirectory, files: { "test/a.test.ts": "expect(2);\n" } });

  const recovery = await recover({ projectDirectory, check: "A", fingerprint: signed.fingerprint, reports });

  assert.deepEqual(recovery, { status: "recovered", commit: signed.commit, text: signed.text });
});

test("a fingerprint no commit added is unrecoverable", async (t) => {
  const projectDirectory = await project({ t, config: {}, files: {} });
  commitAll({ projectDirectory, message: "empty" });
  const fingerprint = fingerprintOf("x\n");
  await writeFiles({
    projectDirectory,
    files: decisionFiles({ decisions: [createDecision({ id: "ADR-001", supported_by: [{ check: "A", fingerprint }] })] }),
  });

  assertUnrecoverable({
    recovery: await recover({ projectDirectory, check: "A", fingerprint, reports: noReports }),
    pattern: /no commit reachable from HEAD adds this fingerprint to decisions\/ADR-001\.yaml/,
  });
});

test("a fingerprint whose rebuilt text differs is unrecoverable", async (t) => {
  const projectDirectory = await project({
    t,
    config: { gherkin: "features/**/*.feature" },
    files: { "features/payments.feature": feature("10") },
  });
  const fingerprint = fingerprintOf("never signed\n");
  await writeFiles({
    projectDirectory,
    files: decisionFiles({ decisions: [createDecision({ id: "ADR-001", supported_by: [{ check: "PAY-001", fingerprint }] })] }),
  });
  commitAll({ projectDirectory, message: "signed" });

  assertUnrecoverable({
    recovery: await recover({ projectDirectory, check: "PAY-001", fingerprint, reports: noReports }),
    pattern: /text rebuilt at [0-9a-f]{7} does not match the fingerprint/,
  });
});

test("a moved test file is unrecoverable", async (t) => {
  const before: Reports = { cases: [{ checks: ["A"], outcome: "passed", file: "test/old.test.ts", source: "r.xml" }], rules: [] };
  const after: Reports = { cases: [{ checks: ["A"], outcome: "passed", file: "test/new.test.ts", source: "r.xml" }], rules: [] };
  const projectDirectory = await project({ t, config: {}, files: { "test/old.test.ts": "expect(1);\n" } });
  const signed = await sign({ projectDirectory, check: "A", reports: before });
  await rm(join(projectDirectory, "test/old.test.ts"));
  await writeFiles({ projectDirectory, files: { "test/new.test.ts": "expect(1);\n" } });
  commitAll({ projectDirectory, message: "moved" });

  assertUnrecoverable({
    recovery: await recover({ projectDirectory, check: "A", fingerprint: signed.fingerprint, reports: after }),
    pattern: /no source for A at [0-9a-f]{7}/,
  });
});

test("a rule without a JSON dependency-cruiser config is unrecoverable", async (t) => {
  const reports: Reports = { cases: [], rules: [{ name: "no-db", definition: noDbRule, violated: false, source: "r.json" }] };
  const projectDirectory = await project({ t, config: {}, files: {} });
  const signed = await sign({ projectDirectory, check: "no-db", reports });

  assertUnrecoverable({
    recovery: await recover({ projectDirectory, check: "no-db", fingerprint: signed.fingerprint, reports }),
    pattern: /no source for no-db at [0-9a-f]{7}/,
  });
});

test("outside a git repository the signed text is unrecoverable", async (t) => {
  const projectDirectory = await project({ t, config: {}, files: {} });

  assertUnrecoverable({
    recovery: await recover({ projectDirectory, check: "A", fingerprint: fingerprintOf("x\n"), reports: noReports }),
    pattern: /no commit reachable from HEAD/,
  });
});
