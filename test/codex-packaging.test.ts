import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { createProject, sortedRequirement } from "./lifecycle-fixture.js";

async function cachedPlugin(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "premise-cached-plugin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(resolve("dist"), join(directory, "dist"), { recursive: true });
  await cp(resolve("package.json"), join(directory, "package.json"));
  const hooks = JSON.parse(await readFile(resolve("hooks/codex.json"), "utf8"));
  return {
    invoke({ projectDirectory, event, fields = {}, timeoutMs }: {
      projectDirectory: string;
      event: "SessionStart" | "PreToolUse" | "Stop";
      fields?: Record<string, unknown>;
      timeoutMs?: number;
    }) {
      const command = hooks.hooks[event][0].hooks[0].command;
      const result = spawnSync("/bin/sh", ["-c", command], {
        cwd: projectDirectory,
        input: JSON.stringify({ cwd: projectDirectory, session_id: "cached-plugin", hook_event_name: event, stop_hook_active: false, ...fields }),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
          PLUGIN_ROOT: directory,
          PREMISE_CODEX_TIMEOUT_MS: String(timeoutMs ?? 25_000),
        },
        timeout: 30_000,
      });
      assert.ifError(result.error);
      return result;
    },
  };
}

test("a copied Codex plugin uses the repository installation rather than missing cached dependencies", async (t) => {
  const project = await createProject({ t });
  const plugin = await cachedPlugin(t);
  const start = plugin.invoke({ projectDirectory: project.projectDirectory, event: "SessionStart" });
  assert.equal(start.status, 0, start.stderr);
  assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /QUERY-010/);
  await project.write({ path: "features/query.feature", content: sortedRequirement });

  const stop = plugin.invoke({ projectDirectory: project.projectDirectory, event: "Stop" });
  assert.equal(stop.status, 0, stop.stderr);
  const report = JSON.parse(stop.stdout);
  assert.equal(report.decision, "block");
  assert.match(report.reason, /QUERY-001/);
});

test("a copied plugin does not demand installation in an unconfigured repository", async (t) => {
  const project = await createProject({ t, configured: false });
  const plugin = await cachedPlugin(t);
  const result = plugin.invoke({
    projectDirectory: project.projectDirectory,
    event: "PreToolUse",
    fields: { tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch" } },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(JSON.parse(result.stdout).hookSpecificOutput?.permissionDecision, "deny");
});

test("a copied plugin blocks an active session if both configuration and the installed runtime disappear", async (t) => {
  const project = await createProject({ t });
  const plugin = await cachedPlugin(t);
  const start = plugin.invoke({ projectDirectory: project.projectDirectory, event: "SessionStart" });
  assert.equal(start.status, 0, start.stderr);
  await project.remove("premise.json");
  await project.remove("node_modules/@stuplum/premise");

  const stop = plugin.invoke({ projectDirectory: project.projectDirectory, event: "Stop" });
  assert.equal(stop.status, 2);
  assert.match(stop.stderr, /install.*@stuplum\/premise/i);
});

test("an exhausted Codex hook budget returns a blocking exit rather than reaching the host deadline", async (t) => {
  const project = await createProject({ t });
  const plugin = await cachedPlugin(t);
  const start = plugin.invoke({ projectDirectory: project.projectDirectory, event: "SessionStart" });
  assert.equal(start.status, 0, start.stderr);

  const stop = plugin.invoke({ projectDirectory: project.projectDirectory, event: "Stop", timeoutMs: 1 });
  assert.equal(stop.status, 2);
  assert.match(stop.stderr, /timed out/);
});
