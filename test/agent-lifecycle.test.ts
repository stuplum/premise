import assert from "node:assert/strict";
import { rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  createProject,
  originalDecision,
  originalRequirement,
  sortedImplementation,
  sortedRequirement,
} from "./lifecycle-fixture.js";

test("blocks a changed requirement until a reviewed replacement preserves the original decision", async (t) => {
  const project = await createProject({ t });
  const receipt = await project.read(".premise/reviews/QUERY-010.json");
  project.agent({ action: "start" });
  await project.write({ path: "features/query.feature", content: sortedRequirement });

  const failed = project.agent({ action: "stop" });
  assert.equal(failed.status, "blocked");
  assert.ok(failed.blockers.some(({ kind, id, state, source }) =>
    kind === "premise" && id === "QUERY-001" && state === "failed" &&
    source?.uri === "features/query.feature",
  ));
  assert.ok(failed.blockers.some(({ kind, id, source }) =>
    kind === "decision" && id === "QUERY-010" && source?.uri === "decisions/QUERY-010.decision",
  ));
  assert.equal(await project.read(".premise/reviews/QUERY-010.json"), receipt);

  await project.write({ path: "src/catalog.ts", content: sortedImplementation });
  const repaired = project.agent({ action: "stop" });
  assert.equal(repaired.status, "blocked");
  assert.ok(repaired.blockers.some(({ kind, id }) => kind === "decision" && id === "QUERY-010"));
  assert.ok(!repaired.blockers.some(({ kind }) => kind === "premise"));

  await project.supersede();
  const resolved = project.agent({ action: "stop" });
  assert.equal(resolved.status, "passed");
  assert.deepEqual(resolved.blockers, []);
  assert.equal(await project.read("decisions/QUERY-010.decision"), originalDecision);
});

test("permits explicit reaffirmation when changed drivers still support the existing decision", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  await project.write({
    path: "features/query.feature",
    content: originalRequirement.replace("Query aggregated products", "Return every aggregated product"),
  });

  const stale = project.agent({ action: "stop" });
  assert.equal(stale.status, "blocked");
  assert.ok(stale.blockers.some(({ kind, id }) => kind === "decision" && id === "QUERY-010"));
  assert.ok(!stale.blockers.some(({ kind }) => kind === "premise"));

  project.review();
  assert.equal(project.agent({ action: "stop" }).status, "passed");
  assert.equal(await project.read("decisions/QUERY-010.decision"), originalDecision);
});

test("rechecks implementation edits after a previous completion check passed", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  assert.equal(project.agent({ action: "stop" }).status, "passed");

  await project.write({ path: "src/catalog.ts", content: "export function queryProducts() { return []; }\n" });
  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind, id, state }) =>
    kind === "premise" && id === "QUERY-001" && state === "failed",
  ));
});

test("cannot clear an executable failure by recording a new decision review", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  await project.write({ path: "features/query.feature", content: sortedRequirement });
  project.review();

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind, id, state }) =>
    kind === "premise" && id === "QUERY-001" && state === "failed",
  ));
});

test("blocks completion when a configured premise cannot be evaluated", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  await project.remove("features/step_definitions");

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind, id, state }) =>
    kind === "premise" && id === "QUERY-001" && state === "unknown",
  ));
});

test("reports broken configuration as a blocker rather than a successful empty evaluation", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  await project.write({ path: "premise.json", content: "{broken" });

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind }) => kind === "evaluation"));
});

test("does not forget an active gate when its repository configuration disappears", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  await project.remove("premise.json");
  await project.write({ path: "src/catalog.ts", content: "export function queryProducts() { return []; }\n" });

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
});

test("rejects rewriting a historical decision even after its new contents are reviewed", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  await project.write({
    path: "decisions/QUERY-010.decision",
    content: originalDecision.replace(
      "Choose return upstream results without a local query model",
      "Choose store a persistent local query model",
    ),
  });
  project.review();

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind, id }) => kind === "history" && id === "QUERY-010"));
});

test("rejects deleting the historical decision rather than superseding it", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  await project.remove("decisions/QUERY-010.decision");

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind, id }) => kind === "history" && id === "QUERY-010"));
});

test("does not reset historical protection when the same session starts again", async (t) => {
  const project = await createProject({ t });
  project.agent({ action: "start" });
  await project.write({
    path: "decisions/QUERY-010.decision",
    content: originalDecision.replace("Accept upstream ordering", "Accept synchronisation costs"),
  });
  project.review();
  project.agent({ action: "start" });

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind, id }) => kind === "history" && id === "QUERY-010"));
});

