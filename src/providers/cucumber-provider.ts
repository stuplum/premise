import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { requirementIds } from "../gherkin-requirements.js";
import type {
  EvaluationContext,
  EvaluationResult,
  Evidence,
  Premise,
  PremiseProvider,
} from "../provider.js";
import { readConfiguration } from "../repository.js";
import { collectExecutedArtifacts } from "./cucumber-coverage.js";

type CucumberProject = {
  projectDirectory: string;
  silent: boolean;
  stepFiles: string[];
  stepPaths: string[];
  typeScriptConfiguration?: string;
  warnedDynamicModules: Set<string>;
};

const defaultFeaturePaths = ["features/**/*.feature"];
const defaultStepPaths = ["features/step_definitions/**/*.ts"];
const injectedTypeScriptConfigurationVariable =
  "PREMISE_INJECTED_TSX_TSCONFIG_PATH";

export function createCucumberProvider({
  allowEmpty = false,
  silent = false,
}: {
  allowEmpty?: boolean;
  silent?: boolean;
} = {}): PremiseProvider {
  let project: CucumberProject | undefined;

  return {
    dialects: ["gherkin"],
    id: "cucumber",
    async discover(context) {
      const discovery = await discoverCucumberPremises({
        allowEmpty,
        context,
        silent,
      });
      project = discovery.project;
      return discovery.premises;
    },
    async evaluate(premise, context) {
      if (!project || project.projectDirectory !== context.projectDirectory) {
        throw new Error("Cucumber premises must be discovered before evaluation");
      }
      return evaluateCucumberPremise({ context, premise, project });
    },
  };
}

async function discoverCucumberPremises({
  allowEmpty,
  context,
  silent,
}: {
  allowEmpty: boolean;
  context: EvaluationContext;
  silent: boolean;
}): Promise<{
  premises: Premise[];
  project: CucumberProject;
}> {
  const { projectDirectory } = context;
  const configuration = await readConfiguration({ projectDirectory });
  const featurePaths = configuration.cucumber?.features ?? defaultFeaturePaths;
  const stepPaths = configuration.cucumber?.steps ?? defaultStepPaths;
  const [featureFiles, stepFiles] = await Promise.all([
    glob(featurePaths, { cwd: projectDirectory, nodir: true }),
    glob(stepPaths, { cwd: projectDirectory, nodir: true }),
  ]);
  if (!allowEmpty) {
    requireMatches({
      kind: "executable requirements",
      matches: featureFiles,
      patterns: featurePaths,
    });
  }

  const warnedDynamicModules = new Set<string>();
  for (const path of await findDynamicImportStepFiles({
    projectDirectory,
    stepFiles,
  })) {
    warnAboutDynamicModule({ path, warnedDynamicModules });
  }

  const premises = await Promise.all(
    featureFiles.sort().map(async (source) => {
      const content = await readFile(join(projectDirectory, source), "utf8");
      const ids = requirementIds({ content, uri: source });
      if (ids.length > 1) {
        throw new Error(
          `${source} must contain at most one requirement ID. Found: ${ids.join(", ")}`,
        );
      }
      return {
        assertion: {
          dialect: "gherkin",
          ref: {
            ...(ids[0] ? { selector: `@${ids[0]}` } : {}),
            uri: source,
          },
        },
        description: basename(source, extname(source)),
        id: ids[0] ?? `cucumber:${source}`,
        type: "behaviour",
      };
    }),
  );
  requireUniqueRequirementIds(premises);

  return {
    premises,
    project: {
      projectDirectory,
      silent,
      stepFiles,
      stepPaths,
      typeScriptConfiguration: await findTypeScriptConfiguration({
        projectDirectory,
      }),
      warnedDynamicModules,
    },
  };
}

