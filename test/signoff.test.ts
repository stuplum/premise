import assert from "node:assert/strict";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { parse, stringify } from "yaml";
import { JEV_ENDPOINT, type ClassifierRuntime } from "../src/classifiers/types.js";
import { fingerprintOf } from "../src/fingerprint.js";
import { refreshDecision } from "../src/refresh.js";
import { formatSignoff, signoff, signoffExitCode, type Approvals } from "../src/signoff.js";
import { assertConfigurationError } from "./support/assertions.js";
import { runPremise } from "./support/cli.js";
import {
  configFile,
  createDecision,
  cucumberJsonReport,
  decisionFiles,
  judgeScript,
  type DecisionDocument,
} from "./support/fixtures.js";
import { commitAll } from "./support/git.js";
import { createProject, writeFiles } from "./support/project.js";

function feature(outcome: string): string {
  return ["Feature: Payments", "  @PAY-001", "  Scenario: totals", "    When a payment is made", `    Then ${outcome}`, ""].join("\n");
}

function textOf(outcome: string): string {
  return `pickle features/payments.feature\n{"text":"a payment is made","type":"Action"}\n{"text":${JSON.stringify(outcome)},"type":"Outcome"}\n`;
}

function respondWith(probability: number): string {
  return `process.stdout.write(JSON.stringify({ model, probability: ${probability} }));`;
}

function classifierDecision(overrides: Partial<DecisionDocument> = {}): DecisionDocument {
  return createDecision({
    id: "ADR-001",
    supported_by: [{ check: "PAY-001" }],
    signoff: "classifier:local",
    owners: ["alice"],
    ...overrides,
  });
}

function signoffConfig({
  thresholds = { established: 0.8, failed: 0.2 },
}: { thresholds?: { established: number; failed: number } } = {}) {
  return {
    gherkin: "features/**/*.feature",
    reports: [{ format: "cucumber-json", path: "reports/cucumber.json" }],
    signoff: { default: "human", allowed: ["human", "none", "classifier:local"] },
    classifiers: { local: { adapter: "command", command: ["node", "judge.mjs"], model: "judge-1", thresholds } },
  };
}

async function createSignoffProject({
  t,
  respond,
  decision = classifierDecision(),
}: {
  t: TestContext;
  respond: string;
  decision?: DecisionDocument;
}): Promise<string> {
  return createProject({
    t,
    files: {
      ...configFile(signoffConfig()),
      ...decisionFiles({ decisions: [decision] }),
      "features/payments.feature": feature("the total is 10"),
      "reports/cucumber.json": cucumberJsonReport({ scenarios: [{ tags: ["@PAY-001"], statuses: ["passed", "passed"] }] }),
      "judge.mjs": judgeScript({ respond }),
    },
  });
}

async function signedThenChanged({ t, respond }: { t: TestContext; respond: string }): Promise<string> {
  const projectDirectory = await createSignoffProject({ t, respond });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });
  commitAll({ projectDirectory, message: "base" });
  await writeFiles({ projectDirectory, files: { "features/payments.feature": feature("the total is 11") } });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });
  return projectDirectory;
}

function runtimeFor(projectDirectory: string): ClassifierRuntime {
  return { projectDirectory, env: process.env, timeoutMs: 10_000, jevEndpoint: JEV_ENDPOINT };
}

async function received(projectDirectory: string) {
  return JSON.parse(await readFile(join(projectDirectory, "received.json"), "utf8"));
}

async function editDecision({
  projectDirectory,
  changes,
}: {
  projectDirectory: string;
  changes: Record<string, unknown>;
}): Promise<void> {
  const path = join(projectDirectory, "decisions/ADR-001.yaml");
  await writeFile(path, stringify({ ...parse(await readFile(path, "utf8")), ...changes }));
}

test("reasons rewritten in the pull request need a human", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.93) });
  await editDecision({ projectDirectory, changes: { because: ["The total can be any value."] } });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "decision changed in this pull request: because");
});

test("switching a classifier-signed decision to no sign-off in the pull request needs a human", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.93) });
  await editDecision({ projectDirectory, changes: { signoff: "none" } });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "decision changed in this pull request: signoff");
});

