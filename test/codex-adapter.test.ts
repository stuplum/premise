import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
    env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
      value !== undefined && !key.startsWith("JEV_") &&
      !key.startsWith("PREMISE_") && key !== "TYPESAFE_AI_API_KEY" &&
      key !== "NODE_OPTIONS",
    )),
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout || "{}") as {
    decision?: string;
    reason?: string;
    hookSpecificOutput?: {
      hookEventName: string;
      additionalContext?: string;
      permissionDecision?: string;
    };
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
  assert.match(output.hookSpecificOutput.additionalContext ?? "", /QUERY-010/);
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

test("Codex permits malformed configuration repairs while blocking completion until the repair is applied", async (t) => {
  const project = await createProject({ t });
  const common = { cwd: project.projectDirectory, session_id: "config-repair-session" };
  const configuration = await project.read("premise.json");
  hook({
    projectDirectory: project.projectDirectory,
    event: "SessionStart",
    input: { ...common, hook_event_name: "SessionStart" },
  });
  await project.write({ path: "premise.json", content: "{broken" });
  const blocked = hook({
    projectDirectory: project.projectDirectory,
    event: "Stop",
    input: { ...common, hook_event_name: "Stop", stop_hook_active: false },
  });
  assert.equal(blocked.decision, "block");
  assert.match(blocked.reason ?? "", /premise\.json/);
  const repair = hook({
    projectDirectory: project.projectDirectory,
    event: "PreToolUse",
    input: {
      ...common,
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: {
        command: [
          "*** Begin Patch",
          "*** Update File: premise.json",
          "@@",
          "-{broken",
          `+${configuration}`,
          "*** End Patch",
        ].join("\n"),
      },
    },
  });
  assert.notEqual(repair.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(repair.hookSpecificOutput?.additionalContext ?? "", /premise\.json/);
  const unrepaired = hook({
    projectDirectory: project.projectDirectory,
    event: "Stop",
    input: { ...common, hook_event_name: "Stop", stop_hook_active: true },
  });
  assert.equal(unrepaired.decision, "block");
  assert.match(unrepaired.reason ?? "", /premise\.json/);
  await project.write({ path: "premise.json", content: configuration });
  const repaired = hook({
    projectDirectory: project.projectDirectory,
    event: "Stop",
    input: { ...common, hook_event_name: "Stop", stop_hook_active: true },
  });
  assert.equal(repaired.decision, undefined);
});

test("Codex projects one coherent executable evaluation across every file in a multi-file patch", async (t) => {
  const project = await createProject({ t });
  const evidenceDirectory = await mkdtemp(join(tmpdir(), "premise-codex-evaluation-"));
  t.after(() => rm(evidenceDirectory, { recursive: true, force: true }));
  const executionsPath = join(evidenceDirectory, "executions");
  await writeFile(executionsPath, "0", "utf8");
  await project.write({
    path: "src/names.ts",
    content: [
      "export function productNames(products: Array<{ name: string }>) {",
      "  return products.map(product => product.name).sort();",
      "}",
      "",
    ].join("\n"),
  });
  await project.write({
    path: "features/step_definitions/query.steps.ts",
    content: [
      'import assert from "node:assert/strict";',
      'import { readFileSync, writeFileSync } from "node:fs";',
      'import { Then } from "@stuplum/premise/cucumber";',
      'import { queryProducts } from "../../src/catalog.ts";',
      'import { productNames } from "../../src/names.ts";',
      'Then("the query returns every product", () => {',
      '  assert.deepEqual(productNames(queryProducts()), ["Apple", "Pear"]);',
      `  const executionsPath = ${JSON.stringify(executionsPath)};`,
      '  const executions = Number(readFileSync(executionsPath, "utf8")) + 1;',
      '  writeFileSync(executionsPath, String(executions));',
      "  assert.equal(executions, 1);",
      "});",
      "",
    ].join("\n"),
  });
  const common = { cwd: project.projectDirectory, session_id: "coherent-patch-session" };
  hook({
    projectDirectory: project.projectDirectory,
    event: "SessionStart",
    input: { ...common, hook_event_name: "SessionStart" },
  });
  const output = hook({
    projectDirectory: project.projectDirectory,
    event: "PreToolUse",
    input: {
      ...common,
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: {
        command: [
          "*** Begin Patch",
          "*** Update File: src/catalog.ts",
          "@@",
          "-  return products;",
          "+  return [...products];",
          "*** Update File: src/names.ts",
          "@@",
          "-  return products.map(product => product.name).sort();",
          "+  return products.map(({ name }) => name).sort();",
          "*** End Patch",
        ].join("\n"),
      },
    },
  });
  assert.notEqual(output.hookSpecificOutput?.permissionDecision, "deny");
  const contexts = (output.hookSpecificOutput?.additionalContext ?? "")
    .split("Premise context for ").slice(1);
  assert.deepEqual(contexts.map(context => context.slice(0, context.indexOf(":\n"))), [
    "src/catalog.ts",
    "src/names.ts",
  ]);
  for (const context of contexts) {
    assert.match(context, /QUERY-001\n[^\n]*\n\s+established\b/);
    assert.match(context, /QUERY-010/);
    assert.doesNotMatch(context, /\n\s+(failed|unknown)\n/);
  }
  assert.equal(await readFile(executionsPath, "utf8"), "1");
});
