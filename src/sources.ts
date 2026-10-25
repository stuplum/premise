import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { CheckSources, TestFile } from "./check-text.js";
import { ConfigurationError } from "./errors.js";
import { loadGherkinFiles, parsePickles, selectsGherkinFile, type GherkinFile } from "./gherkin.js";
import { filesAtRef, readAtRef } from "./git.js";
import type { Config } from "./model.js";
import { leavesDirectory } from "./paths.js";
import { ruleDefinition } from "./reports/dependency-cruiser.js";
import type { Reports, RuleDefinition } from "./reports/model.js";
import { parseJson } from "./reports/parse-json.js";
import { arrayOf, compareText, isRecord } from "./text.js";

export async function currentSources({
  projectDirectory,
  config,
  reports,
}: {
  projectDirectory: string;
  config: Config;
  reports: Reports;
}): Promise<CheckSources> {
  return {
    gherkin: await loadGherkinFiles({ projectDirectory, config }),
    rules:
      config.dependencyCruiserConfig === undefined
        ? reports.rules.map((rule) => rule.definition)
        : configRules({
            content: await readConfiguredFile({ projectDirectory, uri: config.dependencyCruiserConfig }),
            uri: config.dependencyCruiserConfig,
          }),
    testFiles: async (id) => {
      const paths = await testFilePaths({ projectDirectory, reports, id });
      if (paths === undefined) {
        return undefined;
      }
      const files = [];
      for (const path of paths) {
        files.push({ path, content: await readFile(join(projectDirectory, path), "utf8") });
      }
      return files;
    },
  };
}

export function configRules({ content, uri }: { content: string; uri: string }): RuleDefinition[] {
  const document = parseJson({ content, uri });
  if (!isRecord(document)) {
    throw new ConfigurationError(`${uri}: not a dependency-cruiser configuration`);
  }
  return [...arrayOf(document.forbidden), ...arrayOf(document.required)]
    .filter(isRecord)
    .flatMap((rule) => (typeof rule.name === "string" ? [ruleDefinition({ rule, name: rule.name })] : []));
}

export async function testFilePaths({
  projectDirectory,
  reports,
  id,
}: {
  projectDirectory: string;
  reports: Reports;
  id: string;
}): Promise<string[] | undefined> {
  const cases = reports.cases.filter((testCase) => testCase.checks.includes(id));
  if (cases.length === 0) {
    return undefined;
  }
  const root = await realpath(projectDirectory);
  const paths = new Set<string>();
  for (const testCase of cases) {
    const path = testCase.file === undefined ? undefined : await projectFile({ root, file: testCase.file });
    if (path === undefined) {
      return undefined;
    }
    paths.add(path);
  }
  return [...paths].sort(compareText);
}

async function readConfiguredFile({ projectDirectory, uri }: { projectDirectory: string; uri: string }): Promise<string> {
  try {
    return await readFile(join(projectDirectory, uri), "utf8");
  } catch {
    throw new ConfigurationError(`${uri}: cannot be read`);
  }
}

async function projectFile({ root, file }: { root: string; file: string }): Promise<string | undefined> {
  try {
    const absolute = await realpath(isAbsolute(file) ? file : join(root, file));
    const path = relative(root, absolute);
    if (path === "" || leavesDirectory(path)) {
      return undefined;
    }
    return (await stat(absolute)).isFile() ? path.split(sep).join("/") : undefined;
  } catch {
    return undefined;
  }
}

export async function sourcesAtCommit({
  projectDirectory,
  config,
  reports,
  commit,
}: {
  projectDirectory: string;
  config: Config;
  reports: Reports;
  commit: string;
}): Promise<CheckSources> {
  const pattern = config.gherkin;
  const gherkinUris =
    pattern === undefined
      ? []
      : (await filesAtRef({ projectDirectory, ref: commit }))
          .filter((uri) => selectsGherkinFile({ uri, pattern }))
          .sort(compareText);
  const gherkin: GherkinFile[] = [];
  for (const uri of gherkinUris) {
    gherkin.push({ uri, pickles: parsePickles({ content: (await readAtRef({ projectDirectory, ref: commit, uri })) ?? "", uri }) });
  }
  const configContent =
    config.dependencyCruiserConfig === undefined
      ? undefined
      : await readAtRef({ projectDirectory, ref: commit, uri: config.dependencyCruiserConfig });
  return {
    gherkin,
    rules:
      configContent === undefined || config.dependencyCruiserConfig === undefined
        ? []
        : configRules({ content: configContent, uri: config.dependencyCruiserConfig }),
    testFiles: async (id) => {
      const paths = await testFilePaths({ projectDirectory, reports, id });
      if (paths === undefined) {
        return undefined;
      }
      const files: TestFile[] = [];
      for (const path of paths) {
        const content = await readAtRef({ projectDirectory, ref: commit, uri: path });
        if (content === undefined) {
          return undefined;
        }
        files.push({ path, content });
      }
      return files;
    },
  };
}
