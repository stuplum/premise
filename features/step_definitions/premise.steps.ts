import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  After,
  Given,
  Then,
  When,
  setWorldConstructor,
  type IWorldOptions,
} from "@cucumber/cucumber";
import { createDependencyCruiserProvider } from "../../src/providers/dependency-cruiser-provider.js";
import type {
  EvaluationResult,
  Premise,
  PremiseProviderSession,
} from "../../src/provider.js";

const cliPath = resolve("dist/cli.js");
const originalRequirement = "Feature: Take a payment\n";
const changedRequirement = "Feature: Take independent payments\n";

type PremiseConfiguration = {
  cucumber?: { features: string[]; steps: string[] };
  version: 1;
};

class PremiseWorld {
  contextProjection?: {
    knowledge: Array<{ id: string; kind: string }>;
  };
  environment: Record<string, string> = {};
  projectDirectory = "";
  providerProjects: string[] = [];
  providerSessionEvaluations: Array<{
    premise: Premise;
    result: EvaluationResult;
  }> = [];
  result?: SpawnSyncReturns<string>;

  constructor(_options: IWorldOptions) {}
}

setWorldConstructor(PremiseWorld);

Given(
  "two projects define distinct architecture premises",
  async function (this: PremiseWorld) {
    this.providerProjects = await Promise.all(
      ["ARCH-101", "ARCH-202"].map(createArchitectureProviderProject),
    );
  },
);

When(
  "I prepare both projects with the same provider before evaluating either",
  async function (this: PremiseWorld) {
    const provider = createDependencyCruiserProvider();
    const prepared: Array<{
      premise: Premise;
      session: PremiseProviderSession;
    }> = [];

    for (const projectDirectory of this.providerProjects) {
      const session = await provider.prepare({ projectDirectory });
      const [premise] = await session.discover();
      assert.ok(premise, `No premise discovered in ${projectDirectory}`);
      prepared.push({ premise, session });
    }

    this.providerSessionEvaluations = await Promise.all(
      prepared.map(async ({ premise, session }) => ({
        premise,
        result: await session.evaluate(premise),
      })),
    );
  },
);

Then(
  "each provider session establishes its own architecture premise",
  function (this: PremiseWorld) {
    assert.deepEqual(
      this.providerSessionEvaluations.map(({ premise, result }) => ({
        id: premise.id,
        status: result.status,
      })),
      [
        { id: "ARCH-101", status: "established" },
        { id: "ARCH-202", status: "established" },
      ],
    );
  },
);

Given("an empty project", async function (this: PremiseWorld) {
  this.projectDirectory = await mkdtemp(join(tmpdir(), "premise-acceptance-"));
});

Given(
  "a project with legacy manual relationship configuration",
  async function (this: PremiseWorld) {
    this.projectDirectory = await mkdtemp(join(tmpdir(), "premise-acceptance-"));
    await writeJson(join(this.projectDirectory, "premise.json"), {
      requirements: {
        "PAY-001": {
          affects: ["src/payment.ts"],
          source: "features/PAY-001.feature",
        },
      },
      version: 1,
    });
  },
);

Given(
  "requirement {string} has changed",
  async function (this: PremiseWorld, requirementId: string) {
    const path = `features/${requirementId}.feature`;
    const existing = await readFile(join(this.projectDirectory, path), "utf8");
    await writeProjectFile({
      content: existing.replace(originalRequirement.trim(), changedRequirement.trim()),
      projectDirectory: this.projectDirectory,
      relativePath: path,
    });
  },
);