test("switching a human-signed decision to a classifier in the pull request needs a human", async (t) => {
  const projectDirectory = await createSignoffProject({ t, respond: respondWith(0.93), decision: classifierDecision({ signoff: "human" }) });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });
  commitAll({ projectDirectory, message: "base" });
  await editDecision({ projectDirectory, changes: { signoff: "classifier:local" } });
  await writeFiles({ projectDirectory, files: { "features/payments.feature": feature("the total is 11") } });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "sign-off changed from human to classifier:local in this pull request");
});

test("a classifier-signed decision added in the pull request needs a human", async (t) => {
  const projectDirectory = await createSignoffProject({ t, respond: respondWith(0.93), decision: classifierDecision({ id: "ADR-002" }) });
  await rm(join(projectDirectory, "decisions/ADR-002.yaml"));
  commitAll({ projectDirectory, message: "base" });
  await writeFiles({ projectDirectory, files: decisionFiles({ decisions: [classifierDecision()] }) });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "decision is new in this pull request");
});

test("a signed link removed in the pull request needs a human", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.93) });
  await editDecision({ projectDirectory, changes: { supported_by: [] } });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "links removed or moved in this pull request: PAY-001");
});

test("a signed link moved to the other list in the pull request needs a human", async (t) => {
  const projectDirectory = await createSignoffProject({ t, respond: respondWith(0.93) });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });
  commitAll({ projectDirectory, message: "base" });
  const path = join(projectDirectory, "decisions/ADR-001.yaml");
  const document = parse(await readFile(path, "utf8"));
  await editDecision({ projectDirectory, changes: { supported_by: [], enforced_by: document.supported_by } });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "links removed or moved in this pull request: PAY-001");
});

test("a classifier-signed decision deleted in the pull request needs a human", async (t) => {
  const projectDirectory = await createSignoffProject({ t, respond: respondWith(0.93) });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });
  commitAll({ projectDirectory, message: "base" });
  await rm(join(projectDirectory, "decisions/ADR-001.yaml"));

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.deepEqual(outcomes.map((outcome) => [outcome.decisionId, outcome.verdict, outcome.detail, outcome.changed]), [
    ["ADR-001", "needs-human", "decision removed in this pull request", ["PAY-001"]],
  ]);
});

test("a classifier configuration changed in the pull request needs a human", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.05) });
  await writeFiles({
    projectDirectory,
    files: configFile(signoffConfig({ thresholds: { established: 0.01, failed: 0.001 } })),
  });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.match(outcomes[0]?.detail ?? "", /classifier local is not configured the same at HEAD/);
});

test("a high probability passes and the classifier sees the signed and current text", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.93) });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.deepEqual(outcomes, [
    { decisionId: "ADR-001", classifier: "local", model: "judge-1", changed: ["PAY-001"], verdict: "passed", detail: "probability 0.93" },
  ]);
  assert.deepEqual((await received(projectDirectory)).changes, [
    { check: "PAY-001", before: textOf("the total is 10"), after: textOf("the total is 11") },
  ]);
  assert.equal(signoffExitCode({ outcomes }), 0);
});

test("a low probability means reconsider", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.05) });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "reconsider");
  assert.equal(signoffExitCode({ outcomes }), 1);
});

test("a middling probability needs a human", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.5) });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "probability 0.5");
});

test("an unavailable classifier needs a human", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: "process.exit(1);" });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "classifier unavailable: exited with code 1");
});

function approvedBy(...logins: string[]): Approvals {
  return { status: "available", approvers: logins };
}

test("an owner's approval clears a needs-human outcome", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.5) });

  const outcomes = await signoff({
    projectDirectory,
    base: "HEAD",
    runtime: runtimeFor(projectDirectory),
    approvals: approvedBy("someone", "Alice"),
  });

  assert.equal(outcomes[0]?.verdict, "approved");
  assert.equal(outcomes[0]?.detail, "probability 0.5; approved by alice");
  assert.equal(signoffExitCode({ outcomes }), 0);
});

test("an approval from someone who is not an owner at the base does not count", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.5) });
  await editDecision({ projectDirectory, changes: { owners: ["alice", "mallory"] } });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory), approvals: approvedBy("mallory") });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "decision changed in this pull request: owners; no approval from alice");
  assert.equal(signoffExitCode({ outcomes }), 1);
});

test("an owner's approval does not override reconsider", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.05) });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory), approvals: approvedBy("alice") });

  assert.equal(outcomes[0]?.verdict, "reconsider");
});

