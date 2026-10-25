import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigurationError } from "../src/errors.js";
import { parseCucumberJson } from "../src/reports/cucumber-json.js";
import { parseJunit } from "../src/reports/junit.js";
import { cucumberJsonReport, junitReport } from "./support/fixtures.js";

const junitUri = "reports/unit.xml";
const cucumberUri = "reports/cucumber.json";

function rejects({ action, pattern }: { action: () => unknown; pattern: RegExp }) {
  assert.throws(action, (error: unknown) => error instanceof ConfigurationError && pattern.test(error.message));
}

test("only whole @ tokens in a JUnit test name become check IDs", () => {
  const [testCase] = parseJunit({
    content: junitReport({ cases: [{ name: "@PAY-001 @PAY-0010 sorts for email@example.com @" }] }),
    uri: junitUri,
  });

  assert.deepEqual(testCase?.checks, ["PAY-001", "PAY-0010"]);
  assert.equal(testCase?.source, junitUri);
});

test("JUnit outcomes come from failure and skipped children", () => {
  const cases = parseJunit({
    content: junitReport({
      cases: [
        { name: "@A passes" },
        { name: "@B fails", outcome: "failed" },
        { name: "@C skipped", outcome: "skipped" },
      ],
    }),
    uri: junitUri,
  });

  assert.deepEqual(cases.map((testCase) => testCase.outcome), ["passed", "failed", "skipped"]);
});

test("an error child counts as a failure", () => {
  const [testCase] = parseJunit({
    content: '<testsuites><testcase name="@A x"><error message="e"/></testcase></testsuites>',
    uri: junitUri,
  });

  assert.equal(testCase?.outcome, "failed");
});

test("test cases in nested suites and a single root suite are collected", () => {
  const nested = parseJunit({
    content: '<testsuites><testsuite name="a"><testsuite name="b"><testcase name="@A x"/></testsuite></testsuite></testsuites>',
    uri: junitUri,
  });
  const single = parseJunit({ content: '<testsuite name="a"><testcase name="@B y"/></testsuite>', uri: junitUri });

  assert.deepEqual(nested.map((testCase) => testCase.checks), [["A"]]);
  assert.deepEqual(single.map((testCase) => testCase.checks), [["B"]]);
});

test("the file attribute is used, falling back to classname", () => {
  const cases = parseJunit({
    content: '<testsuites><testcase name="a" classname="x" file="test/a.test.ts"/><testcase name="b" classname="test/b.test.ts"/></testsuites>',
    uri: junitUri,
  });

  assert.deepEqual(cases.map((testCase) => testCase.file), ["test/a.test.ts", "test/b.test.ts"]);
});

test("invalid XML is a configuration error naming the report", () => {
  rejects({ action: () => parseJunit({ content: "<testsuites>", uri: junitUri }), pattern: /reports\/unit\.xml: invalid JUnit XML/ });
});

test("XML that is not a JUnit report is rejected", () => {
  rejects({ action: () => parseJunit({ content: "<results/>", uri: junitUri }), pattern: /reports\/unit\.xml: not a JUnit report/ });
});

test("Cucumber scenarios take their tags and an outcome from their steps", () => {
  const cases = parseCucumberJson({
    content: cucumberJsonReport({
      scenarios: [
        { tags: ["@PAY-001"], statuses: ["passed", "passed"] },
        { tags: ["@PAY-002"], statuses: ["passed", "failed", "skipped"] },
        { tags: ["@PAY-003"], statuses: ["passed", "undefined"] },
        { tags: ["@PAY-004"], statuses: [] },
      ],
    }),
    uri: cucumberUri,
  });

  assert.deepEqual(
    cases.map((testCase) => [testCase.checks, testCase.outcome, testCase.file]),
    [
      [["PAY-001"], "passed", "features/example.feature"],
      [["PAY-002"], "failed", "features/example.feature"],
      [["PAY-003"], "skipped", "features/example.feature"],
      [["PAY-004"], "skipped", "features/example.feature"],
    ],
  );
});

test("Cucumber background elements are not scenarios", () => {
  const cases = parseCucumberJson({
    content: cucumberJsonReport({ scenarios: [{ tags: [], statuses: ["passed"], type: "background" }] }),
    uri: cucumberUri,
  });

  assert.deepEqual(cases, []);
});

function jvmFeature(elements: unknown[]): string {
  return JSON.stringify([{ uri: "features/example.feature", elements }]);
}

function result(status: string) {
  return { result: { status } };
}

test("Cucumber scenario and step hooks count towards the outcome", () => {
  const cases = parseCucumberJson({
    content: jvmFeature([
      { type: "scenario", tags: [{ name: "@AFTER" }], steps: [result("passed")], after: [result("failed")] },
      { type: "scenario", tags: [{ name: "@BEFORE" }], before: [result("failed")], steps: [result("skipped")] },
      { type: "scenario", tags: [{ name: "@STEP" }], steps: [{ ...result("passed"), after: [result("failed")] }] },
      { type: "scenario", tags: [{ name: "@CLEAN" }], before: [result("passed")], steps: [result("passed")], after: [result("passed")] },
    ]),
    uri: cucumberUri,
  });

  assert.deepEqual(
    cases.map((testCase) => [testCase.checks, testCase.outcome]),
    [[["AFTER"], "failed"], [["BEFORE"], "failed"], [["STEP"], "failed"], [["CLEAN"], "passed"]],
  );
});

test("a failed background step fails the scenario that follows it", () => {
  const cases = parseCucumberJson({
    content: jvmFeature([
      { type: "background", steps: [result("failed")] },
      { type: "scenario", tags: [{ name: "@FIRST" }], steps: [result("skipped")] },
      { type: "background", steps: [result("passed")] },
      { type: "scenario", tags: [{ name: "@SECOND" }], steps: [result("passed")] },
    ]),
    uri: cucumberUri,
  });

  assert.deepEqual(
    cases.map((testCase) => [testCase.checks, testCase.outcome]),
    [[["FIRST"], "failed"], [["SECOND"], "passed"]],
  );
});

test("malformed Cucumber JSON is a configuration error naming the report", () => {
  rejects({ action: () => parseCucumberJson({ content: "{", uri: cucumberUri }), pattern: /reports\/cucumber\.json: invalid JSON/ });
  rejects({ action: () => parseCucumberJson({ content: "{}", uri: cucumberUri }), pattern: /must be an array of features/ });
  rejects({
    action: () => parseCucumberJson({ content: '[{"uri":"f","elements":[{"steps":[{}]}]}]', uri: cucumberUri }),
    pattern: /reports\/cucumber\.json: malformed Cucumber JSON/,
  });
});
