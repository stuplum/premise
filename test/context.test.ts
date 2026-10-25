import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { decisionsForFile, formatContext } from "../src/context.js";
import { assertConfigurationError } from "./support/assertions.js";
import { runPremise } from "./support/cli.js";
import { configFile, createDecision, decisionFiles, dependencyCruiserReport } from "./support/fixtures.js";
import { createProject, writeFiles } from "./support/project.js";

const sources = { "src/adapters/a.ts": "export {};\n", "src/domain/d.ts": "export {};\n", "src/x.ts": "export {};\n" };

function ids(result: { decisions: { id: string }[] }) {
  return result.decisions.map((decision) => decision.id);
}

test("@CTX-002 context reflects the current scope without a generated index", async (t) => {
  const decision = createDecision({ id: "ADR-001", scope: ["src/adapters/**"] });
  const projectDirectory = await createProject({ t, files: { ...configFile(), ...decisionFiles({ decisions: [decision] }), ...sources } });

  const before = await decisionsForFile({ projectDirectory, file: "src/adapters/a.ts" });
  await writeFiles({ projectDirectory, files: { "decisions/ADR-001.yaml": stringify({ ...decision, scope: ["src/domain/**"] }) } });
  const after = await decisionsForFile({ projectDirectory, file: "src/adapters/a.ts" });

  assert.deepEqual(ids(before), ["ADR-001"]);
  assert.deepEqual(ids(after), []);
});

test("a linked dependency-cruiser rule's from path selects files, minus pathNot", async (t) => {
  const files = (from: Record<string, unknown>) => ({
    ...configFile({ reports: [{ format: "dependency-cruiser", path: "reports/depcruise.json" }] }),
    ...decisionFiles({ decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db" }] })] }),
    "reports/depcruise.json": dependencyCruiserReport({ rules: [{ name: "no-db", from, to: { path: "pg" } }] }),
    ...sources,
  });
  const included = await createProject({ t, files: files({ path: "^src/" }) });
  const excluded = await createProject({ t, files: files({ path: "^src/", pathNot: "^src/x" }) });

  assert.deepEqual(ids(await decisionsForFile({ projectDirectory: included, file: "src/x.ts" })), ["ADR-001"]);
  assert.deepEqual(ids(await decisionsForFile({ projectDirectory: excluded, file: "src/x.ts" })), []);
});

test("without a dependency-cruiser report, context says it matched by scope only", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: {
      ...configFile({ reports: [{ format: "dependency-cruiser", path: "reports/depcruise.json" }] }),
      ...decisionFiles({ decisions: [createDecision({ id: "ADR-001", scope: ["src/x.ts"] })] }),
      ...sources,
    },
  });

  const result = await decisionsForFile({ projectDirectory, file: "src/x.ts" });

  assert.deepEqual(ids(result), ["ADR-001"]);
  assert.deepEqual(result.notes, ["No dependency-cruiser report matches reports/depcruise.json; matched by scope only."]);
});

test("proposed decisions are not part of context", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: { ...configFile(), ...decisionFiles({ decisions: [createDecision({ id: "ADR-001", status: "proposed", scope: ["src/**"] })] }), ...sources },
  });

  assert.deepEqual(ids(await decisionsForFile({ projectDirectory, file: "src/x.ts" })), []);
});

test("a file outside the project is a configuration error", async (t) => {
  const projectDirectory = await createProject({ t, files: configFile() });

  await assertConfigurationError({
    action: decisionsForFile({ projectDirectory, file: "../elsewhere.ts" }),
    pattern: /\.\.\/elsewhere\.ts is outside the project/,
  });
});

test("context output lists title, decision and reasons", async (t) => {
  const decision = createDecision({
    id: "ADR-001",
    title: "Keep adapters apart",
    options: [{ name: "Separate adapters" }],
    decision: "Separate adapters",
    because: ["Targets combine adapters", "Adapters stay swappable"],
    scope: ["src/adapters/**"],
  });
  const projectDirectory = await createProject({ t, files: { ...configFile(), ...decisionFiles({ decisions: [decision] }), ...sources } });

  const expected = [
    "ADR-001 Keep adapters apart",
    "  decision: Separate adapters",
    "  because:",
    "    - Targets combine adapters",
    "    - Adapters stay swappable",
    "",
  ].join("\n");

  assert.equal(formatContext(await decisionsForFile({ projectDirectory, file: "src/adapters/a.ts" })), expected);
  assert.equal(runPremise({ projectDirectory, args: ["context", "src/adapters/a.ts"] }).stdout, expected);
  assert.equal(
    formatContext(await decisionsForFile({ projectDirectory, file: "src/x.ts" })),
    "No accepted decisions apply to src/x.ts.\n",
  );
});
