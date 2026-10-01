import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runAgentContexts, runAgentStart, runAgentStop } from "../src/agent-lifecycle.js";
import { createProject, originalImplementation } from "./lifecycle-fixture.js";

for (const extension of ["js", "cjs"]) {
  test(`agent evaluations reload ${extension} architecture rules and their imports in one process`, async (t) => {
    const projectDirectory = await mkdtemp(join(tmpdir(), "premise-agent-freshness-"));
    t.after(() => rm(projectDirectory, { force: true, recursive: true }));
    const input = { projectDirectory, sessionId: `fresh-${extension}` };
    const commonJs = extension === "cjs";
    const configPath = join(projectDirectory, `.dependency-cruiser.${extension}`);
    const supportingPath = join(projectDirectory, `architecture-rules.${extension}`);
    const config = (target: string) => [
      commonJs
        ? `const { rule } = require("./architecture-rules.${extension}");`
        : `import { rule } from "./architecture-rules.${extension}";`,
      `${commonJs ? "module.exports =" : "export default"} {`,
      `  forbidden: [rule(${JSON.stringify(target)})],`,
      '  options: { includeOnly: "^src", doNotFollow: { path: "node_modules" } },',
      "};",
      "",
    ].join("\n");
    const supportingConfig = (useArgument: boolean) => [
      `${commonJs ? "exports.rule = function" : "export function rule"}(target) {`,
      "  return {",
      '    name: "ARCH-001",',
      '    comment: "Domain must not depend on infrastructure",',
      '    severity: "error",',
      '    from: { path: new RegExp("^src/domain").source },',
      `    to: { path: ${useArgument ? "target" : '"^src/not-present"'} },`,
      "  };",
      "}",
      "",
    ].join("\n");
    await mkdir(join(projectDirectory, "src"));
    await writeFile(join(projectDirectory, "package.json"), '{"type":"module"}\n');
    await writeFile(join(projectDirectory, "premise.json"), '{"version":1}\n');
    await writeFile(join(projectDirectory, "src/domain.js"), 'export { value } from "./infrastructure.js";\n');
    await writeFile(join(projectDirectory, "src/infrastructure.js"), "export const value = 1;\n");
    await writeFile(supportingPath, supportingConfig(true));
    await writeFile(configPath, config("^src/not-present"));

    assert.equal((await runAgentStart(input)).status, "ready");
    assert.equal((await runAgentStop(input)).status, "passed");
    const state = async () => {
      const [context] = await runAgentContexts({ ...input, artifacts: ["src/domain.js"] });
      const premise = context.knowledge.find(({ id }) => id === "ARCH-001");
      assert.ok(premise);
      assert.equal(premise.source.selector, "ARCH-001");
      return premise.state.status;
    };
    assert.equal(await state(), "established");

    await writeFile(configPath, config("^src/infrastructure"));
    const failed = await runAgentStop(input);
    assert.equal(failed.status, "blocked");
    assert.ok(failed.blockers.some(({ kind, id, state }) =>
      kind === "premise" && id === "ARCH-001" && state === "failed",
    ));
    assert.equal(await state(), "failed");

    await writeFile(supportingPath, supportingConfig(false));
    assert.equal((await runAgentStop(input)).status, "passed");
    assert.equal(await state(), "established");

    await writeFile(supportingPath, supportingConfig(true));
    assert.equal(await state(), "failed");
    assert.equal((await runAgentStop(input)).status, "blocked");

    await writeFile(configPath, config("^src/not-present"));
    assert.equal(await state(), "established");
    assert.equal((await runAgentStop(input)).status, "passed");

    await writeFile(supportingPath, `${supportingConfig(true)}\nthrow new Error("architecture configuration is broken");\n`);
    const invalid = await runAgentStop(input);
    assert.equal(invalid.status, "blocked");
    assert.ok(invalid.blockers.some(({ kind }) => kind === "evaluation"));
    await assert.rejects(
      runAgentContexts({ ...input, artifacts: ["src/domain.js"] }),
      /architecture configuration is broken/,
    );

    await writeFile(supportingPath, supportingConfig(true));
    assert.equal((await runAgentStop(input)).status, "passed");
    assert.equal(await state(), "established");
  });
}

for (const host of ["codex", "claude"]) {
  test(`${host} blocks completion when executable evidence changes its inputs after passing`, async (t) => {
    const project = await createProject({ t });
    const steps = await project.read("features/step_definitions/query.steps.ts");
    const brokenImplementation = "export function queryProducts() { return []; }\n";
    await project.write({
      path: "features/step_definitions/query.steps.ts",
      content: [
        'import assert from "node:assert/strict";',
        'import { writeFile } from "node:fs/promises";',
        'import { Then } from "@stuplum/premise/cucumber";',
        'import { queryProducts } from "../../src/catalog.ts";',
        'Then("the query returns every product", async () => {',
        '  assert.deepEqual(queryProducts().map(product => product.name).sort(), ["Apple", "Pear"]);',
        `  await writeFile(new URL("../../src/catalog.ts", import.meta.url), ${JSON.stringify(brokenImplementation)});`,
        '});',
        '',
      ].join("\n"),
    });
    const executable = resolve(`dist/adapters/${host}-launcher.js`);
    const environment = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "TYPESAFE_AI_API_KEY" && key !== "NODE_OPTIONS")),
      CLAUDE_PROJECT_DIR: project.projectDirectory,
    };
    const call = (event: "SessionStart" | "Stop") => {
      const result = spawnSync(process.execPath, [executable, event], {
        cwd: project.projectDirectory,
        env: environment,
        encoding: "utf8",
        input: JSON.stringify({ cwd: project.projectDirectory, session_id: "changed-evidence", hook_event_name: event, stop_hook_active: false }),
        timeout: 30_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as { decision?: string };
    };
    call("SessionStart");

    const result = call("Stop");

    assert.equal(await project.read("src/catalog.ts"), brokenImplementation);
    assert.equal(result.decision, "block");
    await project.write({ path: "features/step_definitions/query.steps.ts", content: steps });
    await project.write({ path: "src/catalog.ts", content: originalImplementation });
    assert.equal(call("Stop").decision, undefined);
  });
}

test("declared Cucumber reports cannot hide changes to an executed implementation", async (t) => {
  const project = await createProject({ t });
  await project.write({
    path: "cucumber.cjs",
    content: 'module.exports = { default: { format: process.argv.includes("--dry-run") ? [] : ["json:src/catalog.ts"] } };\n',
  });
  project.agent({ action: "start" });

  const result = project.agent({ action: "stop" });

  assert.notEqual(await project.read("src/catalog.ts"), originalImplementation);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some(({ message }) => message.includes("src/catalog.ts")));
});
