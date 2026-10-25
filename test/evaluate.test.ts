import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { evaluateRepository } from "../src/evaluate.js";
import { fingerprintOf } from "../src/fingerprint.js";
import { checkExitCode, formatEvaluations } from "../src/format.js";
import { createDecision, decisionProject, noDbFingerprint, noDbRule } from "./support/fixtures.js";
import { commitAll } from "./support/git.js";
import { createProject, writeFiles } from "./support/project.js";

const signedNoDb = { check: "no-db", fingerprint: noDbFingerprint };

async function evaluate({ t, files }: { t: TestContext; files: Record<string, string> }) {
  const projectDirectory = await createProject({ t, files });
  return (await evaluateRepository({ projectDirectory })).evaluations;
}

test("a decision whose checks pass and match their fingerprints holds", async (t) => {
  const evaluations = await evaluate({
    t,
    files: decisionProject({ decisions: [createDecision({ id: "ADR-001", enforced_by: [signedNoDb] })] }),
  });

  assert.equal(evaluations[0]?.state, "holds");
  assert.equal(checkExitCode({ evaluations }), 0);
});

test("a failing enforcing check makes the decision violated, ahead of reconsider", async (t) => {
  const evaluations = await evaluate({
    t,
    files: decisionProject({
      decisions: [createDecision({ id: "ADR-001", enforced_by: [signedNoDb], supported_by: [{ check: "PAY-001" }] })],
      violations: ["no-db"],
    }),
  });

  assert.equal(evaluations[0]?.state, "violated");
  assert.equal(checkExitCode({ evaluations }), 1);
});

test("a failing supporting check makes the decision reconsider", async (t) => {
  const evaluations = await evaluate({
    t,
    files: decisionProject({
      decisions: [createDecision({ id: "ADR-001", supported_by: [{ check: "PAY-001" }] })],
      cases: [{ name: "@PAY-001 sorts", outcome: "failed" }],
    }),
  });

  assert.equal(evaluations[0]?.state, "reconsider");
});

test("an enforcing check that no report contains makes the decision reconsider", async (t) => {
  const evaluations = await evaluate({
    t,
    files: decisionProject({ decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-cache" }] })] }),
  });

  assert.equal(evaluations[0]?.state, "reconsider");
});

test("an unsigned or changed link makes the decision stale", async (t) => {
  const unsigned = await evaluate({
    t,
    files: decisionProject({ decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db" }] })] }),
  });
  const changed = await evaluate({
    t,
    files: decisionProject({
      decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db", fingerprint: fingerprintOf("old\n") }] })],
    }),
  });

  assert.equal(unsigned[0]?.state, "stale");
  assert.equal(unsigned[0]?.links[0]?.drift, "unsigned");
  assert.equal(changed[0]?.links[0]?.drift, "changed");
  assert.equal(changed[0]?.links[0]?.recovery?.status, "unrecoverable");
  assert.equal(checkExitCode({ evaluations: changed }), 1);
});

test("a stale decision with sign-off none is a warning that exits zero", async (t) => {
  const evaluations = await evaluate({
    t,
    files: decisionProject({
      decisions: [createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db" }], signoff: "none" })],
      config: { signoff: { default: "human", allowed: ["human", "none"] } },
    }),
  });

  assert.equal(evaluations[0]?.state, "stale");
  assert.match(formatEvaluations({ evaluations }), /^ADR-001 stale \(warning: signoff none\)$/m);
  assert.equal(checkExitCode({ evaluations }), 0);
});

test("proposed and superseded decisions are not evaluated", async (t) => {
  const evaluations = await evaluate({
    t,
    files: decisionProject({
      decisions: [
        createDecision({ id: "ADR-001", status: "proposed", enforced_by: [{ check: "no-cache" }] }),
        createDecision({ id: "ADR-002", status: "superseded" }),
        createDecision({ id: "ADR-003", supersedes: "ADR-002" }),
      ],
    }),
  });

  assert.deepEqual(evaluations.map((evaluation) => evaluation.decision.id), ["ADR-003"]);
});

test("output lists every link, sorted by check ID, with its result and drift", async (t) => {
  const evaluations = await evaluate({
    t,
    files: decisionProject({
      decisions: [createDecision({ id: "ADR-001", enforced_by: [signedNoDb], supported_by: [{ check: "PAY-001" }] })],
    }),
  });

  assert.equal(
    formatEvaluations({ evaluations }),
    [
      "ADR-001 reconsider",
      "  supported_by PAY-001: unknown (not found in any report), drift: unavailable",
      "  enforced_by no-db: passed",
      "",
    ].join("\n"),
  );
});

test("a changed link shows the signed text recovered from git beside the current text", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: {
      ...decisionProject({
        decisions: [createDecision({ id: "ADR-001", enforced_by: [signedNoDb] })],
        config: { dependency_cruiser_config: ".dependency-cruiser.json" },
      }),
      ".dependency-cruiser.json": JSON.stringify({ forbidden: [noDbRule] }),
    },
  });
  commitAll({ projectDirectory, message: "signed" });
  await writeFiles({
    projectDirectory,
    files: { ".dependency-cruiser.json": JSON.stringify({ forbidden: [{ ...noDbRule, to: { path: "mysql" } }] }) },
  });

  const output = formatEvaluations({ evaluations: (await evaluateRepository({ projectDirectory })).evaluations });

  assert.match(
    output,
    /^ADR-001 stale\n  enforced_by no-db: passed, drift: changed\n    signed at [0-9a-f]{7}:\n      \{"from":\{"path":"\^src"\},"name":"no-db","severity":"error","to":\{"path":"pg"\}\}\n    current:\n      \{"from":\{"path":"\^src"\},"name":"no-db","severity":"error","to":\{"path":"mysql"\}\}\n$/,
  );
});

test("@DET-001 identical inputs produce identical check output", async (t) => {
  const first = createDecision({ id: "ADR-001", enforced_by: [{ check: "no-db" }] });
  const second = createDecision({ id: "ADR-002", supported_by: [{ check: "PAY-001" }] });
  const files = decisionProject({ decisions: [first, second], cases: [{ name: "@PAY-001 x", outcome: "skipped" }] });
  const reversed = decisionProject({ decisions: [second, first], cases: [{ name: "@PAY-001 x", outcome: "skipped" }] });

  const projectA = await createProject({ t, files });
  const projectB = await createProject({ t, files: {} });
  await writeFiles({ projectDirectory: projectB, files: reversed });

  const outputA = formatEvaluations({ evaluations: (await evaluateRepository({ projectDirectory: projectA })).evaluations });
  const outputB = formatEvaluations({ evaluations: (await evaluateRepository({ projectDirectory: projectB })).evaluations });

  assert.equal(outputA, outputB);
  assert.match(outputA, /^ADR-001 /);
});
