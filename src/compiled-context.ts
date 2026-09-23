import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { calculateFingerprint } from "./fingerprint.js";
import { requirementIds } from "./gherkin-requirements.js";

type RequirementContext = {
  fingerprint: string;
  id: string;
  source: string;
};

type ArtifactContext = {
  artifact: string;
  requirements: RequirementContext[];
  version: 1;
};

type FeatureExecution = {
  artifacts: string[];
  source: string;
};

type CoverageFile = {
  result: Array<{
    functions: Array<{
      functionName: string;
      ranges: Array<{
        count: number;
        endOffset: number;
        startOffset: number;
      }>;
    }>;
    url: string;
  }>;
  "source-map-cache"?: Record<
    string,
    {
      data?: {
        sources?: unknown;
      };
    }
  >;
};

const compiledDirectory = ".premise/compiled";
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

export async function compileFeatureExecutions({
  executions,
  projectDirectory,
}: {
  executions: FeatureExecution[];
  projectDirectory: string;
}) {
  const existingContexts = await readAllContexts({ projectDirectory });
  const verifiedFingerprints = new Map<string, string>();
  for (const context of existingContexts) {
    for (const requirement of context.requirements) {
      verifiedFingerprints.set(requirement.id, requirement.fingerprint);
    }
  }

  const contexts = new Map<string, Map<string, RequirementContext>>();
  const requirementSources = new Map<string, string>();
  const compiledFeatures = [];

  for (const execution of executions) {
    const feature = await readRequirementSource({
      projectDirectory,
      source: execution.source,
    });
    const ids = requirementIds({ content: feature, uri: execution.source });
    if (ids.length > 1) {
      throw new Error(
        `${execution.source} must contain at most one requirement ID. Found: ${ids.join(", ")}`,
      );
    }
    for (const id of ids) {
      const existingSource = requirementSources.get(id);
      if (existingSource && existingSource !== execution.source) {
        throw new Error(
          `Duplicate requirement ID ${id}: ${existingSource}, ${execution.source}`,
        );
      }
      requirementSources.set(id, execution.source);
    }
    compiledFeatures.push({ execution, feature, ids });
  }

  for (const { execution, feature, ids } of compiledFeatures) {
    const fingerprint = calculateFingerprint(feature);
    const requirements = ids.map((id) => ({
      fingerprint: verifiedFingerprints.get(id) ?? fingerprint,
      id,
      source: execution.source,
    }));

    if (requirements.length === 0) {
      process.stderr.write(
        `No requirement ID found in ${execution.source}; no context was compiled.\n`,
      );
      continue;
    }

    for (const artifact of execution.artifacts) {
      const artifactRequirements = contexts.get(artifact) ?? new Map();
      for (const requirement of requirements) {
        artifactRequirements.set(requirement.id, requirement);
      }
      contexts.set(artifact, artifactRequirements);
    }
  }

  const directory = resolveProjectPath({
    projectDirectory,
    relativePath: compiledDirectory,
  });
  await rm(directory, { force: true, recursive: true });

  await Promise.all(
    [...contexts.entries()].map(async ([artifact, requirements]) => {
      const path = join(directory, `${artifact}.json`);
      const context: ArtifactContext = {
        artifact,
        requirements: [...requirements.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        version: 1,
      };
      await writeContext({ context, path });
    }),
  );
}

export async function acknowledgeCompiledRequirement({
  projectDirectory,
  requirementId,
}: {
  projectDirectory: string;
  requirementId: string;
}) {
  const contexts = await readAllContexts({ projectDirectory });
  const fingerprints = new Map<string, string>();
  let acknowledged = false;

  await Promise.all(
    contexts.map(async (context) => {
      if (
        !context.requirements.some(
          (requirement) => requirement.id === requirementId,
        )
      ) {
        return;
      }

      acknowledged = true;
      context.requirements = await Promise.all(
        context.requirements.map(async (requirement) =>
          requirement.id === requirementId
            ? {
                ...requirement,
                fingerprint: await currentFingerprint({
                  fingerprints,
                  projectDirectory,
                  source: requirement.source,
                }),
              }
            : requirement,
        ),
      );
      await writeContext({
        context,
        path: resolveProjectPath({
          projectDirectory,
          relativePath: `${compiledDirectory}/${context.artifact}.json`,
        }),
      });
    }),
  );

  return acknowledged;
}

export async function collectExecutedArtifacts({
  baselineCoverageDirectory,
  coverageDirectory,
  projectDirectory,
  stepFiles,
}: {
  baselineCoverageDirectory: string;
  coverageDirectory: string;
  projectDirectory: string;
  stepFiles: string[];
}) {
  const [baseline, coverageFiles, resolvedProjectDirectory, resolvedStepFiles] =
    await Promise.all([
      readCoverageCounts(baselineCoverageDirectory),
      readCoverageFiles(coverageDirectory),
      realpath(projectDirectory),
      Promise.all(
        stepFiles.map((path) => realpath(resolve(projectDirectory, path))),
      ),
    ]);
  const steps = new Set(resolvedStepFiles);
  const artifacts = new Set<string>();
  const unreliableModulePaths = new Set<string>();

  for (const coverage of coverageFiles) {
    for (const script of coverage.result) {
      const path = await resolveCoveredFile({
        coverage,
        url: script.url,
      });
      if (
        !path ||
        steps.has(path) ||
        !isProjectSource({ path, resolvedProjectDirectory })
      ) {
        continue;
      }

      const source = await readFile(path, "utf8");
      const executedFunctions = executedFunctionsBeyondBaseline(script, baseline);
      if (
        !executedFunctions.some((name) => sourceDefinesFunction({ name, source }))
      ) {
        continue;
      }

      const artifact = normalizePath(relative(resolvedProjectDirectory, path));
      artifacts.add(artifact);
      if (hasUnreliableModuleIdentity(script.url)) {
        unreliableModulePaths.add(artifact);
      }
    }
  }

  return {
    artifacts: [...artifacts].sort(),
    unreliableModulePaths: [...unreliableModulePaths].sort(),
  };
}

export async function findChangedCompiledRequirements({
  projectDirectory,
}: {
  projectDirectory: string;
}) {
  const contexts = await readAllContexts({ projectDirectory });
  const changes = new Map<string, { affects: Set<string>; id: string }>();
  const fingerprints = new Map<string, string>();

  for (const context of contexts) {
    for (const requirement of context.requirements) {
      const fingerprint = await currentFingerprint({
        fingerprints,
        projectDirectory,
        source: requirement.source,
      });
      if (fingerprint === requirement.fingerprint) {
        continue;
      }

      const change = changes.get(requirement.id) ?? {
        affects: new Set<string>(),
        id: requirement.id,
      };
      change.affects.add(context.artifact);
      changes.set(requirement.id, change);
    }
  }

  return [...changes.values()].map((change) => ({
    affects: [...change.affects].sort(),
    id: change.id,
  }));
}

export async function readArtifactGherkin({
  artifact,
  projectDirectory,
}: {
  artifact: string;
  projectDirectory: string;
}) {
  const relativeArtifact = await normalizeArtifactPath({
    artifact,
    projectDirectory,
  });
  const context = await readContext({
    artifact: relativeArtifact,
    projectDirectory,
  });
  if (!context) {
    return [];
  }
  const sources = [
    ...new Set(context.requirements.map((requirement) => requirement.source)),
  ].sort();
  return Promise.all(
    sources.map(async (source) => ({
      content: await readRequirementSource({ projectDirectory, source }),
      source,
    })),
  );
}

async function readAllContexts({ projectDirectory }: { projectDirectory: string }) {
  const directory = resolveProjectPath({
    projectDirectory,
    relativePath: compiledDirectory,
  });
  const paths = await glob("**/*.json", {
    absolute: true,
    cwd: directory,
    nodir: true,
  });
  return Promise.all(
    paths.sort().map(async (path) => {
      const expectedArtifact = normalizePath(relative(directory, path)).replace(
        /\.json$/,
        "",
      );
      return parseArtifactContext({
        content: await readFile(path, "utf8"),
        expectedArtifact,
        path,
      });
    }),
  );
}

async function currentFingerprint({
  fingerprints,
  projectDirectory,
  source,
}: {
  fingerprints: Map<string, string>;
  projectDirectory: string;
  source: string;
}) {
  const existing = fingerprints.get(source);
  if (existing) {
    return existing;
  }

  const feature = await readRequirementSource({ projectDirectory, source });
  const fingerprint = calculateFingerprint(feature);
  fingerprints.set(source, fingerprint);
  return fingerprint;
}

async function readRequirementSource({
  projectDirectory,
  source,
}: {
  projectDirectory: string;
  source: string;
}) {
  try {
    return await readFile(
      resolveProjectPath({ projectDirectory, relativePath: source }),
      "utf8",
    );
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(
        `Requirement source ${source} no longer exists. Run premise test.`,
      );
    }
    throw error;
  }
}

