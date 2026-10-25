import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { checkText } from "../src/check-text.js";
import { loadConfig } from "../src/config.js";
import { fingerprintOf } from "../src/fingerprint.js";
import type { Reports } from "../src/reports/model.js";
import { currentSources } from "../src/sources.js";
import { assertConfigurationError } from "./support/assertions.js";
import { configFile, type ConfigDocument } from "./support/fixtures.js";
import { createProject } from "./support/project.js";

const payments = [
  "@PAY-001",
  "Feature: Payments",
  "",
  "  Background:",
  "    Given a ledger",
  "",
  "  Scenario: sorted results",
  "    When results are listed",
  "    Then they are sorted by date",
  "",
  "  @PAY-002",
  "  Scenario Outline: totals",
  "    When <count> payments are made",
  "    Then the total is <total>",
  "",
  "    Examples:",
  "      | count | total |",
  "      | 1     | 10    |",
  "",
].join("\n");

const emptyReports: Reports = { cases: [], rules: [] };

async function textFor({
  t,
  id,
  files,
  reports = emptyReports,
  config = { gherkin: "features/**/*.feature" },
}: {
  t: TestContext;
  id: string;
  files: Record<string, string>;
  reports?: Reports;
  config?: ConfigDocument;
}) {
  const projectDirectory = await createProject({ t, files: { ...configFile(config), ...files } });
  const sources = await currentSources({ projectDirectory, config: await loadConfig({ projectDirectory }), reports });
  return checkText({ id, sources });
}

function reportRule(definition: Record<string, unknown>): Reports {
  return {
    cases: [],
    rules: [{ name: String(definition.name), definition: definition as { name: string }, violated: false, source: "r.json" }],
  };
}

test("a fingerprint is the sha256 of the text", () => {
  assert.equal(fingerprintOf("abc\n"), "sha256:edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb");
});

test("a tagged pickle includes background steps and example values", async (t) => {
  const text = await textFor({ t, id: "PAY-002", files: { "features/payments.feature": payments } });

  assert.equal(
    text,
    [
      "pickle features/payments.feature",
      '{"text":"a ledger","type":"Context"}',
      '{"text":"1 payments are made","type":"Action"}',
      '{"text":"the total is 10","type":"Outcome"}',
      "",
    ].join("\n"),
  );
});

test("a feature tag selects every scenario it contains", async (t) => {
  const text = await textFor({ t, id: "PAY-001", files: { "features/payments.feature": payments } });

  assert.equal(text?.split("\n").filter((line) => line.startsWith("pickle ")).length, 2);
});

test("formatting, comments and scenario names do not change the text", async (t) => {
  const reformatted = payments
    .replace("Scenario: sorted results", "Scenario:   results come back in order")
    .replace("    When results are listed", "  # listing\n        When   results are listed");

  const original = await textFor({ t, id: "PAY-001", files: { "features/payments.feature": payments } });
  const changed = await textFor({ t, id: "PAY-001", files: { "features/payments.feature": reformatted } });

  assert.equal(changed, original);
});

test("changing a step or an example value changes the text", async (t) => {
  const original = await textFor({ t, id: "PAY-002", files: { "features/payments.feature": payments } });
  const step = await textFor({
    t,
    id: "PAY-002",
    files: { "features/payments.feature": payments.replace("the total is", "the balance is") },
  });
  const example = await textFor({
    t,
    id: "PAY-002",
    files: { "features/payments.feature": payments.replace("| 1     | 10    |", "| 1     | 11    |") },
  });

  assert.notEqual(step, original);
  assert.notEqual(example, original);
});

test("table cells and doc strings cannot be confused with other table shapes or steps", async (t) => {
  const table = (rows: string[]) =>
    ["Feature: Import", "  @IMP-001", "  Scenario: rows", "    Given these rows", ...rows.map((row) => `      ${row}`), ""].join("\n");
  const docString = (lines: string[]) =>
    ["Feature: Import", "  @IMP-001", "  Scenario: body", "    Given this body", '      """', ...lines.map((line) => `      ${line}`), '      """', ""].join("\n");
  const textOf = (feature: string) => textFor({ t, id: "IMP-001", files: { "features/import.feature": feature } });

  assert.notEqual(await textOf(table(["| a | b |"])), await textOf(table(["| a \\| b |"])));
  assert.notEqual(
    await textOf(docString(["Action c"])),
    await textOf(["Feature: Import", "  @IMP-001", "  Scenario: body", "    Given this body", "    When c", ""].join("\n")),
  );
});

test("doc strings and data tables are part of the text", async (t) => {
  const feature = [
    "Feature: Import",
    "  @IMP-001",
    "  Scenario: rows",
    "    Given these rows",
    "      | a | b |",
    "      | 1 | 2 |",
    "    Then the body is",
    '      """',
    "      hello",
    "      world",
    '      """',
    "",
  ].join("\n");

  const text = await textFor({ t, id: "IMP-001", files: { "features/import.feature": feature } });

  assert.equal(
    text,
    [
      "pickle features/import.feature",
      '{"rows":[["a","b"],["1","2"]],"text":"these rows","type":"Context"}',
      '{"docString":"hello\\nworld","text":"the body is","type":"Outcome"}',
      "",
    ].join("\n"),
  );
});