test("exposes changed supporting premises and affected decisions for the implementation being edited", async (t) => {
  const project = await createProject({ t });
  await project.write({ path: "src/unrelated.ts", content: "export const unrelated = true;\n" });
  await project.write({
    path: "decisions/OTHER-010.decision",
    content: [
      'Decision OTHER-010 "Keep unrelated configuration static"',
      "Driven by source src/unrelated.ts",
      "Choose a static configuration value",
      "Because the unrelated feature has no runtime configuration",
      "Accept deployment to change configuration",
      "",
    ].join("\n"),
  });
  project.review("OTHER-010");
  project.agent({ action: "start" });
  await project.write({ path: "features/query.feature", content: sortedRequirement });

  const report = project.agent({ action: "context", artifact: "src/catalog.ts" });
  assert.equal(report.artifact, "src/catalog.ts");
  assert.ok(report.knowledge.some(({ id, kind, state, source }) =>
    id === "QUERY-001" && kind === "premise" && state.status === "failed" &&
    source.uri === "features/query.feature",
  ));
  assert.ok(report.knowledge.some(({ id, kind, state }) =>
    id === "QUERY-010" && kind === "decision" && state.status === "reconsider",
  ));
  assert.ok(!report.knowledge.some(({ id }) => id === "OTHER-010"));
});

test("leaves repositories that have not enabled Premise outside the completion gate", async (t) => {
  const project = await createProject({ t, configured: false });
  assert.equal(project.agent({ action: "start" }).status, "inactive");
  assert.equal(project.agent({ action: "stop" }).status, "inactive");
});

test("does not claim successful verification without a started session for an enabled repository", async (t) => {
  const project = await createProject({ t });
  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind }) => kind === "session"));
});

test("reports a Jev concern without turning it into an executable failure", async (t) => {
  const project = await createProject({ t });
  await project.enableJev({ probability: 0.05 });
  project.agent({ action: "start" });

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "passed");
  assert.deepEqual(report.blockers, []);
  assert.ok(report.advisories.some(({ id, status }) => id === "REVIEW-001" && status === "concern"));
});

test("keeps an uncertain Jev judgement visible without demanding model approval", async (t) => {
  const project = await createProject({ t });
  await project.enableJev({ probability: 0.5 });
  project.agent({ action: "start" });

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "passed");
  assert.deepEqual(report.blockers, []);
  assert.ok(report.advisories.some(({ id, status }) => id === "REVIEW-001" && status === "uncertain"));
});

test("reports unavailable Jev review without mislabelling it as either approval or a mechanical blocker", async (t) => {
  const project = await createProject({ t });
  await project.enableJev({ unavailable: true });
  project.agent({ action: "start" });

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "passed");
  assert.deepEqual(report.blockers, []);
  assert.ok(report.advisories.some(({ id, status }) => id === "REVIEW-001" && status === "unavailable"));
});

test("cannot replace executable evidence with a favourable Jev judgement", async (t) => {
  const project = await createProject({ t });
  await project.enableJev({ probability: 0.99 });
  project.agent({ action: "start" });
  await project.write({ path: "features/query.feature", content: sortedRequirement });

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind, id, state }) =>
    kind === "premise" && id === "QUERY-001" && state === "failed",
  ));
  assert.ok(report.advisories.some(({ id, status }) => id === "REVIEW-001" && status === "supported"));
});

test("blocks a dangling configuration symlink instead of silently dropping configured providers", async (t) => {
  const project = await createProject({ t });
  await rename(join(project.projectDirectory, "features"), join(project.projectDirectory, "specifications"));
  await project.write({
    path: "configuration.json",
    content: JSON.stringify({
      version: 1,
      cucumber: {
        features: ["specifications/**/*.feature"],
        steps: ["specifications/step_definitions/**/*.ts"],
      },
    }),
  });
  await project.remove("premise.json");
  await symlink("configuration.json", join(project.projectDirectory, "premise.json"));
  await project.write({
    path: "decisions/QUERY-010.decision",
    content: originalDecision.replace("premise QUERY-001", "source src/catalog.ts"),
  });
  project.review();
  assert.equal(project.agent({ action: "start" }).status, "ready");
  await project.remove("configuration.json");

  const report = project.agent({ action: "stop" });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(({ kind }) => kind === "evaluation"));
});
