import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  cruise,
  type ICruiseOptions,
  type ICruiseResult,
  type IForbiddenRuleType,
} from "dependency-cruiser";
import extractDependencyCruiserOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
import type {
  EvaluationContext,
  EvaluationResult,
  Evidence,
  Premise,
  PremiseProvider,
} from "../provider.js";

type ArchitectureRule = {
  premise: Premise;
  rule: IForbiddenRuleType;
};

type DependencyCruiserProject = {
  analyze: () => Promise<ICruiseResult>;
  configUri: string;
  projectDirectory: string;
  rules: Map<string, ArchitectureRule>;
};

const defaultConfigFiles = [
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.json",
];
const premiseIdPattern = /^[A-Z][A-Z0-9]*-\d+$/;

export function createDependencyCruiserProvider({
  configFiles = defaultConfigFiles,
  sourcePaths = ["src"],
}: {
  configFiles?: string[];
  sourcePaths?: string[];
} = {}): PremiseProvider {
  return {
    dialects: ["dependency-cruiser"],
    id: "dependency-cruiser",
    async prepare(context) {
      const project = await discoverArchitecturePremises({
        configFiles,
        context,
        sourcePaths,
      });
      return {
        async discover() {
          return [...project.rules.values()].map(({ premise }) => premise);
        },
        async evaluate(premise) {
          return evaluateArchitecturePremise({ premise, project });
        },
      };
    },
  };
}

async function discoverArchitecturePremises({
  configFiles,
  context,
  sourcePaths,
}: {
  configFiles: string[];
  context: EvaluationContext;
  sourcePaths: string[];
}): Promise<DependencyCruiserProject> {
  const configPath = await findConfigFile({
    configFiles,
    projectDirectory: context.projectDirectory,
  });
  if (!configPath) {
    return {
      analyze: async () => emptyCruiseResult(),
      configUri: "",
      projectDirectory: context.projectDirectory,
      rules: new Map(),
    };
  }

  const options = await extractDependencyCruiserOptions(configPath);
  const configUri = normalizeProjectPath({
    path: configPath,
    projectDirectory: context.projectDirectory,
  });
  const rules = architectureRules({ configUri, options });
  let analysis: Promise<ICruiseResult> | undefined;

  return {
    analyze: () => {
      analysis ??= runDependencyCruiser({
        options,
        projectDirectory: context.projectDirectory,
        sourcePaths,
      });
      return analysis;
    },
    configUri,
    projectDirectory: context.projectDirectory,
    rules,
  };
}

function architectureRules({
  configUri,
  options,
}: {
  configUri: string;
  options: ICruiseOptions;
}) {
  const rules = new Map<string, ArchitectureRule>();
  for (const rule of options.ruleSet?.forbidden ?? []) {
    if (!rule.name || !premiseIdPattern.test(rule.name)) {
      continue;
    }
    if (!("to" in rule)) {
      throw new Error(
        `Architecture premise ${rule.name} in ${configUri} must be a dependency rule with from and to constraints`,
      );
    }
    if (!rule.comment?.trim()) {
      throw new Error(
        `Architecture premise ${rule.name} in ${configUri} must have a comment describing the constraint`,
      );
    }
    const premise: Premise = {
      assertion: {
        dialect: "dependency-cruiser",
        ref: { selector: rule.name, uri: configUri },
      },
      description: rule.comment.trim(),
      id: rule.name,
      type: "architecture",
    };
    if (rules.has(rule.name)) {
      throw new Error(
        `Duplicate architecture premise ${rule.name} in ${configUri}`,
      );
    }
    rules.set(rule.name, { premise, rule });
  }
  return rules;
}

async function runDependencyCruiser({
  options,
  projectDirectory,
  sourcePaths,
}: {
  options: ICruiseOptions;
  projectDirectory: string;
  sourcePaths: string[];
}) {
  const result = await cruise(sourcePaths, {
    ...options,
    baseDir: projectDirectory,
    outputType: undefined,
    validate: true,
  });
  if (typeof result.output === "string") {
    throw new Error("dependency-cruiser returned an unexpected result");
  }
  return result.output;
}

async function evaluateArchitecturePremise({
  premise,
  project,
}: {
  premise: Premise;
  project: DependencyCruiserProject;
}): Promise<EvaluationResult> {
  const architectureRule = project.rules.get(premise.id);
  if (!architectureRule) {
    return {
      reason: `Dependency-cruiser rule ${premise.id} was not discovered`,
      status: "unknown",
    };
  }

  let result: ICruiseResult;
  try {
    result = await project.analyze();
  } catch (error) {
    return {
      reason: `dependency-cruiser could not evaluate ${premise.id}: ${errorMessage(error)}`,
      status: "unknown",
    };
  }

  const violations = result.summary.violations.filter(
    ({ rule }) => rule.name === premise.id,
  );
  const evidence = architectureEvidence({
    configUri: project.configUri,
    modules: result.modules.map(({ source }) => source),
    rule: architectureRule.rule,
  });

  if (violations.length === 0) {
    return { evidence, status: "established" };
  }

  return {
    diagnostics: violations.map(({ from, to }) => ({
      message: `Forbidden dependency from ${from} to ${to}`,
      uri: from,
    })),
    evidence: [
      ...evidence,
      ...violations.flatMap(({ from, to }) => [
        { role: "subject", uri: from },
        { role: "dependency", uri: to },
      ]),
    ],
    status: "failed",
  };
}

function architectureEvidence({
  configUri,
  modules,
  rule,
}: {
  configUri: string;
  modules: string[];
  rule: IForbiddenRuleType;
}): Evidence[] {
  return [
    { role: "assertion", uri: configUri },
    ...modules
      .filter((source) => matchesRestriction({ restriction: rule.from, source }))
      .map((uri) => ({ role: "subject", uri })),
  ];
}

function matchesRestriction({
  restriction,
  source,
}: {
  restriction: { path?: string | string[]; pathNot?: string | string[] };
  source: string;
}) {
  return (
    matchesAnyPattern({ patterns: restriction.path, source, whenAbsent: true }) &&
    !matchesAnyPattern({
      patterns: restriction.pathNot,
      source,
      whenAbsent: false,
    })
  );
}

function matchesAnyPattern({
  patterns,
  source,
  whenAbsent,
}: {
  patterns?: string | string[];
  source: string;
  whenAbsent: boolean;
}) {
  if (!patterns) {
    return whenAbsent;
  }
  const values = Array.isArray(patterns) ? patterns : [patterns];
  return values.some((pattern) => new RegExp(pattern).test(source));
}

async function findConfigFile({
  configFiles,
  projectDirectory,
}: {
  configFiles: string[];
  projectDirectory: string;
}) {
  for (const configFile of configFiles) {
    const path = resolve(projectDirectory, configFile);
    try {
      await access(path);
      return path;
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }
  return undefined;
}

function normalizeProjectPath({
  path,
  projectDirectory,
}: {
  path: string;
  projectDirectory: string;
}) {
  const relativePath = relative(resolve(projectDirectory), path);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${path} must be inside the project`);
  }
  return relativePath.split("\\").join("/");
}

function emptyCruiseResult(): ICruiseResult {
  return {
    modules: [],
    summary: {
      error: 0,
      ignore: 0,
      info: 0,
      optionsUsed: {},
      totalCruised: 0,
      violations: [],
      warn: 0,
    },
  };
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
