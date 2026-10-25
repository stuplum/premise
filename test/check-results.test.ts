import assert from "node:assert/strict";
import { test } from "node:test";
import { describeResult, resolveCheck } from "../src/check-results.js";
import { loadConfig } from "../src/config.js";
import { loadReports } from "../src/reports/load.js";
import type { Reports } from "../src/reports/model.js";
import { assertConfigurationError } from "./support/assertions.js";
import { configFile, cucumberJsonReport, dependencyCruiserReport, junitReport } from "./support/fixtures.js";
import { createProject } from "./support/project.js";

const rule = { name: "no-db", definition: { name: "no-db" }, violated: false, source: "reports/depcruise.json" };

function reports(overrides: Partial<Reports> = {}): Reports {
  return { cases: [], rules: [], ...overrides };
}

test("a check in no report is unknown", () => {
  assert.deepEqual(resolveCheck({ id: "PAY-001", reports: reports() }), {
    status: "unknown",
    detail: "not found in any report",
  });
});

test("check IDs match whole tokens only", () => {
  const result = resolveCheck({
    id: "PAY-001",
    reports: reports({ cases: [{ checks: ["PAY-0010"], outcome: "failed", source: "reports/unit.xml" }] }),
  });

  assert.equal(result.status, "unknown");
});

test("a failing case outweighs a skipped one", () => {
  const result = resolveCheck({
    id: "PAY-001",
    reports: reports({
      cases: [
        { checks: ["PAY-001"], outcome: "skipped", source: "reports/unit.xml" },
        { checks: ["PAY-001"], outcome: "failed", source: "reports/unit.xml" },
      ],
    }),
  });

  assert.deepEqual(result, { status: "failed", detail: "1 failing case in reports/unit.xml" });
});

test("any skipped case leaves the check unknown", () => {
  const result = resolveCheck({
    id: "PAY-001",
    reports: reports({
      cases: [
        { checks: ["PAY-001"], outcome: "passed", source: "reports/unit.xml" },
        { checks: ["PAY-001"], outcome: "skipped", source: "reports/cucumber.json" },
      ],
    }),
  });

  assert.deepEqual(result, { status: "unknown", detail: "1 skipped case in reports/cucumber.json" });
});

test("a violated rule fails and a blind rule is unknown", () => {
  assert.deepEqual(resolveCheck({ id: "no-db", reports: reports({ rules: [{ ...rule, violated: true }] }) }), {
    status: "failed",
    detail: "rule violated in reports/depcruise.json",
  });
  assert.deepEqual(
    resolveCheck({ id: "no-db", reports: reports({ rules: [{ ...rule, blindReason: "exclude can hide unresolved imports" }] }) }),
    { status: "unknown", detail: "exclude can hide unresolved imports" },
  );
});

test("passing cases across reports pass", () => {
  const result = resolveCheck({
    id: "PAY-001",
    reports: reports({
      cases: [
        { checks: ["PAY-001"], outcome: "passed", source: "reports/unit.xml" },
        { checks: ["PAY-001"], outcome: "passed", source: "reports/cucumber.json" },
      ],
    }),
  });

  assert.deepEqual(result, { status: "passed" });
  assert.equal(describeResult(result), "passed");
  assert.equal(describeResult({ status: "unknown", detail: "x" }), "unknown (x)");
});

test("configured reports of every format are loaded together", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: {
      ...configFile({
        reports: [
          { format: "junit", path: "reports/*.xml" },
          { format: "cucumber-json", path: "reports/cucumber.json" },
          { format: "dependency-cruiser", path: "reports/depcruise.json" },
        ],
      }),
      "reports/b.xml": junitReport({ cases: [{ name: "@B x" }] }),
      "reports/a.xml": junitReport({ cases: [{ name: "@A x" }] }),
      "reports/cucumber.json": cucumberJsonReport({ scenarios: [{ tags: ["@C"], statuses: ["passed"] }] }),
      "reports/depcruise.json": dependencyCruiserReport({ rules: [{ name: "no-db" }] }),
    },
  });

  const loaded = await loadReports({ projectDirectory, config: await loadConfig({ projectDirectory }) });

  assert.deepEqual(loaded.cases.map((testCase) => [testCase.checks, testCase.source]), [
    [["A"], "reports/a.xml"],
    [["B"], "reports/b.xml"],
    [["C"], "reports/cucumber.json"],
  ]);
  assert.deepEqual(loaded.rules.map((loadedRule) => loadedRule.name), ["no-db"]);
});

test("a configured report that matches no file is a configuration error", async (t) => {
  const projectDirectory = await createProject({ t, files: configFile() });

  await assertConfigurationError({
    action: loadReports({ projectDirectory, config: await loadConfig({ projectDirectory }) }),
    pattern: /premise\.yaml: report reports\/unit\.xml matches no file/,
  });
});