async function evaluateCucumberPremise({
  context,
  premise,
  project,
}: {
  context: EvaluationContext;
  premise: Premise;
  project: CucumberProject;
}): Promise<EvaluationResult> {
  if (project.stepFiles.length === 0) {
    return {
      reason: `No step definitions matched: ${project.stepPaths.join(", ")}`,
      status: "unknown",
    };
  }

  const baselineCoverageDirectory = await mkdtemp(
    join(tmpdir(), "premise-baseline-"),
  );
  const coverageDirectory = await mkdtemp(join(tmpdir(), "premise-coverage-"));
  const cucumberArguments = [
    "--parallel",
    "0",
    ...project.stepPaths.flatMap((path) => ["--import", path]),
  ];
  const source = premise.assertion.ref.uri;

  try {
    const baselineExitCode = await runCucumberProcess({
      arguments: ["--dry-run", ...cucumberArguments, source],
      coverageDirectory: baselineCoverageDirectory,
      projectDirectory: context.projectDirectory,
      silent: true,
      typeScriptConfiguration: project.typeScriptConfiguration,
    });
    if (baselineExitCode !== 0) {
      await runCucumberProcess({
        arguments: ["--dry-run", ...cucumberArguments, source],
        coverageDirectory: baselineCoverageDirectory,
        projectDirectory: context.projectDirectory,
        silent: project.silent,
        typeScriptConfiguration: project.typeScriptConfiguration,
      });
      return failedEvaluation({
        message: `Cucumber could not load ${source}`,
        source,
      });
    }

    const exitCode = await runCucumberProcess({
      arguments: [...cucumberArguments, source],
      coverageDirectory,
      projectDirectory: context.projectDirectory,
      silent: project.silent,
      typeScriptConfiguration: project.typeScriptConfiguration,
    });
    if (!premise.assertion.ref.selector) {
      if (exitCode !== 0) {
        return failedEvaluation({
          message: `Cucumber did not establish ${premise.id}`,
          source,
        });
      }
      process.stderr.write(
        `No requirement ID found in ${source}; artifact relationships cannot be discovered.\n`,
      );
      return {
        evidence: [{ role: "assertion", uri: source }],
        status: "established",
      };
    }

    const { artifacts, unreliableModulePaths } = await collectExecutedArtifacts({
      baselineCoverageDirectory,
      coverageDirectory,
      projectDirectory: context.projectDirectory,
      stepFiles: project.stepFiles,
    });
    for (const path of unreliableModulePaths) {
      warnAboutDynamicModule({
        path,
        warnedDynamicModules: project.warnedDynamicModules,
      });
    }

    const evidence: Evidence[] = [
      { role: "assertion", uri: source },
      ...artifacts.map((uri) => ({ role: "executed", uri })),
    ];
    if (exitCode !== 0) {
      return failedEvaluation({
        evidence,
        message: `Cucumber did not establish ${premise.id}`,
        source,
      });
    }

    return {
      evidence,
      status: "established",
    };
  } finally {
    await Promise.all([
      rm(baselineCoverageDirectory, { force: true, recursive: true }),
      rm(coverageDirectory, { force: true, recursive: true }),
    ]);
  }
}

function failedEvaluation({
  source,
  evidence = [{ role: "assertion", uri: source }],
  message,
}: {
  evidence?: Evidence[];
  message: string;
  source: string;
}): EvaluationResult {
  return {
    diagnostics: [{ message, uri: source }],
    evidence,
    status: "failed",
  };
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
        env: cucumberEnvironment({
          coverageDirectory,
          typeScriptConfiguration,
        }),
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

function cucumberEnvironment({
  coverageDirectory,
  typeScriptConfiguration,
}: {
  coverageDirectory: string;
  typeScriptConfiguration?: string;
}) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_V8_COVERAGE: coverageDirectory,
  };
  delete environment.TSX_TSCONFIG_PATH;
  delete environment[injectedTypeScriptConfigurationVariable];
  if (typeScriptConfiguration) {
    environment.TSX_TSCONFIG_PATH = typeScriptConfiguration;
    environment[injectedTypeScriptConfigurationVariable] =
      typeScriptConfiguration;
  }
  return environment;
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

function requireUniqueRequirementIds(premises: Premise[]) {
  const sources = new Map<string, string>();
  for (const premise of premises) {
    if (!premise.assertion.ref.selector) {
      continue;
    }
    const existingSource = sources.get(premise.id);
    if (existingSource) {
      throw new Error(
        `Duplicate requirement ID ${premise.id}: ${existingSource}, ${premise.assertion.ref.uri}`,
      );
    }
    sources.set(premise.id, premise.assertion.ref.uri);
  }
}

async function findTypeScriptConfiguration({
  projectDirectory,
}: {
  projectDirectory: string;
}) {
  if (
    process.env.TSX_TSCONFIG_PATH &&
    process.env.TSX_TSCONFIG_PATH !==
      process.env[injectedTypeScriptConfigurationVariable]
  ) {
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
