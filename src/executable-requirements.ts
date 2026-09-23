import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import {
  collectExecutedArtifacts,
  compileFeatureExecutions,
} from "./compiled-context.js";
import { readConfiguration } from "./repository.js";

const defaultFeaturePaths = ["features/**/*.feature"];
const defaultStepPaths = ["features/step_definitions/**/*.ts"];

export async function runExecutableRequirements({
  projectDirectory,
}: {
  projectDirectory: string;
}) {
  const configuration = await readConfiguration({ projectDirectory });
  const featurePaths = configuration.cucumber?.features ?? defaultFeaturePaths;
  const stepPaths = configuration.cucumber?.steps ?? defaultStepPaths;
  const [featureFiles, stepFiles] = await Promise.all([
    glob(featurePaths, { cwd: projectDirectory, nodir: true }),
    glob(stepPaths, { cwd: projectDirectory, nodir: true }),
  ]);
  requireMatches({
    kind: "executable requirements",
    matches: featureFiles,
    patterns: featurePaths,
  });
  requireMatches({
    kind: "step definitions",
    matches: stepFiles,
    patterns: stepPaths,
  });
  const typeScriptConfiguration = await findTypeScriptConfiguration({
    projectDirectory,
  });
  const cucumberArguments = [
    "--parallel",
    "0",
    ...stepPaths.flatMap((path) => ["--import", path]),
  ];
  const executions = [];
  const warnedDynamicModules = new Set<string>();
  for (const path of await findDynamicImportStepFiles({
    projectDirectory,
    stepFiles,
  })) {
    warnAboutDynamicModule({ path, warnedDynamicModules });
  }

  for (const source of featureFiles.sort()) {
    const baselineCoverageDirectory = await mkdtemp(join(tmpdir(), "premise-baseline-"));
    const coverageDirectory = await mkdtemp(join(tmpdir(), "premise-coverage-"));

    try {
      const baselineExitCode = await runCucumberProcess({
        arguments: ["--dry-run", ...cucumberArguments, source],
        coverageDirectory: baselineCoverageDirectory,
        projectDirectory,
        silent: true,
        typeScriptConfiguration,
      });
      if (baselineExitCode !== 0) {
        await runCucumberProcess({
          arguments: ["--dry-run", ...cucumberArguments, source],
          coverageDirectory: baselineCoverageDirectory,
          projectDirectory,
          silent: false,
          typeScriptConfiguration,
        });
        return false;
      }

      const exitCode = await runCucumberProcess({
        arguments: [...cucumberArguments, source],
        coverageDirectory,
        projectDirectory,
        silent: false,
        typeScriptConfiguration,
      });

      if (exitCode !== 0) {
        return false;
      }

      const { artifacts, unreliableModulePaths } =
        await collectExecutedArtifacts({
          baselineCoverageDirectory,
          coverageDirectory,
          projectDirectory,
          stepFiles,
        });
      for (const path of unreliableModulePaths) {
        warnAboutDynamicModule({ path, warnedDynamicModules });
      }
      executions.push({
        artifacts,
        source,
      });
    } finally {
      await Promise.all([
        rm(baselineCoverageDirectory, { force: true, recursive: true }),
        rm(coverageDirectory, { force: true, recursive: true }),
      ]);
    }
  }

  await compileFeatureExecutions({ executions, projectDirectory });
  return true;
}

async function runCucumberProcess({
  arguments: arguments_,
  coverageDirectory,
  projectDirectory,
  silent,
  typeScriptConfiguration,
}: {
  arguments: string[];
  coverageDirectory: string;
  projectDirectory: string;
  silent: boolean;
  typeScriptConfiguration?: string;
}) {
  const cucumberPackageUrl = import.meta.resolve(
    "@cucumber/cucumber/package.json",
  );
  const cucumberCliPath = fileURLToPath(
    new URL("./bin/cucumber.js", cucumberPackageUrl),
  );
  const tsxLoaderUrl = import.meta.resolve("tsx");

  return new Promise<number>((resolve, reject) => {
    const cucumber = spawn(
      process.execPath,
      ["--import", tsxLoaderUrl, cucumberCliPath, ...arguments_],
      {
        cwd: projectDirectory,
        env: {
          ...process.env,
          ...(typeScriptConfiguration
            ? { TSX_TSCONFIG_PATH: typeScriptConfiguration }
            : {}),
          NODE_V8_COVERAGE: coverageDirectory,
        },
        stdio: silent ? "ignore" : "inherit",
      },
    );

    cucumber.on("error", reject);
    cucumber.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Cucumber stopped after receiving ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });
}

function requireMatches({
  kind,
  matches,
  patterns,
}: {
  kind: string;
  matches: string[];
  patterns: string[];
}) {
  if (matches.length === 0) {
    throw new Error(`No ${kind} matched: ${patterns.join(", ")}`);
  }
}

async function findTypeScriptConfiguration({
  projectDirectory,
}: {
  projectDirectory: string;
}) {
  if (process.env.TSX_TSCONFIG_PATH) {
    return process.env.TSX_TSCONFIG_PATH;
  }

  for (const fileName of ["tsconfig.json", "tsconfig.base.json"]) {
    const path = join(projectDirectory, fileName);
    try {
      await access(path);
      return path;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function findDynamicImportStepFiles({
  projectDirectory,
  stepFiles,
}: {
  projectDirectory: string;
  stepFiles: string[];
}) {
  const dynamicImportFiles = await Promise.all(
    stepFiles.map(async (path) => ({
      dynamic: /\bimport\s*\(/.test(
        await readFile(join(projectDirectory, path), "utf8"),
      ),
      path,
    })),
  );
  return dynamicImportFiles
    .filter(({ dynamic }) => dynamic)
    .map(({ path }) => path)
    .sort();
}

function warnAboutDynamicModule({
  path,
  warnedDynamicModules,
}: {
  path: string;
  warnedDynamicModules: Set<string>;
}) {
  if (warnedDynamicModules.has(path)) {
    return;
  }

  process.stderr.write(`Dynamic module coverage may be unreliable for ${path}.\n`);
  warnedDynamicModules.add(path);
}