Given(
  "requirement {string} exists",
  async function (this: PremiseWorld, requirementId: string) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: [
        `@${requirementId}`,
        "Feature: Take a payment",
        "  Scenario: Accept a valid payment",
        "    When the customer pays",
        "    Then the payment is accepted",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: `features/${requirementId}.feature`,
    });
    await writeProjectFile({
      content: [
        'import { When, Then } from "@stuplum/premise/cucumber";',
        "",
        'When("the customer pays", function () {});',
        'Then("the payment is accepted", function () {});',
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "the payment implementation no longer satisfies the requirement",
  async function (this: PremiseWorld) {
    const path = join(this.projectDirectory, "src/payment.ts");
    const content = await readFile(path, "utf8");
    await writeFile(
      path,
      content.replace(
        'return amount > 0 ? "accepted" : "declined";',
        'return "declined";',
      ),
      "utf8",
    );
  },
);

Given(
  "decision {string} is driven by requirement {string}",
  async function (
    this: PremiseWorld,
    decisionId: string,
    requirementId: string,
  ) {
    await writeProjectFile({
      content: [
        `Decision ${decisionId} "Reliable confirmation delivery"`,
        `Driven by requirement ${requirementId}`,
        "Choose durable storage of pending confirmations",
        "Because accepted orders must survive delivery outages",
        "Accept possible duplicate delivery",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: `decisions/${decisionId}.decision`,
    });
  },
);

Given(
  "decision {string} is driven by premise {string}",
  async function (
    this: PremiseWorld,
    decisionId: string,
    premiseId: string,
  ) {
    await writeDecision({
      decisionId,
      driver: `premise ${premiseId}`,
      projectDirectory: this.projectDirectory,
    });
  },
);

Given(
  "decision {string} is driven by decision {string}",
  async function (
    this: PremiseWorld,
    decisionId: string,
    driverDecisionId: string,
  ) {
    await writeDecision({
      decisionId,
      driver: `decision ${driverDecisionId}`,
      projectDirectory: this.projectDirectory,
    });
  },
);

Given(
  "decision {string} is driven by source {string}",
  async function (this: PremiseWorld, decisionId: string, source: string) {
    await writeDecision({
      decisionId,
      driver: `source ${source}`,
      projectDirectory: this.projectDirectory,
    });
  },
);

Given(
  "decision {string} supersedes {string} for requirement {string}",
  async function (
    this: PremiseWorld,
    decisionId: string,
    supersededDecisionId: string,
    requirementId: string,
  ) {
    await writeDecision({
      decisionId,
      driver: `requirement ${requirementId}`,
      projectDirectory: this.projectDirectory,
      supersededDecisionId,
    });
  },
);

Given(
  "source {string} exists",
  async function (this: PremiseWorld, source: string) {
    await writeProjectFile({
      content: "Orders must be accepted when confirmation delivery is unavailable.\n",
      projectDirectory: this.projectDirectory,
      relativePath: source,
    });
  },
);

Given(
  "decision {string} has been reviewed",
  function (this: PremiseWorld, decisionId: string) {
    this.result = runPremise({
      arguments: ["review", decisionId],
      projectDirectory: this.projectDirectory,
    });
    assert.equal(commandResult(this).status, 0, commandOutput(this));
  },
);

Given(
  "source {string} has changed",
  async function (this: PremiseWorld, source: string) {
    const path = join(this.projectDirectory, source);
    const existing = await readFile(path, "utf8");
    await writeFile(path, `${existing.trim()}\nThe confirmation must survive a restart.\n`);
  },
);

Given("the project knowledge is committed", function (this: PremiseWorld) {
  runGit({ arguments: ["init", "--quiet"], projectDirectory: this.projectDirectory });
  runGit({ arguments: ["add", "."], projectDirectory: this.projectDirectory });
  runGit({
    arguments: [
      "-c",
      "user.name=Premise acceptance",
      "-c",
      "user.email=premise@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Baseline knowledge",
    ],
    projectDirectory: this.projectDirectory,
  });
});

When("I run {string}", function (this: PremiseWorld, command: string) {
  const [, ...arguments_] = splitCommand(command);
  this.result = runPremise({
    arguments: arguments_,
    environment: this.environment,
    projectDirectory: this.projectDirectory,
  });
});

When(
  "I run premise context with the absolute path to {string}",
  function (this: PremiseWorld, artifactPath: string) {
    this.result = spawnSync(
      process.execPath,
      [cliPath, "context", resolve(this.projectDirectory, artifactPath)],
      {
        cwd: this.projectDirectory,
        encoding: "utf8",
      },
    );
  },
);

When(
  "I run premise context with an absolute path outside the project",
  function (this: PremiseWorld) {
    this.result = spawnSync(
      process.execPath,
      [cliPath, "context", resolve(this.projectDirectory, "../outside.ts")],
      {
        cwd: this.projectDirectory,
        encoding: "utf8",
      },
    );
  },
);

When(
  "I project context for {string} through the Premise API",
  async function (this: PremiseWorld, artifact: string) {
    const { createArtifactContextProjection } = await import(
      "../../src/context-projection.js"
    );
    this.contextProjection = createArtifactContextProjection({
      artifact,
      decisions: [
        {
          drivers: [{ id: artifact, kind: "source" }],
          id: "ORDER-004",
          source: {
            selector: "ORDER-004",
            uri: "decisions/ORDER-004.decision",
          },
          state: { status: "established" },
          title: "Persist order updates",
        },
      ],
      evaluations: [],
    });
  },
);

Then("the command succeeds", function (this: PremiseWorld) {
  assert.equal(commandResult(this).status, 0, commandOutput(this));
});

Then(
  "the projection identifies decision {string} as relevant",
  function (this: PremiseWorld, decisionId: string) {
    assert.deepEqual(this.contextProjection?.knowledge, [
      {
        description: "Persist order updates",
        id: decisionId,
        kind: "decision",
        source: {
          selector: decisionId,
          uri: `decisions/${decisionId}.decision`,
        },
        state: { status: "established" },
      },
    ]);
  },
);

Then("the command fails", function (this: PremiseWorld) {
  assert.notEqual(commandResult(this).status, 0);
});

Then("the command produces no output", function (this: PremiseWorld) {
  assert.equal(commandOutput(this), "");
});

Then(
  "the command reports that {string} changed",
  function (this: PremiseWorld, requirementId: string) {
    assert.match(commandOutput(this), new RegExp(`${requirementId} changed`));
  },
);

Then(
  "the command reports {string} for reconsideration",
  function (this: PremiseWorld, affectedPath: string) {
    assert.match(commandOutput(this), new RegExp(`Reconsider:.*${escapeRegex(affectedPath)}`, "s"));
  },
);

Then(
  "the command reports decision {string} for reconsideration",
  function (this: PremiseWorld, decisionId: string) {
    assert.match(
      commandOutput(this),
      new RegExp(`Reconsider decision ${escapeRegex(decisionId)}:`),
    );
  },
);

Then(
  "the command explains how to resolve decision {string}",
  function (this: PremiseWorld, decisionId: string) {
    const output = commandOutput(this);
    assert.match(output, new RegExp(`premise review ${escapeRegex(decisionId)}`));
    assert.match(output, /Supersedes/);
  },
);

Given(
  "a passing executable requirement in the default feature directory",
  async function (this: PremiseWorld) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeExecutableRequirement({
      featureDirectory: "features",
      passing: true,
      projectDirectory: this.projectDirectory,
      stepsDirectory: "features/step_definitions",
    });
  },
);

Given(
  "a failing executable requirement in the default feature directory",
  async function (this: PremiseWorld) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeExecutableRequirement({
      featureDirectory: "features",
      passing: false,
      projectDirectory: this.projectDirectory,
      stepsDirectory: "features/step_definitions",
    });
  },
);

Given(
  "Premise is configured to find features in {string} and steps in {string}",
  async function (
    this: PremiseWorld,
    featureDirectory: string,
    stepsDirectory: string,
  ) {
    const configuration: PremiseConfiguration = {
      cucumber: {
        features: [`${featureDirectory}/**/*.feature`],
        steps: [`${stepsDirectory}/**/*.ts`],
      },
      version: 1,
    };
    await writeJson(join(this.projectDirectory, "premise.json"), configuration);
  },
);

Given(
  "a passing executable requirement exists in the configured directories",
  async function (this: PremiseWorld) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeExecutableRequirement({
      featureDirectory: "specifications",
      passing: true,
      projectDirectory: this.projectDirectory,
      stepsDirectory: "specifications/support",
    });
  },
);

