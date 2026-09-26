import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAgentContext, runAgentStart, runAgentStop } from "../src/agent-lifecycle.js";

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
      const context = await runAgentContext({ ...input, artifact: "src/domain.js" });
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
      runAgentContext({ ...input, artifact: "src/domain.js" }),
      /architecture configuration is broken/,
    );

    await writeFile(supportingPath, supportingConfig(true));
    assert.equal((await runAgentStop(input)).status, "passed");
    assert.equal(await state(), "established");
  });
}
