import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryDirectory = resolve(process.env.PREMISE_REPOSITORY ?? process.cwd());
const cliPath = join(repositoryDirectory, "dist/cli.js");
const transportPath = fileURLToPath(new URL("./jev-transport.mjs", import.meta.url));

export const originalDecision = [
  'Decision QUERY-010 "Query upstream systems directly"',
  "Driven by premise QUERY-001",
  "Choose return upstream results without a local query model",
  "Because consumers only need the complete upstream dataset",
  "Accept upstream ordering",
  "",
].join("\n");

export const originalImplementation = [
  'const products = [{ name: "Pear" }, { name: "Apple" }];',
  "export function queryProducts() {",
  "  return products;",
  "}",
  "",
].join("\n");

export const sortedImplementation = [
  'const products = [{ name: "Pear" }, { name: "Apple" }];',
  "export function queryProducts() {",
  "  return [...products].sort((left, right) => left.name.localeCompare(right.name));",
  "}",
  "",
].join("\n");

export const originalRequirement = [
  "@QUERY-001",
  "Feature: Query aggregated products",
  "  Scenario: Return products from upstream systems",
  "    Then the query returns every product",
  "",
].join("\n");

export const sortedRequirement = `${originalRequirement.trimEnd()}\n    And products are ordered by name\n`;

export type AgentReport = {
  status: "ready" | "passed" | "blocked" | "inactive";
  blockers: Array<{
    kind: "premise" | "decision" | "history" | "evaluation" | "session";
    id?: string;
    state?: string;
    source?: { uri: string };
    message: string;
  }>;
  advisories: Array<{
    id: string;
    status: "supported" | "concern" | "uncertain" | "unavailable";
  }>;
};

export type ContextReport = {
  artifact: string;
  knowledge: Array<{
    id: string;
    kind: "premise" | "decision";
    source: { uri: string };
    state: { status: string };
  }>;
};

export async function createProject({
  t,
  configured = true,
}: {
  t: Pick<TestContext, "after">;
  configured?: boolean;
}) {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-agent-fixture-"));
  t.after(() => rm(projectDirectory, { recursive: true, force: true }));
  const sessionId = randomUUID();
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) =>
      value !== undefined && !key.startsWith("JEV_") &&
      !key.startsWith("PREMISE_") && key !== "TYPESAFE_AI_API_KEY" &&
      key !== "NODE_OPTIONS",
    ),
  );
  environment.NODE_OPTIONS = `--import=${pathToFileURL(transportPath).href}`;
  environment.PREMISE_TEST_JEV_RESPONSE = join(projectDirectory, "jev-response.json");

  async function write({ path, content }: { path: string; content: string }) {
    const destination = join(projectDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }

  function read(path: string) {
    return readFile(join(projectDirectory, path), "utf8");
  }

  function remove(path: string) {
    return rm(join(projectDirectory, path), { recursive: true, force: true });
  }

  function command(arguments_: string[]) {
    const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
      cwd: projectDirectory,
      encoding: "utf8",
      env: environment,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
  }

  function successfulCommand(arguments_: string[]) {
    const result = command(arguments_);
    assert.equal(result.status, 0, `${arguments_.join(" ")}\n${result.stdout}${result.stderr}`);
    return result.stdout;
  }

  function agent({ action, artifact }: { action: "start" | "stop" | "context"; artifact?: string }) {
    const arguments_ = ["agent", action, ...(artifact ? [artifact] : []), "--session", sessionId];
    return JSON.parse(successfulCommand(arguments_)) as AgentReport & ContextReport;
  }

  function review(decisionId = "QUERY-010") {
    successfulCommand(["review", decisionId]);
  }

  async function supersede() {
    await write({
      path: "decisions/QUERY-011.decision",
      content: [
        'Decision QUERY-011 "Apply a local query model"',
        "Driven by premise QUERY-001",
        "Choose apply deterministic name ordering to aggregated products",
        "Because consumers now require cross-source sorting",
        "Accept local query processing",
        "Supersedes QUERY-010",
        "",
      ].join("\n"),
    });
    review("QUERY-011");
  }

  async function enableJev({ probability, unavailable = false }: { probability?: number; unavailable?: boolean }) {
    await write({
      path: "premise.json",
      content: JSON.stringify({ version: 1, jev: { questions: "questions.json" } }),
    });
    await write({
      path: "questions.json",
      content: JSON.stringify({
        version: 1,
        model: "jev-1.13.0",
        thresholds: { established: 0.8, failed: 0.2 },
        contextPaths: ["src/catalog.ts", "features/query.feature"],
        questions: {
          "REVIEW-001": {
            description: "The current decision remains justified by the query requirements",
            instructions: "Does the active query decision remain justified by the supplied requirements and implementation?",
            criteria: {
              true: "The choice is compatible with the current requirements and implementation.",
              false: "The choice conflicts with the current requirements or implementation.",
            },
          },
        },
      }),
    });
    await write({ path: "jev-response.json", content: JSON.stringify({ probability, unavailable }) });
    environment.TYPESAFE_AI_API_KEY = "premise-test-key";
  }

  if (configured) {
    await write({ path: "premise.json", content: JSON.stringify({ version: 1 }) });
    await write({ path: "package.json", content: JSON.stringify({ type: "module", private: true }) });
    await write({ path: "src/catalog.ts", content: originalImplementation });
    await write({ path: "features/query.feature", content: originalRequirement });
    await write({ path: "decisions/QUERY-010.decision", content: originalDecision });
    await write({
      path: "features/step_definitions/query.steps.ts",
      content: [
        'import assert from "node:assert/strict";',
        'import { Then } from "@stuplum/premise/cucumber";',
        'import { queryProducts } from "../../src/catalog.ts";',
        'Then("the query returns every product", () => {',
        '  assert.deepEqual(queryProducts().map(product => product.name).sort(), ["Apple", "Pear"]);',
        '});',
        'Then("products are ordered by name", () => {',
        '  assert.deepEqual(queryProducts().map(product => product.name), ["Apple", "Pear"]);',
        '});',
        "",
      ].join("\n"),
    });
    await mkdir(join(projectDirectory, "node_modules/@stuplum"), { recursive: true });
    await symlink(repositoryDirectory, join(projectDirectory, "node_modules/@stuplum/premise"), "dir");
    review();
  }

  return { agent, command, enableJev, projectDirectory, read, remove, review, supersede, write };
}
