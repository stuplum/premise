import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, symlink } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { createProject } from "./lifecycle-fixture.js";

const adapter = resolve("dist/adapters/codex.js");

function hook({
  projectDirectory,
  event,
  input,
  executable = adapter,
}: {
  projectDirectory: string;
  event: string;
  input: unknown;
  executable?: string;
}) {
  const result = spawnSync(process.execPath, [executable, event], {
    cwd: projectDirectory,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout || "{}") as {
    decision?: string;
    reason?: string;
    hookSpecificOutput?: { hookEventName: string; additionalContext: string };
  };
}

test("starts the configured workflow when the installed hook path is a symbolic link", async (t) => {
  const project = await createProject({ t });
  const alias = join(project.projectDirectory, "codex-hook.mjs");
  await symlink(adapter, alias);
  const output = hook({
    executable: alias,
    event: "SessionStart",
    projectDirectory: project.projectDirectory,
    input: { cwd: project.projectDirectory, session_id: "symlink-session", hook_event_name: "SessionStart" },
  });
  assert.equal(output.hookSpecificOutput?.hookEventName, "SessionStart");
  assert.match(output.hookSpecificOutput.additionalContext, /QUERY-010/);
});

test("continues to block mechanical failures after an earlier stop continuation", async (t) => {
  const project = await createProject({ t });
  const common = { cwd: project.projectDirectory, session_id: "repair-session" };
  hook({ projectDirectory: project.projectDirectory, event: "SessionStart", input: { ...common, hook_event_name: "SessionStart" } });
  await project.write({ path: "src/catalog.ts", content: "export function queryProducts() { return []; }\n" });
  for (const stop_hook_active of [false, true]) {
    const output = hook({
      projectDirectory: project.projectDirectory,
      event: "Stop",
      input: { ...common, hook_event_name: "Stop", stop_hook_active },
    });
    assert.equal(output.decision, "block");
    assert.match(output.reason ?? "", /QUERY-001/);
  }
});

test("blocks a malformed stop event rather than silently accepting completion", async (t) => {
  const project = await createProject({ t });
  const output = hook({ projectDirectory: project.projectDirectory, event: "Stop", input: "{broken" });
  assert.equal(output.decision, "block");
});

test("uses the harness blocking exit code when the hook cannot be loaded", { skip: process.platform === "win32" }, async (t) => {
  const project = await createProject({ t });
  const configuration = JSON.parse(await readFile(resolve("hooks/codex.json"), "utf8"));
  const command = configuration.hooks.Stop[0].hooks[0].command as string;
  const result = spawnSync("/bin/sh", ["-c", command], {
    cwd: project.projectDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
      PLUGIN_ROOT: join(project.projectDirectory, "unavailable-plugin"),
    },
    input: "{}",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 2);
});
