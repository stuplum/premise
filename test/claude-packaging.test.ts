import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { createProject, sortedRequirement } from "./lifecycle-fixture.js";

async function cachedPlugin(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "premise-claude-plugin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(resolve("dist"), join(directory, "dist"), { recursive: true });
  await cp(resolve("package.json"), join(directory, "package.json"));
  return ({ projectDirectory, event, timeoutMs = 25_000 }: {
    projectDirectory: string;
    event: "SessionStart" | "Stop";
    timeoutMs?: number;
  }) => {
    const result = spawnSync(process.execPath, [join(directory, "dist/adapters/claude-launcher.js"), event], {
      cwd: projectDirectory,
      input: JSON.stringify({ cwd: projectDirectory, session_id: "claude-cached", hook_event_name: event, stop_hook_active: false }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDirectory, PREMISE_CLAUDE_TIMEOUT_MS: String(timeoutMs) },
      timeout: 30_000,
    });
    assert.ifError(result.error);
    return result;
  };
}

test("a copied Claude plugin evaluates the project installation without cached npm dependencies", async (t) => {
  const project = await createProject({ t });
  const invoke = await cachedPlugin(t);
  const start = invoke({ projectDirectory: project.projectDirectory, event: "SessionStart" });
  assert.equal(start.status, 0, start.stderr);
  await project.write({ path: "features/query.feature", content: sortedRequirement });
  const stop = invoke({ projectDirectory: project.projectDirectory, event: "Stop" });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(JSON.parse(stop.stdout).decision, "block");
  assert.match(JSON.parse(stop.stdout).reason, /QUERY-001/);
});

test("a copied Claude plugin leaves an unconfigured project usable without Premise installed", async (t) => {
  const project = await createProject({ t, configured: false });
  const invoke = await cachedPlugin(t);
  const result = invoke({ projectDirectory: project.projectDirectory, event: "Stop" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).decision, undefined);
});

test("Claude cannot silently forget an active gate when its configuration and runtime disappear", async (t) => {
  const project = await createProject({ t });
  const invoke = await cachedPlugin(t);
  assert.equal(invoke({ projectDirectory: project.projectDirectory, event: "SessionStart" }).status, 0);
  await project.remove("premise.json");
  await project.remove("node_modules/@stuplum/premise");
  assert.equal(invoke({ projectDirectory: project.projectDirectory, event: "Stop" }).status, 2);
});

test("an exhausted Claude hook budget blocks before the host discards the result", async (t) => {
  const project = await createProject({ t });
  const invoke = await cachedPlugin(t);
  assert.equal(invoke({ projectDirectory: project.projectDirectory, event: "SessionStart" }).status, 0);
  const result = invoke({ projectDirectory: project.projectDirectory, event: "Stop", timeoutMs: 1 });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /timed out/);
});
