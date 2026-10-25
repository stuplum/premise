import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Decision } from "../src/model.js";
import { renderDecision, renderDecisions } from "../src/render.js";
import { runPremise } from "./support/cli.js";
import { configFile, createDecision, decisionFiles } from "./support/fixtures.js";
import { createProject } from "./support/project.js";

const decision: Decision = {
  id: "ADR-002",
  title: "Read the repository's own reports",
  status: "accepted",
  date: "2026-10-25",
  context: "Premise ran checks itself.\n",
  options: [
    { name: "Read reports", pros: ["No duplicated tests"], cons: ["Reports must exist first"] },
    { name: "Run checks", pros: [], cons: ["Duplicated tests"] },
  ],
  decision: "Read reports",
  because: ["Detection belongs to the repository's tools"],
  consequences: ["CI publishes reports before premise check"],
  scope: ["src/**"],
  supportedBy: [{ check: "DET-001" }],
  enforcedBy: [{ check: "no-test-runner-imports", fingerprint: `sha256:${"a".repeat(64)}` }],
  signoff: "human",
  owners: [],
  supersedes: "ADR-001",
  uri: "decisions/ADR-002.yaml",
};

test("a decision renders to Markdown with every field", () => {
  assert.equal(
    renderDecision({ decision, supersededBy: "ADR-003" }),
    [
      "# ADR-002: Read the repository's own reports",
      "",
      "- Status: accepted",
      "- Date: 2026-10-25",
      "- Sign-off: human",
      "- Supersedes: [ADR-001](ADR-001.md)",
      "- Superseded by: [ADR-003](ADR-003.md)",
      "",
      "## Context",
      "",
      "Premise ran checks itself.",
      "",
      "## Options",
      "",
      "### Read reports",
      "",
      "- Pro: No duplicated tests",
      "- Con: Reports must exist first",
      "",
      "### Run checks",
      "",
      "- Con: Duplicated tests",
      "",
      "## Decision",
      "",
      "Read reports",
      "",
      "## Because",
      "",
      "- Detection belongs to the repository's tools",
      "",
      "## Consequences",
      "",
      "- CI publishes reports before premise check",
      "",
      "## Checks",
      "",
      "- Supported by: `DET-001`",
      "- Enforced by: `no-test-runner-imports`",
      "",
      "## Scope",
      "",
      "- `src/**`",
      "",
    ].join("\n"),
  );
});

test("empty sections are left out", () => {
  const rendered = renderDecision({
    decision: { ...decision, consequences: [], scope: [], supportedBy: [], enforcedBy: [], supersedes: undefined },
    supersededBy: undefined,
  });

  assert.doesNotMatch(rendered, /## Consequences|## Checks|## Scope|Supersedes|Superseded by/);
});

test("render writes one Markdown file per decision", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: {
      ...configFile(),
      ...decisionFiles({
        decisions: [createDecision({ id: "ADR-001", status: "superseded" }), createDecision({ id: "ADR-002", supersedes: "ADR-001" })],
      }),
    },
  });

  const written = await renderDecisions({ projectDirectory, out: "rendered" });
  const cli = runPremise({ projectDirectory, args: ["render", "--out", "rendered"] });

  assert.deepEqual(written, ["rendered/ADR-001.md", "rendered/ADR-002.md"]);
  assert.match(await readFile(join(projectDirectory, "rendered/ADR-001.md"), "utf8"), /- Superseded by: \[ADR-002\]\(ADR-002\.md\)/);
  assert.equal(cli.status, 0);
  assert.equal(cli.stdout, "rendered/ADR-001.md\nrendered/ADR-002.md\n");
});

test("render writes to an absolute output directory as given", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: { ...configFile(), ...decisionFiles({ decisions: [createDecision({ id: "ADR-001" })] }) },
  });
  const out = await createProject({ t, files: {} });

  const written = await renderDecisions({ projectDirectory, out });

  assert.deepEqual(written, [join(out, "ADR-001.md")]);
  assert.match(await readFile(join(out, "ADR-001.md"), "utf8"), /^# ADR-001: /);
});