test("approvals that cannot be read leave a needs-human outcome in place", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.5) });

  const outcomes = await signoff({
    projectDirectory,
    base: "HEAD",
    runtime: runtimeFor(projectDirectory),
    approvals: { status: "unavailable", reason: "HTTP 401" },
  });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "probability 0.5; approvals unavailable: HTTP 401");
});

test("a decision without owners cannot be approved", async (t) => {
  const projectDirectory = await createSignoffProject({ t, respond: respondWith(0.5), decision: classifierDecision({ owners: [] }) });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });
  commitAll({ projectDirectory, message: "base" });
  await writeFiles({ projectDirectory, files: { "features/payments.feature": feature("the total is 11") } });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory), approvals: approvedBy("alice") });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.equal(outcomes[0]?.detail, "probability 0.5; no owners listed to approve");
});

test("unchanged fingerprints call no classifier", async (t) => {
  const projectDirectory = await createSignoffProject({ t, respond: respondWith(0.93) });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });
  commitAll({ projectDirectory, message: "base" });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.deepEqual(outcomes, []);
  assert.equal(formatSignoff({ outcomes }), "No classifier sign-off needed.\n");
  await assert.rejects(access(join(projectDirectory, "received.json")));
});

test("decisions with human sign-off are ignored", async (t) => {
  const projectDirectory = await createSignoffProject({
    t,
    respond: respondWith(0.93),
    decision: classifierDecision({ signoff: "human" }),
  });
  commitAll({ projectDirectory, message: "base" });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  assert.deepEqual(await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) }), []);
});

test("a link with no fingerprint at the base has empty before text", async (t) => {
  const projectDirectory = await createSignoffProject({ t, respond: respondWith(0.93) });
  commitAll({ projectDirectory, message: "base" });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal((await received(projectDirectory)).changes[0].before, "");
});

test("a fingerprint that no longer matches the current text needs a refresh first", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.93) });
  await writeFiles({ projectDirectory, files: { "features/payments.feature": feature("the total is 12") } });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.match(outcomes[0]?.detail ?? "", /PAY-001 fingerprint does not match the current text; run premise refresh ADR-001/);
});

test("a base fingerprint whose text cannot be rebuilt needs a human", async (t) => {
  const projectDirectory = await createSignoffProject({
    t,
    respond: respondWith(0.93),
    decision: classifierDecision({ supported_by: [{ check: "PAY-001", fingerprint: fingerprintOf("never signed\n") }] }),
  });
  commitAll({ projectDirectory, message: "base" });
  await refreshDecision({ projectDirectory, decisionId: "ADR-001" });

  const outcomes = await signoff({ projectDirectory, base: "HEAD", runtime: runtimeFor(projectDirectory) });

  assert.equal(outcomes[0]?.verdict, "needs-human");
  assert.match(outcomes[0]?.detail ?? "", /PAY-001 signed text unrecoverable: text rebuilt at [0-9a-f]{7} does not match the fingerprint/);
});

test("a base that is not a commit is a configuration error", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.93) });

  await assertConfigurationError({
    action: signoff({ projectDirectory, base: "nope", runtime: runtimeFor(projectDirectory) }),
    pattern: /--base nope is not a commit/,
  });
});

test("signoff --pull-request needs a repository and a pull request number", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.5) });

  const noRepository = runPremise({
    projectDirectory,
    args: ["signoff", "--base", "HEAD", "--pull-request", "7"],
    env: { GITHUB_REPOSITORY: "" },
  });
  const badNumber = runPremise({
    projectDirectory,
    args: ["signoff", "--base", "HEAD", "--pull-request", "seven", "--repository", "owner/repo"],
  });

  assert.equal(noRepository.status, 2);
  assert.match(noRepository.stderr, /--pull-request needs --repository or GITHUB_REPOSITORY/);
  assert.equal(badNumber.status, 2);
  assert.match(badNumber.stderr, /--pull-request must be a positive whole number/);
});

test("the signoff command prints outcomes and exits 1 unless all pass", async (t) => {
  const projectDirectory = await signedThenChanged({ t, respond: respondWith(0.05) });

  const result = runPremise({ projectDirectory, args: ["signoff", "--base", "HEAD"] });
  const missingBase = runPremise({ projectDirectory, args: ["signoff"] });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "ADR-001 reconsider via local (judge-1): probability 0.05; changed PAY-001\n");
  assert.equal(missingBase.status, 2);
});
