import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createProject, originalDecision, sortedImplementation, sortedRequirement } from "./lifecycle-fixture.js";

const adapter = resolve("dist/adapters/claude.js");

type HookOutput = {
  decision?: string;
  reason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
    permissionDecision?: string;
  };
};

function hook({ projectDirectory, event, fields = {}, raw, executable = adapter, environment = {} }: {
  projectDirectory: string;
  event: "SessionStart" | "PreToolUse" | "Stop";
  fields?: Record<string, unknown>;
  raw?: string;
  executable?: string;
  environment?: NodeJS.ProcessEnv;
}): HookOutput {
  const result = spawnSync(process.execPath, [executable, event], {
    cwd: projectDirectory,
    encoding: "utf8",
    input: raw ?? JSON.stringify({ cwd: projectDirectory, session_id: "claude-session", hook_event_name: event, stop_hook_active: false, ...fields }),
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "TYPESAFE_AI_API_KEY" && key !== "NODE_OPTIONS")),
      CLAUDE_PROJECT_DIR: projectDirectory,
      ...environment,
    },
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as HookOutput;
}

test("Claude blocks failed evidence and stale reviews until a reviewed replacement permits completion", async (t) => {
  const project = await createProject({ t });
  const call = (event: "SessionStart" | "Stop", fields = {}) => hook({ projectDirectory: project.projectDirectory, event, fields });
  call("SessionStart");
  await project.write({ path: "features/query.feature", content: sortedRequirement });
  for (const stop_hook_active of [false, true]) {
    const failed = call("Stop", { stop_hook_active });
    assert.equal(failed.decision, "block");
    assert.match(failed.reason ?? "", /premise QUERY-001 \(failed\)/);
  }
  await project.write({ path: "src/catalog.ts", content: sortedImplementation });
  const stale = call("Stop", { stop_hook_active: true });
  assert.equal(stale.decision, "block");
  assert.match(stale.reason ?? "", /decision QUERY-010 \(reconsider\)/);
  assert.doesNotMatch(stale.reason ?? "", /premise QUERY-001 \(failed\)/);
  await project.supersede();
  assert.equal(call("Stop", { stop_hook_active: true }).decision, undefined);
  assert.equal(await project.read("decisions/QUERY-010.decision"), originalDecision);
});

test("Claude resume and compaction cannot replace protected decision history", async (t) => {
  const project = await createProject({ t });
  hook({ projectDirectory: project.projectDirectory, event: "SessionStart", fields: { source: "startup" } });
  await project.write({ path: "decisions/QUERY-010.decision", content: originalDecision.replace("Accept upstream ordering", "Accept unstable ordering") });
  project.review();
  for (const source of ["resume", "compact"]) {
    hook({ projectDirectory: project.projectDirectory, event: "SessionStart", fields: { source } });
  }
  const result = hook({ projectDirectory: project.projectDirectory, event: "Stop" });
  assert.equal(result.decision, "block");
  assert.match(result.reason ?? "", /history QUERY-010/);
});

test("Claude edit context exposes the failed requirement and affected decision before the tool runs", async (t) => {
  const project = await createProject({ t });
  hook({ projectDirectory: project.projectDirectory, event: "SessionStart" });
  await project.write({ path: "features/query.feature", content: sortedRequirement });
  const output = hook({ projectDirectory: project.projectDirectory, event: "PreToolUse", fields: { tool_name: "Edit", tool_input: { file_path: join(project.projectDirectory, "src/catalog.ts"), old_string: "return products;", new_string: "return products;" } } });
  assert.equal(output.hookSpecificOutput?.hookEventName, "PreToolUse");
  assert.match(output.hookSpecificOutput?.additionalContext ?? "", /QUERY-001[\s\S]*failed/);
  assert.match(output.hookSpecificOutput?.additionalContext ?? "", /QUERY-010[\s\S]*reconsider/);
  assert.equal(output.hookSpecificOutput?.permissionDecision, undefined);
});

test("Claude delivers unavailable semantic advice as feedback without repeated blocking", async (t) => {
  const project = await createProject({ t });
  await project.enableJev({ unavailable: true });
  hook({ projectDirectory: project.projectDirectory, event: "SessionStart" });
  const first = hook({ projectDirectory: project.projectDirectory, event: "Stop" });
  assert.equal(first.decision, undefined);
  assert.equal(first.hookSpecificOutput?.hookEventName, "Stop");
  assert.match(first.hookSpecificOutput?.additionalContext ?? "", /REVIEW-001 \(unavailable\)/);
  for (const stop_hook_active of [true, false]) {
    const next = hook({ projectDirectory: project.projectDirectory, event: "Stop", fields: { stop_hook_active } });
    assert.equal(next.decision, undefined);
    assert.equal(next.hookSpecificOutput?.additionalContext, undefined);
  }
});

test("Claude leaves unconfigured repositories outside its completion gate", async (t) => {
  const project = await createProject({ t, configured: false });
  hook({ projectDirectory: project.projectDirectory, event: "SessionStart" });
  const result = hook({ projectDirectory: project.projectDirectory, event: "Stop" });
  assert.equal(result.decision, undefined);
  assert.equal(result.hookSpecificOutput?.additionalContext, undefined);
});

test("Claude rejects malformed stop input instead of accepting completion", async (t) => {
  const project = await createProject({ t });
  const result = hook({ projectDirectory: project.projectDirectory, event: "Stop", raw: "{broken" });
  assert.equal(result.decision, "block");
});

test("Claude starts through a symlinked installed hook entrypoint", async (t) => {
  const project = await createProject({ t });
  const alias = join(project.projectDirectory, "claude-hook.mjs");
  await symlink(adapter, alias);
  const result = hook({ projectDirectory: project.projectDirectory, event: "SessionStart", executable: alias });
  assert.match(result.hookSpecificOutput?.additionalContext ?? "", /QUERY-010/);
});

test("Claude permits configuration repairs while warning that context is unavailable", async (t) => {
  const project = await createProject({ t });
  hook({ projectDirectory: project.projectDirectory, event: "SessionStart" });
  await project.write({ path: "premise.json", content: "{broken" });
  const blocked = hook({ projectDirectory: project.projectDirectory, event: "Stop" });
  assert.equal(blocked.decision, "block");
  const context = hook({
    projectDirectory: project.projectDirectory,
    event: "PreToolUse",
    fields: { tool_name: "Write", tool_input: { file_path: join(project.projectDirectory, "premise.json"), content: '{"version":1}' } },
  });
  assert.equal(context.hookSpecificOutput?.permissionDecision, undefined);
  assert.match(context.hookSpecificOutput?.additionalContext ?? "", /could not complete/);
  await project.write({ path: "premise.json", content: '{"version":1}' });
  assert.equal(hook({ projectDirectory: project.projectDirectory, event: "Stop", fields: { stop_hook_active: true } }).decision, undefined);
});

test("Claude retains the original completion gate after changing to an unconfigured directory", async (t) => {
  const project = await createProject({ t });
  const elsewhere = await createProject({ t, configured: false });
  const executable = resolve("dist/adapters/claude-launcher.js");
  const environment = { CLAUDE_PROJECT_DIR: project.projectDirectory };
  hook({ projectDirectory: project.projectDirectory, event: "SessionStart", executable, environment });
  await project.write({ path: "src/catalog.ts", content: "export function queryProducts() { return []; }\n" });

  const output = hook({ projectDirectory: elsewhere.projectDirectory, event: "Stop", executable, environment });

  assert.equal(output.decision, "block");
  assert.match(output.reason ?? "", /QUERY-001/);
});
