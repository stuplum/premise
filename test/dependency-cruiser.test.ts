import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigurationError } from "../src/errors.js";
import { parseDependencyCruiser } from "../src/reports/dependency-cruiser.js";
import { dependencyCruiserReport } from "./support/fixtures.js";

const uri = "reports/depcruise.json";
const noDb = { name: "no-db", severity: "error", from: { path: "^src" }, to: { path: "pg" } };

test("forbidden and required rules are listed with whether they were violated", () => {
  const content = JSON.stringify({
    modules: [],
    summary: {
      violations: [{ rule: { name: "no-db" } }],
      optionsUsed: {},
      ruleSetUsed: { forbidden: [{ ...noDb, comment: "why" }], required: [{ name: "has-index", from: {}, to: {} }] },
    },
  });

  const rules = parseDependencyCruiser({ content, uri });

  assert.deepEqual(
    rules.map((rule) => [rule.name, rule.violated, rule.blindReason]),
    [["no-db", true, undefined], ["has-index", false, undefined]],
  );
  assert.deepEqual(rules[0]?.definition, noDb);
});

test("an unresolved dependency makes every rule blind", () => {
  const [rule] = parseDependencyCruiser({ content: dependencyCruiserReport({ rules: [noDb], unresolved: true }), uri });

  assert.equal(rule?.blindReason, "unresolved imports in src/a.ts");
});

test("an unresolved module makes every rule blind", () => {
  const content = JSON.stringify({
    modules: [{ source: "missing-module", couldNotResolve: true, dependencies: [] }],
    summary: { violations: [], optionsUsed: {}, ruleSetUsed: { forbidden: [noDb] } },
  });

  assert.equal(parseDependencyCruiser({ content, uri })[0]?.blindReason, "unresolved imports in missing-module");
});

test("includeOnly and exclude make every rule blind", () => {
  const includeOnly = parseDependencyCruiser({
    content: dependencyCruiserReport({ rules: [noDb], optionsUsed: { includeOnly: "^src" } }),
    uri,
  });
  const exclude = parseDependencyCruiser({
    content: dependencyCruiserReport({ rules: [noDb], optionsUsed: { exclude: { path: "test" } } }),
    uri,
  });

  assert.equal(includeOnly[0]?.blindReason, "includeOnly can hide unresolved imports");
  assert.equal(exclude[0]?.blindReason, "exclude can hide unresolved imports");
});

test("a report without the expected fields is rejected", () => {
  assert.throws(
    () => parseDependencyCruiser({ content: "{}", uri }),
    (error: unknown) => error instanceof ConfigurationError && /reports\/depcruise\.json: not a dependency-cruiser JSON report/.test(error.message),
  );
});