Given(
  "executable requirement {string} exercises {string}",
  async function (this: PremiseWorld, requirementId: string, artifactPath: string) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: [
        `@${requirementId}`,
        "Feature: Take a payment",
        "  Scenario: Complete an accepted payment",
        "    When the customer pays 10 pounds",
        "    Then the payment is accepted",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: `features/${requirementId}.feature`,
    });
    await writeProjectFile({
      content: [
        "export function takePayment(amount: number) {",
        '  return amount > 0 ? "accepted" : "declined";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: artifactPath,
    });
    await writeProjectFile({
      content: [
        "export function recordPayment() {",
        '  return "recorded";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "src/payment-audit.ts",
    });
    await writeProjectFile({
      content: [
        'import assert from "node:assert/strict";',
        'import { When, Then } from "@stuplum/premise/cucumber";',
        'import { takePayment } from "../../src/payment.ts";',
        'import { recordPayment } from "../../src/payment-audit.ts";',
        "",
        "void recordPayment;",
        'let result = "";',
        "",
        'When("the customer pays 10 pounds", function () {',
        "  result = takePayment(10);",
        "});",
        "",
        'Then("the payment is accepted", function () {',
        '  assert.equal(result, "accepted");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "architecture premise {string} protects {string} from {string}",
  async function (
    this: PremiseWorld,
    premiseId: string,
    subjectPath: string,
    forbiddenDependencyPath: string,
  ) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeJson(join(this.projectDirectory, ".dependency-cruiser.json"), {
      forbidden: [
        {
          comment: "Domain code must not depend on HTTP infrastructure",
          from: { path: `^${escapeRegex(subjectPath)}$` },
          name: premiseId,
          severity: "error",
          to: { path: `^${escapeRegex(forbiddenDependencyPath)}$` },
        },
      ],
      options: {
        doNotFollow: { path: "node_modules" },
        includeOnly: "^src",
      },
    });
    await writeProjectFileIfMissing({
      content: 'export const paymentStatus = "accepted";\n',
      projectDirectory: this.projectDirectory,
      relativePath: subjectPath,
    });
    await writeProjectFile({
      content: 'export const sendPayment = () => "sent";\n',
      projectDirectory: this.projectDirectory,
      relativePath: forbiddenDependencyPath,
    });
  },
);

Given(
  "the architecture premise is violated",
  async function (this: PremiseWorld) {
    await writeProjectFile({
      content: [
        'import { sendPayment } from "./http-client.js";',
        "",
        "export const paymentStatus = sendPayment();",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "src/payment.ts",
    });
  },
);

When(
  "architecture premise {string} changes",
  async function (this: PremiseWorld, premiseId: string) {
    const path = join(this.projectDirectory, ".dependency-cruiser.json");
    const configuration = JSON.parse(await readFile(path, "utf8")) as {
      forbidden: Array<{ comment: string; name: string }>;
    };
    const rule = configuration.forbidden.find(({ name }) => name === premiseId);
    assert.ok(rule, `No architecture premise ${premiseId}`);
    rule.comment = `${rule.comment} without exceptions`;
    await writeJson(path, configuration);
  },
);

When(
  "the requirement step definitions are removed",
  async function (this: PremiseWorld) {
    await rm(
      join(
        this.projectDirectory,
        "features/step_definitions/payment.steps.ts",
      ),
    );
  },
);

Given(
  "executable requirement {string} exercises {string} through an extensionless import",
  async function (this: PremiseWorld, requirementId: string, artifactPath: string) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: '{"type":"module"}\n',
      projectDirectory: this.projectDirectory,
      relativePath: "package.json",
    });
    await writeProjectFile({
      content: '{"main":"index.cjs"}\n',
      projectDirectory: this.projectDirectory,
      relativePath: "apps/public/package.json",
    });
    await writeProjectFile({
      content: [
        `@${requirementId}`,
        "Feature: Take a payment",
        "  Scenario: Complete an accepted payment",
        "    When the customer pays through an extensionless import",
        "    Then the payment is accepted through an extensionless import",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: `features/${requirementId}.feature`,
    });
    await writeProjectFile({
      content: [
        "export const takePayment = () => \"accepted\";",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: artifactPath,
    });
    await writeProjectFile({
      content: [
        'import assert from "node:assert/strict";',
        'import { When, Then } from "@stuplum/premise/cucumber";',
        `import { takePayment } from "../../${artifactPath.replace(/\.ts$/, "")}";`,
        "",
        'let result = "";',
        "",
        'When("the customer pays through an extensionless import", function () {',
        "  result = takePayment();",
        "});",
        "",
        'Then("the payment is accepted through an extensionless import", function () {',
        '  assert.equal(result, "accepted");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "an executable requirement uses aliases from {string}",
  async function (this: PremiseWorld, configurationFile: string) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeJson(join(this.projectDirectory, configurationFile), {
      compilerOptions: {
        baseUrl: ".",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@payments/*": ["src/*"] },
        target: "ES2022",
      },
    });
    await writeProjectFile({
      content: [
        "@PAY-001",
        "Feature: Take a payment",
        "  Scenario: Accept a valid payment",
        "    When the customer pays",
        "    Then the payment is accepted",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/PAY-001.feature",
    });
    await writeProjectFile({
      content: [
        "export function takePayment() {",
        '  return "accepted";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "src/payment.ts",
    });
    await writeProjectFile({
      content: [
        'import assert from "node:assert/strict";',
        'import { Then, When } from "@stuplum/premise/cucumber";',
        'import { takePayment } from "@payments/payment.ts";',
        "",
        'let result = "";',
        "",
        'When("the customer pays", function () {',
        "  result = takePayment();",
        "});",
        "",
        'Then("the payment is accepted", function () {',
        '  assert.equal(result, "accepted");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "a parent Premise process selected TypeScript configuration {string}",
  async function (this: PremiseWorld, configurationFile: string) {
    const path = join(this.projectDirectory, configurationFile);
    await writeJson(path, {
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
      },
    });
    this.environment.TSX_TSCONFIG_PATH = path;
    this.environment.PREMISE_INJECTED_TSX_TSCONFIG_PATH = path;
  },
);

Given(
  "an executable requirement exists without step definitions",
  async function (this: PremiseWorld) {
    await writeProjectFile({
      content: [
        "@PAY-001",
        "Feature: Take a payment",
        "  Scenario: Accept a valid payment",
        "    When the customer pays",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/PAY-001.feature",
    });
  },
);

Given(
  "an executable requirement imports a missing implementation",
  async function (this: PremiseWorld) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: [
        "@PAY-001",
        "Feature: Take a payment",
        "  Scenario: Accept a valid payment",
        "    When the customer pays",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/PAY-001.feature",
    });
    await writeProjectFile({
      content: [
        'import { When } from "@stuplum/premise/cucumber";',
        'import { takePayment } from "../../src/missing.ts";',
        "",
        'When("the customer pays", function () {',
        "  takePayment();",
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "an executable requirement dynamically imports {string} with a query",
  async function (this: PremiseWorld, artifactPath: string) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: [
        "@PAY-001",
        "Feature: Take a payment",
        "  Scenario: Accept a valid payment",
        "    When the customer pays through a dynamic module",
        "    Then the dynamic payment is accepted",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/PAY-001.feature",
    });
    await writeProjectFile({
      content: [
        "export function takePayment() {",
        '  return "accepted";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: artifactPath,
    });
    await writeProjectFile({
      content: [
        'import assert from "node:assert/strict";',
        'import { Then, When } from "@stuplum/premise/cucumber";',
        "",
        'let result = "";',
        "",
        'When("the customer pays through a dynamic module", async function () {',
        '  const payment = await import("../../src/payment.ts?scenario=payment");',
        "  result = payment.takePayment();",
        "});",
        "",
        'Then("the dynamic payment is accepted", function () {',
        '  assert.equal(result, "accepted");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "an executable requirement imports {string} without exercising it",
  async function (this: PremiseWorld, artifactPath: string) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: [
        "@PAY-001",
        "Feature: Take a payment",
        "  Scenario: Load the payment adapter",
        "    When the payment adapter is loaded",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/PAY-001.feature",
    });
    await writeProjectFile({
      content: [
        "export function takePayment() {",
        '  return "accepted";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: artifactPath,
    });
    await writeProjectFile({
      content: [
        'import { When } from "@stuplum/premise/cucumber";',
        "",
        'When("the payment adapter is loaded", async function () {',
        '  await import("../../src/payment.ts");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "an executable requirement contains requirement-like comments and data",
  async function (this: PremiseWorld) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: [
        "@PAY-001",
        "Feature: Take a payment",
        "  # Historical reference: @PAY-009",
        "  Scenario: Accept a valid payment",
        "    When the customer pays with requirement data:",
        '      """',
        "      @PAY-010",
        '      """',
        "    Then the payment is accepted",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/PAY-001.feature",
    });
    await writeProjectFile({
      content: [
        "export function takePayment() {",
        '  return "accepted";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "src/payment.ts",
    });
    await writeProjectFile({
      content: [
        'import assert from "node:assert/strict";',
        'import { Then, When } from "@stuplum/premise/cucumber";',
        'import { takePayment } from "../../src/payment.ts";',
        "",
        'let result = "";',
        "",
        'When("the customer pays with requirement data:", function (_requirementData: string) {',
        "  result = takePayment();",
        "});",
        "",
        'Then("the payment is accepted", function () {',
        '  assert.equal(result, "accepted");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "an executable requirement with a parallel Cucumber profile",
  async function (this: PremiseWorld) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: "module.exports = { default: { parallel: 4 } };\n",
      projectDirectory: this.projectDirectory,
      relativePath: "cucumber.cjs",
    });
    await writeProjectFile({
      content: [
        "@PAY-001",
        "Feature: Take a payment",
        "  Scenario Outline: Accept a valid payment",
        "    When the customer pays <amount> pounds",
        "    Then the payment is accepted",
        "",
        "    Examples:",
        "      | amount |",
        "      | 10     |",
        "      | 20     |",
        "      | 30     |",
        "      | 40     |",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/PAY-001.feature",
    });
    await writeProjectFile({
      content: [
        "export function takePayment(amount: number) {",
        '  return amount > 0 ? "accepted" : "declined";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "src/payment.ts",
    });
    await writeProjectFile({
      content: [
        'import assert from "node:assert/strict";',
        'import { appendFileSync } from "node:fs";',
        'import { Then, When } from "@stuplum/premise/cucumber";',
        'import { takePayment } from "../../src/payment.ts";',
        "",
        'appendFileSync("workers.log", `${process.env.NODE_V8_COVERAGE}\\t${process.pid}\\n`);',
        "void takePayment(0);",
        'let result = "";',
        "",
        'When("the customer pays {int} pounds", function (amount: number) {',
        "  result = takePayment(amount);",
        "});",
        "",
        'Then("the payment is accepted", function () {',
        '  assert.equal(result, "accepted");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Then(
  "Premise uses one worker for both coverage runs",
  async function (this: PremiseWorld) {
    const workers = (
      await readFile(join(this.projectDirectory, "workers.log"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => line.split("\t"));
    const baselineWorkers = new Set(
      workers
        .filter(([directory]) => directory.includes("premise-baseline-"))
        .map(([, processId]) => processId),
    );
    const realWorkers = new Set(
      workers
        .filter(([directory]) => directory.includes("premise-coverage-"))
        .map(([, processId]) => processId),
    );
    assert.equal(
      baselineWorkers.size,
      1,
      `Baseline workers: ${baselineWorkers.size}`,
    );
    assert.equal(realWorkers.size, 1, `Real workers: ${realWorkers.size}`);
  },
);

Given(
  "requirement ID {string} appears in two executable feature files",
  async function (this: PremiseWorld, requirementId: string) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    for (const featureName of ["first-payment", "second-payment"]) {
      await writeProjectFile({
        content: [
          `@${requirementId}`,
          `Feature: ${featureName}`,
          "  Scenario: Accept a valid payment",
          "    When the customer pays 10 pounds",
          "    Then the payment is accepted",
          "",
        ].join("\n"),
        projectDirectory: this.projectDirectory,
        relativePath: `features/${featureName}.feature`,
      });
    }
    await writeProjectFile({
      content: [
        "export function takePayment(amount: number) {",
        '  return amount > 0 ? "accepted" : "declined";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "src/payment.ts",
    });
    await writeProjectFile({
      content: [
        'import assert from "node:assert/strict";',
        'import { Then, When } from "@stuplum/premise/cucumber";',
        'import { takePayment } from "../../src/payment.ts";',
        "",
        'let result = "";',
        "",
        'When("the customer pays 10 pounds", function () {',
        "  result = takePayment(10);",
        "});",
        "",
        'Then("the payment is accepted", function () {',
        '  assert.equal(result, "accepted");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Given(
  "one executable feature contains requirement IDs {string} and {string}",
  async function (
    this: PremiseWorld,
    firstRequirementId: string,
    secondRequirementId: string,
  ) {
    await linkPremisePackage({ projectDirectory: this.projectDirectory });
    await writeProjectFile({
      content: [
        `@${firstRequirementId} @${secondRequirementId}`,
        "Feature: Take payments",
        "  Scenario: Accept a valid payment",
        "    When the customer pays 10 pounds",
        "    Then the payment is accepted",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/payments.feature",
    });
    await writeProjectFile({
      content: [
        "export function takePayment(amount: number) {",
        '  return amount > 0 ? "accepted" : "declined";',
        "}",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "src/payment.ts",
    });
    await writeProjectFile({
      content: [
        'import assert from "node:assert/strict";',
        'import { Then, When } from "@stuplum/premise/cucumber";',
        'import { takePayment } from "../../src/payment.ts";',
        "",
        'let result = "";',
        "",
        'When("the customer pays 10 pounds", function () {',
        "  result = takePayment(10);",
        "});",
        "",
        'Then("the payment is accepted", function () {',
        '  assert.equal(result, "accepted");',
        "});",
        "",
      ].join("\n"),
      projectDirectory: this.projectDirectory,
      relativePath: "features/step_definitions/payment.steps.ts",
    });
  },
);

Then(
  "the command returns the current Gherkin for requirement {string}",
  async function (this: PremiseWorld, requirementId: string) {
    const source = `features/${requirementId}.feature`;
    const feature = await readFile(join(this.projectDirectory, source), "utf8");
    assert.ok(commandOutput(this).includes(feature.trim()));
  },
);

Then(
  "the command returns the current source for decision {string}",
  async function (this: PremiseWorld, decisionId: string) {
    const source = `decisions/${decisionId}.decision`;
    const decision = await readFile(join(this.projectDirectory, source), "utf8");
    assert.ok(commandOutput(this).includes(decision.trim()));
  },
);

Then("no generated decision state is created", async function (this: PremiseWorld) {
  await assert.rejects(access(join(this.projectDirectory, ".premise/decisions")));
});

Then("no generated context files are created", async function (this: PremiseWorld) {
  await assert.rejects(access(join(this.projectDirectory, ".premise/compiled")));
});

Then(
  "a review receipt exists for decision {string}",
  async function (this: PremiseWorld, decisionId: string) {
    await access(
      join(this.projectDirectory, `.premise/reviews/${decisionId}.json`),
    );
  },
);

Then(
  "the review receipt for decision {string} records premise {string}",
  async function (
    this: PremiseWorld,
    decisionId: string,
    premiseId: string,
  ) {
    const receipt = JSON.parse(
      await readFile(
        join(this.projectDirectory, `.premise/reviews/${decisionId}.json`),
        "utf8",
      ),
    ) as { drivers: Array<{ id: string; kind: string }> };
    assert.ok(
      receipt.drivers.some(
        ({ id, kind }) => id === premiseId && kind === "premise",
      ),
    );
  },
);

Then(
  "the command reports that decision {string} references unknown premise {string}",
  function (
    this: PremiseWorld,
    decisionId: string,
    premiseId: string,
  ) {
    assert.match(
      commandOutput(this),
      new RegExp(
        `Decision ${escapeRegex(decisionId)} .* references unknown premise ${escapeRegex(premiseId)}`,
      ),
    );
  },
);

Then(
  "the command explains that supporting premise {string} failed",
  function (this: PremiseWorld, premiseId: string) {
    assert.match(
      commandOutput(this),
      new RegExp(`Supporting premise ${escapeRegex(premiseId)} failed\\.`),
    );
  },
);

Then(
  "the command explains that supporting premise {string} is unknown",
  function (this: PremiseWorld, premiseId: string) {
    assert.match(
      commandOutput(this),
      new RegExp(`Supporting premise ${escapeRegex(premiseId)} is unknown\\.`),
    );
  },
);

Then(
  "the command explains that supporting decision {string} requires reconsideration",
  function (this: PremiseWorld, decisionId: string) {
    assert.match(
      commandOutput(this),
      new RegExp(
        `Supporting decision ${escapeRegex(decisionId)} requires reconsideration\\.`,
      ),
    );
  },
);

Then(
  "the command does not report decision {string} as failed",
  function (this: PremiseWorld, decisionId: string) {
    assert.doesNotMatch(
      commandOutput(this),
      new RegExp(`${escapeRegex(decisionId)} failed`),
    );
  },
);

Then(
  "the command returns source {string}",
  async function (this: PremiseWorld, source: string) {
    const content = await readFile(join(this.projectDirectory, source), "utf8");
    assert.ok(commandOutput(this).includes(content.trim()));
  },
);

Then(
  "the command reports unknown superseded decision {string}",
  function (this: PremiseWorld, decisionId: string) {
    assert.match(
      commandOutput(this),
      new RegExp(`supersedes unknown decision ${escapeRegex(decisionId)}`),
    );
  },
);

Then("no legacy Premise files are created", async function (this: PremiseWorld) {
  await assert.rejects(access(join(this.projectDirectory, "premise.json")));
  await assert.rejects(access(join(this.projectDirectory, "premise.lock")));
});

Then("the command reports only the supported commands", function (this: PremiseWorld) {
  assert.match(
    commandOutput(this),
    /Usage: premise <test\|context\|check\|review>/,
  );
});

Then("the command reports invalid Premise configuration", function (this: PremiseWorld) {
  assert.match(commandOutput(this), /Invalid Premise configuration/);
});

Then(
  "the command reports no context for {string}",
  function (this: PremiseWorld, artifactPath: string) {
    assert.match(
      commandOutput(this),
      new RegExp(`No context for ${artifactPath}`),
    );
  },
);

Then(
  "the command reports that the path must be inside the project",
  function (this: PremiseWorld) {
    assert.match(commandOutput(this), /must be inside the project/);
  },
);

Then(
  "the command reports that no executable requirements matched",
  function (this: PremiseWorld) {
    assert.match(commandOutput(this), /No executable requirements matched/);
  },
);

Then(
  "the command reports that no step definitions matched",
  function (this: PremiseWorld) {
    assert.match(commandOutput(this), /No step definitions matched/);
  },
);

Then("the command reports the missing implementation import", function (this: PremiseWorld) {
  assert.match(commandOutput(this), /src\/missing\.ts/);
});

Then(
  "the command warns that dynamic module coverage may be unreliable",
  function (this: PremiseWorld) {
    assert.match(
      commandOutput(this),
      /Dynamic module coverage may be unreliable/,
    );
  },
);

Then(
  "the command warns that {string} has no requirement ID",
  function (this: PremiseWorld, source: string) {
    assert.match(
      commandOutput(this),
      new RegExp(
        `No requirement ID found in ${escapeRegex(source)}; artifact relationships cannot be discovered\\.`,
      ),
    );
  },
);

Then(
  "the command reports duplicate requirement ID {string}",
  function (this: PremiseWorld, requirementId: string) {
    assert.match(
      commandOutput(this),
      new RegExp(`Duplicate requirement ID ${requirementId}`),
    );
  },
);

Then(
  "the command returns architecture premise {string}",
  function (this: PremiseWorld, premiseId: string) {
    const output = commandOutput(this);
    assert.match(output, new RegExp(`"name": "${escapeRegex(premiseId)}"`));
    assert.match(output, /Domain code must not depend on HTTP infrastructure/);
  },
);

Then(
  "context reports premise {string} as {string} in {string} via {string} with state {string}",
  function (
    this: PremiseWorld,
    premiseId: string,
    premiseType: string,
    dialect: string,
    provider: string,
    state: string,
  ) {
    const output = commandOutput(this);
    assert.match(
      output,
      new RegExp(
        `${escapeRegex(premiseId)}[\\s\\S]*${escapeRegex(premiseType)} / ${escapeRegex(dialect)} via ${escapeRegex(provider)}[\\s\\S]*${escapeRegex(state)}`,
      ),
    );
  },
);

Then(
  "context reports decision {string} with state {string}",
  function (this: PremiseWorld, decisionId: string, state: string) {
    assert.match(
      commandOutput(this),
      new RegExp(
        `${escapeRegex(decisionId)}[\\s\\S]*decision[\\s\\S]*${escapeRegex(state)}`,
      ),
    );
  },
);

Then(
  "context retains source {string} with selector {string}",
  function (this: PremiseWorld, source: string, selector: string) {
    assert.match(
      commandOutput(this),
      new RegExp(
        `source: ${escapeRegex(source)}#${escapeRegex(selector)}`,
      ),
    );
  },
);

Then("context does not dump the Gherkin source", function (this: PremiseWorld) {
  assert.doesNotMatch(commandOutput(this), /Scenario: Accept a valid payment/);
});

Then("the command reports the forbidden dependency", function (this: PremiseWorld) {
  const output = commandOutput(this);
  assert.match(output, /src\/payment\.ts/);
  assert.match(output, /src\/http-client\.ts/);
});

Then("the executable requirement ran", async function (this: PremiseWorld) {
  assert.equal(
    await readFile(join(this.projectDirectory, "requirement-ran.txt"), "utf8"),
    "yes\n",
  );
});

Then(
  "the command reports that the executable requirement failed",
  function (this: PremiseWorld) {
    assert.match(commandOutput(this), /the requirement is satisfied/);
  },
);

Then(
  "the command reports that premise {string} failed",
  function (this: PremiseWorld, premiseId: string) {
    assert.match(
      commandOutput(this),
      new RegExp(`${escapeRegex(premiseId)} failed`),
    );
  },
);

Then(
  "the command reports that premise {string} is unknown",
  function (this: PremiseWorld, premiseId: string) {
    assert.match(
      commandOutput(this),
      new RegExp(`${escapeRegex(premiseId)} unknown`),
    );
  },
);

After(async function (this: PremiseWorld) {
  await Promise.all(
    [this.projectDirectory, ...this.providerProjects]
      .filter(Boolean)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

function splitCommand(command: string) {
  return command.split(" ");
}

function commandResult(world: PremiseWorld) {
  assert.ok(world.result, "No command has been run");
  return world.result;
}

function commandOutput(world: PremiseWorld) {
  const result = commandResult(world);
  return `${result.stdout}${result.stderr}`.trim();
}

async function writeProjectFile({
  content,
  projectDirectory,
  relativePath,
}: {
  content: string;
  projectDirectory: string;
  relativePath: string;
}) {
  const path = join(projectDirectory, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function writeProjectFileIfMissing({
  content,
  projectDirectory,
  relativePath,
}: {
  content: string;
  projectDirectory: string;
  relativePath: string;
}) {
  try {
    await access(join(projectDirectory, relativePath));
  } catch {
    await writeProjectFile({ content, projectDirectory, relativePath });
  }
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createArchitectureProviderProject(premiseId: string) {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-provider-"));
  await writeJson(join(projectDirectory, ".dependency-cruiser.json"), {
    forbidden: [
      {
        comment: "Domain code must not depend on infrastructure",
        from: { path: "^src/domain" },
        name: premiseId,
        severity: "error",
        to: { path: "^src/infrastructure" },
      },
    ],
    options: {
      doNotFollow: { path: "node_modules" },
      includeOnly: "^src",
    },
  });
  await writeProjectFile({
    content: 'export const domainValue = "domain";\n',
    projectDirectory,
    relativePath: "src/domain.ts",
  });
  await writeProjectFile({
    content: 'export const infrastructureValue = "infrastructure";\n',
    projectDirectory,
    relativePath: "src/infrastructure.ts",
  });
  return projectDirectory;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runGit({
  arguments: arguments_,
  projectDirectory,
}: {
  arguments: string[];
  projectDirectory: string;
}) {
  const result = spawnSync("git", arguments_, {
    cwd: projectDirectory,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    result.error?.message ?? `${result.stdout}${result.stderr}`,
  );
}

function runPremise({
  arguments: arguments_,
  environment = {},
  projectDirectory,
}: {
  arguments: string[];
  environment?: Record<string, string>;
  projectDirectory: string;
}) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

async function writeDecision({
  decisionId,
  driver,
  projectDirectory,
  supersededDecisionId,
}: {
  decisionId: string;
  driver: string;
  projectDirectory: string;
  supersededDecisionId?: string;
}) {
  await writeProjectFile({
    content: [
      `Decision ${decisionId} "Reliable confirmation delivery"`,
      `Driven by ${driver}`,
      "Choose durable storage of pending confirmations",
      "Because accepted orders must survive delivery outages",
      "Accept possible duplicate delivery",
      supersededDecisionId ? `Supersedes ${supersededDecisionId}` : undefined,
      "",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    projectDirectory,
    relativePath: `decisions/${decisionId}.decision`,
  });
}

async function linkPremisePackage({
  projectDirectory,
}: {
  projectDirectory: string;
}) {
  const nodeModulesDirectory = join(projectDirectory, "node_modules");
  const scopeDirectory = join(nodeModulesDirectory, "@stuplum");
  const packagePath = join(scopeDirectory, "premise");
  await mkdir(scopeDirectory, { recursive: true });
  try {
    await access(packagePath);
  } catch {
    await symlink(resolve("."), packagePath, "dir");
  }
}

async function writeExecutableRequirement({
  featureDirectory,
  passing,
  projectDirectory,
  stepsDirectory,
}: {
  featureDirectory: string;
  passing: boolean;
  projectDirectory: string;
  stepsDirectory: string;
}) {
  await writeProjectFile({
    content: [
      "Feature: Execute a requirement",
      "  Scenario: Run through bundled Cucumber",
      "    Given the bundled runner is available",
      "    Then the requirement is satisfied",
      "",
    ].join("\n"),
    projectDirectory,
    relativePath: `${featureDirectory}/example.feature`,
  });
  await writeProjectFile({
    content: [
      'import assert from "node:assert/strict";',
      'import { writeFile } from "node:fs/promises";',
      'import { Given, Then } from "@stuplum/premise/cucumber";',
      "",
      "let runnerAvailable: boolean = false;",
      "",
      'Given("the bundled runner is available", function () {',
      "  runnerAvailable = true;",
      "});",
      "",
      'Then("the requirement is satisfied", async function () {',
      `  assert.equal(runnerAvailable, ${passing});`,
      '  await writeFile("requirement-ran.txt", "yes\\n", "utf8");',
      "});",
      "",
    ].join("\n"),
    projectDirectory,
    relativePath: `${stepsDirectory}/example.steps.ts`,
  });
}
