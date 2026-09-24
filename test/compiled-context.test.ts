import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  compilePremiseEvaluations,
  readArtifactContext,
} from "../src/compiled-context.js";
import type { PremiseEvaluation } from "../src/provider.js";

test("compiled context retains premises and evidence from different providers", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-context-test-"));
  const artifact = "src/orders/update-order.ts";
  const evaluations: PremiseEvaluation[] = [
    {
      premise: {
        assertion: {
          dialect: "gherkin",
          ref: { selector: "@ORDER-007", uri: "features/orders.feature" },
        },
        description: "A dispatched order cannot be modified",
        id: "ORDER-007",
        type: "behaviour",
      },
      provider: "cucumber",
      result: {
        evidence: [
          { role: "assertion", uri: "features/orders.feature" },
          { role: "executed", uri: artifact },
        ],
        status: "established",
      },
    },
    {
      premise: {
        assertion: {
          dialect: "dependency-cruiser",
          ref: { selector: "no-http-in-domain", uri: ".dependency-cruiser.cjs" },
        },
        description: "Domain code must not depend on HTTP",
        id: "ARCH-003",
        type: "architecture",
      },
      provider: "dependency-cruiser",
      result: {
        evidence: [
          { role: "assertion", uri: ".dependency-cruiser.cjs" },
          { role: "subject", uri: artifact },
        ],
        status: "established",
      },
    },
  ];

  try {
    await compilePremiseEvaluations({ evaluations, projectDirectory });

    const context = await readArtifactContext({ artifact, projectDirectory });

    assert.equal(context?.version, 2);
    assert.deepEqual(
      context?.premises.map(({ id, provider }) => ({ id, provider })),
      [
        { id: "ARCH-003", provider: "dependency-cruiser" },
        { id: "ORDER-007", provider: "cucumber" },
      ],
    );
    assert.ok(
      context?.premises.every(({ evidence }) =>
        evidence.some(({ uri }) => uri === artifact),
      ),
    );
  } finally {
    await rm(projectDirectory, { force: true, recursive: true });
  }
});

test("version one compiled context requires regeneration", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-context-test-"));
  const artifact = "src/orders/update-order.ts";
  const path = join(projectDirectory, `.premise/compiled/${artifact}.json`);

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ artifact, requirements: [], version: 1 })}\n`,
      "utf8",
    );

    await assert.rejects(
      readArtifactContext({ artifact, projectDirectory }),
      /Compiled context version 1 is no longer supported.*Run premise test/,
    );
  } finally {
    await rm(projectDirectory, { force: true, recursive: true });
  }
});
