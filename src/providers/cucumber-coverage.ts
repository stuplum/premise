import { readFile, realpath } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";

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

const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

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
      const path = await resolveCoveredFile({ coverage, url: script.url });
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

function normalizePath(path: string) {
  return path.split("\\").join("/");
}