test("a report rule's text ignores key order", async (t) => {
  const plain = await textFor({
    t,
    id: "no-db",
    files: {},
    reports: reportRule({ name: "no-db", severity: "error", from: { path: "^src" }, to: { path: "pg" } }),
  });
  const reordered = await textFor({
    t,
    id: "no-db",
    files: {},
    reports: reportRule({ to: { path: "pg" }, from: { path: "^src" }, severity: "error", name: "no-db" }),
  });
  const retargeted = await textFor({
    t,
    id: "no-db",
    files: {},
    reports: reportRule({ name: "no-db", severity: "error", from: { path: "^src" }, to: { path: "mysql" } }),
  });

  assert.equal(plain, '{"from":{"path":"^src"},"name":"no-db","severity":"error","to":{"path":"pg"}}\n');
  assert.equal(reordered, plain);
  assert.notEqual(retargeted, plain);
});

test("which modules a required rule covers is part of its text, from a report or a config", async (t) => {
  const rule = (path: string) => ({ name: "has-index", severity: "error", module: { path }, to: { path: "index" } });
  const fromReport = (path: string) => textFor({ t, id: "has-index", files: {}, reports: reportRule(rule(path)) });
  const fromConfig = (path: string) =>
    textFor({
      t,
      id: "has-index",
      config: { dependency_cruiser_config: ".dependency-cruiser.json" },
      files: { ".dependency-cruiser.json": JSON.stringify({ required: [rule(path)] }) },
    });

  assert.notEqual(await fromReport("^src/a"), await fromReport("^src/b"));
  assert.notEqual(await fromConfig("^src/a"), await fromConfig("^src/b"));
});

test("with a JSON dependency-cruiser config, a rule's text comes from the config without its comment", async (t) => {
  const text = await textFor({
    t,
    id: "no-db",
    config: { dependency_cruiser_config: ".dependency-cruiser.json" },
    files: {
      ".dependency-cruiser.json": JSON.stringify({
        forbidden: [{ name: "no-db", comment: "why", severity: "error", from: { path: "^src" }, to: { path: "pg" } }],
      }),
    },
    reports: reportRule({ name: "no-db", severity: "warn", from: { path: "^src" }, to: { path: "pg" } }),
  });

  assert.equal(text, '{"from":{"path":"^src"},"name":"no-db","severity":"error","to":{"path":"pg"}}\n');
});

test("a configured dependency-cruiser config that is missing is a configuration error", async (t) => {
  const projectDirectory = await createProject({ t, files: configFile({ dependency_cruiser_config: ".dependency-cruiser.json" }) });

  await assertConfigurationError({
    action: currentSources({ projectDirectory, config: await loadConfig({ projectDirectory }), reports: emptyReports }),
    pattern: /\.dependency-cruiser\.json: cannot be read/,
  });
});

test("a test file named by the report is read through symlinks and whitespace-normalised", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: { ...configFile(), "test/a.test.ts": "test('x', () => {});   \n\n\nexpect(1);\n" },
  });
  const file = await realpath(join(projectDirectory, "test/a.test.ts"));
  const reports: Reports = { cases: [{ checks: ["A"], outcome: "passed", file, source: "r.xml" }], rules: [] };

  const sources = await currentSources({ projectDirectory, config: await loadConfig({ projectDirectory }), reports });

  assert.equal(await checkText({ id: "A", sources }), "file test/a.test.ts\ntest('x', () => {});\nexpect(1);\n");
});

test("a test file whose name starts with two dots is read", async (t) => {
  const projectDirectory = await createProject({ t, files: { ...configFile(), "..a.test.ts": "expect(1);\n" } });
  const reports: Reports = { cases: [{ checks: ["A"], outcome: "passed", file: "..a.test.ts", source: "r.xml" }], rules: [] };

  const sources = await currentSources({ projectDirectory, config: await loadConfig({ projectDirectory }), reports });

  assert.equal(await checkText({ id: "A", sources }), "file ..a.test.ts\nexpect(1);\n");
});

test("a test file outside the project leaves the text unavailable", async (t) => {
  const projectDirectory = await createProject({ t, files: configFile() });
  const reports: Reports = { cases: [{ checks: ["A"], outcome: "passed", file: "/etc/hosts", source: "r.xml" }], rules: [] };

  const sources = await currentSources({ projectDirectory, config: await loadConfig({ projectDirectory }), reports });

  assert.equal(await checkText({ id: "A", sources }), undefined);
});

test("Gherkin wins over a rule with the same ID", async (t) => {
  const text = await textFor({
    t,
    id: "PAY-002",
    files: { "features/payments.feature": payments },
    reports: reportRule({ name: "PAY-002" }),
  });

  assert.match(text ?? "", /^pickle features\/payments\.feature/);
});