async function readContext({
  artifact,
  projectDirectory,
}: {
  artifact: string;
  projectDirectory: string;
}) {
  const path = resolveProjectPath({
    projectDirectory,
    relativePath: `${compiledDirectory}/${artifact}.json`,
  });

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }

  return parseArtifactContext({
    content,
    expectedArtifact: artifact,
    path,
  });
}

async function writeContext({
  context,
  path,
}: {
  context: ArtifactContext;
  path: string;
}) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(context, null, 2)}\n`, "utf8");
}

async function readCoverageFiles(directory: string) {
  const paths = await glob("*.json", {
    absolute: true,
    cwd: directory,
    nodir: true,
  });
  return Promise.all(
    paths.map(
      async (path) =>
        JSON.parse(await readFile(path, "utf8")) as CoverageFile,
    ),
  );
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readCoverageCounts(directory: string) {
  const coverageFiles = await readCoverageFiles(directory);
  const counts = new Map<string, number>();

  for (const coverage of coverageFiles) {
    for (const script of coverage.result) {
      for (const fn of script.functions) {
        for (const range of fn.ranges) {
          const key = coverageRangeKey({ range, url: script.url });
          counts.set(key, (counts.get(key) ?? 0) + range.count);
        }
      }
    }
  }

  return counts;
}

function executedFunctionsBeyondBaseline(
  script: CoverageFile["result"][number],
  baseline: Map<string, number>,
) {
  return script.functions
    .filter(
      (fn) =>
        !isAnonymousEnclosingFunction({
          candidate: fn,
          functions: script.functions,
        }) &&
        !isEarlierFunctionWithSameName({
          candidate: fn,
          functions: script.functions,
        }) &&
        fn.ranges.some(
          (range) =>
            range.count >
            (baseline.get(coverageRangeKey({ range, url: script.url })) ?? 0),
        ),
    )
    .map((fn) => fn.functionName);
}

function isEarlierFunctionWithSameName({
  candidate,
  functions,
}: {
  candidate: CoverageFile["result"][number]["functions"][number];
  functions: CoverageFile["result"][number]["functions"];
}) {
  if (candidate.functionName === "") {
    return false;
  }

  return functions.some(
    (fn) =>
      fn.functionName === candidate.functionName &&
      fn.ranges[0].startOffset > candidate.ranges[0].startOffset,
  );
}

function isAnonymousEnclosingFunction({
  candidate,
  functions,
}: {
  candidate: CoverageFile["result"][number]["functions"][number];
  functions: CoverageFile["result"][number]["functions"];
}) {
  if (candidate.functionName !== "") {
    return false;
  }

  return candidate.ranges.some((candidateRange) =>
    functions.some(
      (fn) =>
        fn !== candidate &&
        fn.ranges.some(
          (range) =>
            candidateRange.startOffset <= range.startOffset &&
            candidateRange.endOffset >= range.endOffset &&
            (candidateRange.startOffset < range.startOffset ||
              candidateRange.endOffset > range.endOffset),
        ),
    ),
  );
}

function coverageRangeKey({
  range,
  url,
}: {
  range: { endOffset: number; startOffset: number };
  url: string;
}) {
  return `${url}:${range.startOffset}:${range.endOffset}`;
}

async function resolveCoveredFile({
  coverage,
  url,
}: {
  coverage: CoverageFile;
  url: string;
}) {
  if (url.startsWith("file:")) {
    return resolveFileUrl(url);
  }

  const sources = coverage["source-map-cache"]?.[url]?.data?.sources;
  if (
    !Array.isArray(sources) ||
    sources.length !== 1 ||
    typeof sources[0] !== "string" ||
    !sources[0].startsWith("file:")
  ) {
    return undefined;
  }

  return resolveFileUrl(sources[0]);
}

async function resolveFileUrl(url: string) {
  try {
    const path = fileURLToPath(url);
    const queryIndex = path.indexOf("?");
    return await realpath(queryIndex === -1 ? path : path.slice(0, queryIndex));
  } catch {
    return undefined;
  }
}

function hasUnreliableModuleIdentity(url: string) {
  try {
    return [...new URL(url).searchParams.keys()].some(
      (key) => !key.startsWith("tsx-"),
    );
  } catch {
    return false;
  }
}

function sourceDefinesFunction({ name, source }: { name: string; source: string }) {
  if (name === "") {
    return true;
  }

  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    return false;
  }

  return new RegExp(`\\b${escapeRegex(name)}\\b`).test(source);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isProjectSource({
  path,
  resolvedProjectDirectory,
}: {
  path: string;
  resolvedProjectDirectory: string;
}) {
  const relativePath = relative(resolvedProjectDirectory, path);
  const segments = normalizePath(relativePath).split("/");
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !segments.includes("node_modules") &&
    segments[0] !== ".premise" &&
    sourceExtensions.has(extname(path))
  );
}

function resolveProjectPath({
  projectDirectory,
  relativePath,
}: {
  projectDirectory: string;
  relativePath: string;
}) {
  const directory = resolve(projectDirectory);
  const path = resolve(directory, relativePath);

  if (relative(directory, path).startsWith("..")) {
    throw new Error(`${relativePath} must be inside the project`);
  }

  return path;
}

function normalizePath(path: string) {
  return path.split("\\").join("/");
}

async function normalizeArtifactPath({
  artifact,
  projectDirectory,
}: {
  artifact: string;
  projectDirectory: string;
}) {
  const directory = await realpath(projectDirectory);
  let artifactPath = resolve(directory, artifact);
  try {
    artifactPath = await realpath(artifactPath);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
  const relativeArtifact = relative(directory, artifactPath);

  if (
    relativeArtifact === "" ||
    relativeArtifact.startsWith("..") ||
    isAbsolute(relativeArtifact)
  ) {
    throw new Error(`${artifact} must be inside the project`);
  }

  return normalizePath(relativeArtifact);
}

function parseArtifactContext({
  content,
  expectedArtifact,
  path,
}: {
  content: string;
  expectedArtifact: string;
  path: string;
}): ArtifactContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw invalidCompiledContext(path);
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.artifact !== expectedArtifact ||
    !Array.isArray(parsed.requirements) ||
    parsed.requirements.length === 0
  ) {
    throw invalidCompiledContext(path);
  }

  const requirementIds = new Set<string>();
  for (const requirement of parsed.requirements) {
    if (
      !isRecord(requirement) ||
      typeof requirement.id !== "string" ||
      !/^[A-Z][A-Z0-9]*-\d+$/.test(requirement.id) ||
      typeof requirement.source !== "string" ||
      requirement.source.length === 0 ||
      typeof requirement.fingerprint !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(requirement.fingerprint) ||
      requirementIds.has(requirement.id)
    ) {
      throw invalidCompiledContext(path);
    }
    requirementIds.add(requirement.id);
  }

  return parsed as ArtifactContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidCompiledContext(path: string) {
  return new Error(`Invalid compiled context: ${path}`);
}
