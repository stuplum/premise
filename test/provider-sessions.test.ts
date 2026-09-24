import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createCucumberProvider } from "../src/providers/cucumber-provider.js";
import { createDependencyCruiserProvider } from "../src/providers/dependency-cruiser-provider.js";

test("cucumber sessions isolate interleaved project evaluations", async (t) => {
  const projectA = await createCucumberProject({
    premiseId: "PAY-101",
    scenario: "the first project succeeds",
  });
  const projectB = await createCucumberProject({
    premiseId: "PAY-202",
    scenario: "the second project succeeds",
  });
  t.after(async () => {
    await Promise.all([
      rm(projectA, { force: true, recursive: true }),
      rm(projectB, { force: true, recursive: true }),
    ]);
  });

  const provider = createCucumberProvider({ silent: true });
  const sessionA = await provider.prepare({ projectDirectory: projectA });
  const sessionB = await provider.prepare({ projectDirectory: projectB });
  const [premiseA] = await sessionA.discover();
  const [premiseB] = await sessionB.discover();

  assert.equal((await sessionA.evaluate(premiseA)).status, "established");
  assert.equal((await sessionB.evaluate(premiseB)).status, "established");
});

test("dependency-cruiser sessions isolate interleaved project evaluations", async (t) => {
  const projectA = await createArchitectureProject({ premiseId: "ARCH-101" });
  const projectB = await createArchitectureProject({ premiseId: "ARCH-202" });
  t.after(async () => {
    await Promise.all([
      rm(projectA, { force: true, recursive: true }),
      rm(projectB, { force: true, recursive: true }),
    ]);
  });

  const provider = createDependencyCruiserProvider();
  const sessionA = await provider.prepare({ projectDirectory: projectA });
  const sessionB = await provider.prepare({ projectDirectory: projectB });
  const [premiseA] = await sessionA.discover();
  const [premiseB] = await sessionB.discover();

  assert.equal((await sessionA.evaluate(premiseA)).status, "established");
  assert.equal((await sessionB.evaluate(premiseB)).status, "established");
});

async function createCucumberProject({
  premiseId,
  scenario,
}: {
  premiseId: string;
  scenario: string;
}) {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-session-"));
  const featurePath = `specifications/${premiseId}.feature`;
  const stepPath = `support/${premiseId}.steps.ts`;
  const cucumberApi = pathToFileURL(resolve("src/cucumber.ts")).href;

  await writeJson(join(projectDirectory, "premise.json"), {
    cucumber: {
      features: ["specifications/**/*.feature"],
      steps: ["support/**/*.ts"],
    },
    version: 1,
  });
  await writeProjectFile({
    content: [
      `@${premiseId}`,
      `Feature: ${scenario}`,
      `  Scenario: ${scenario}`,
      `    Then ${scenario}`,
      "",
    ].join("\n"),
    projectDirectory,
    relativePath: featurePath,
  });
  await writeProjectFile({
    content: [
      `import { Then } from ${JSON.stringify(cucumberApi)};`,
      "",
      `Then(${JSON.stringify(scenario)}, function () {});`,
      "",
    ].join("\n"),
    projectDirectory,
    relativePath: stepPath,
  });

  return projectDirectory;
}

async function createArchitectureProject({ premiseId }: { premiseId: string }) {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-session-"));
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

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
