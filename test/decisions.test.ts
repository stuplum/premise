import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { loadConfig } from "../src/config.js";
import { loadDecisions } from "../src/decisions.js";
import { assertConfigurationError } from "./support/assertions.js";
import { configFile, createDecision, decisionFiles, type DecisionDocument } from "./support/fixtures.js";
import { createProject } from "./support/project.js";

async function load({ t, files }: { t: import("node:test").TestContext; files: Record<string, string> }) {
  const projectDirectory = await createProject({ t, files: { ...configFile(), ...files } });
  const config = await loadConfig({ projectDirectory });
  return loadDecisions({ projectDirectory, config });
}

function withDecisions(decisions: DecisionDocument[]) {
  return decisionFiles({ decisions });
}

test("an ADR file maps to a decision with defaults filled", async (t) => {
  const document = createDecision({ id: "ADR-001", supported_by: [{ check: "PAY-001" }] });

  const [decision] = await load({ t, files: withDecisions([document]) });

  assert.equal(decision?.id, "ADR-001");
  assert.equal(decision?.uri, "decisions/ADR-001.yaml");
  assert.deepEqual(decision?.supportedBy, [{ check: "PAY-001" }]);
  assert.deepEqual(decision?.enforcedBy, []);
  assert.deepEqual(decision?.scope, []);
  assert.equal(decision?.signoff, "human");
});

test("a file whose name differs from its id is rejected", async (t) => {
  await assertConfigurationError({
    action: load({ t, files: { "decisions/other.yaml": stringify(createDecision({ id: "ADR-001" })) } }),
    pattern: /decisions\/other\.yaml: file must be named ADR-001\.yaml/,
  });
});

test("schema violations name the file", async (t) => {
  await assertConfigurationError({
    action: load({ t, files: withDecisions([createDecision({ id: "ADR-001", owner: "someone" })]) }),
    pattern: /^decisions\/ADR-001\.yaml: /,
  });
});

test("a decision that is not one of its options is rejected", async (t) => {
  await assertConfigurationError({
    action: load({ t, files: withDecisions([createDecision({ id: "ADR-001", decision: "Something else" })]) }),
    pattern: /decision "Something else" is not one of the options/,
  });
});

test("a sign-off the repository does not allow is rejected", async (t) => {
  await assertConfigurationError({
    action: load({ t, files: withDecisions([createDecision({ id: "ADR-001", signoff: "none" })]) }),
    pattern: /signoff none is not allowed by premise\.yaml/,
  });
});

test("superseding requires the old decision to be marked superseded", async (t) => {
  const files = withDecisions([
    createDecision({ id: "ADR-001" }),
    createDecision({ id: "ADR-002", supersedes: "ADR-001" }),
  ]);

  await assertConfigurationError({
    action: load({ t, files }),
    pattern: /supersedes ADR-001, which is not marked superseded/,
  });
});

test("superseding a decision that does not exist is rejected", async (t) => {
  await assertConfigurationError({
    action: load({ t, files: withDecisions([createDecision({ id: "ADR-002", supersedes: "ADR-404" })]) }),
    pattern: /supersedes ADR-404, which does not exist/,
  });
});

test("a check linked twice in the same list is rejected", async (t) => {
  await assertConfigurationError({
    action: load({
      t,
      files: withDecisions([createDecision({ id: "ADR-001", supported_by: [{ check: "PAY-001" }, { check: "PAY-001" }] })]),
    }),
    pattern: /supported_by links PAY-001 more than once/,
  });
});

test("a superseded decision must be named by exactly one successor", async (t) => {
  await assertConfigurationError({
    action: load({ t, files: withDecisions([createDecision({ id: "ADR-001", status: "superseded" })]) }),
    pattern: /is superseded but is named by 0 supersedes/,
  });
});

test("a scope that matches no file is rejected", async (t) => {
  await assertConfigurationError({
    action: load({ t, files: withDecisions([createDecision({ id: "ADR-001", scope: ["src/missing/**"] })]) }),
    pattern: /scope src\/missing\/\*\* matches no files/,
  });
});

test("a valid supersession loads both decisions in id order", async (t) => {
  const files = {
    ...withDecisions([
      createDecision({ id: "ADR-002", supersedes: "ADR-001", scope: ["src/**"] }),
      createDecision({ id: "ADR-001", status: "superseded" }),
    ]),
    "src/index.ts": "export {};\n",
  };

  const decisions = await load({ t, files });

  assert.deepEqual(decisions.map((decision) => decision.id), ["ADR-001", "ADR-002"]);
});
