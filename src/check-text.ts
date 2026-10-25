import { gherkinText, type GherkinFile } from "./gherkin.js";
import type { RuleDefinition } from "./reports/model.js";
import { stableJson } from "./stable-json.js";
import { compareText } from "./text.js";

export type TestFile = { path: string; content: string };

export type CheckSources = {
  gherkin: GherkinFile[];
  rules: RuleDefinition[];
  testFiles: (id: string) => Promise<TestFile[] | undefined>;
};

export async function checkText({ id, sources }: { id: string; sources: CheckSources }): Promise<string | undefined> {
  const gherkin = gherkinText({ id, files: sources.gherkin });
  if (gherkin !== undefined) {
    return gherkin;
  }
  const rule = sources.rules.find((candidate) => candidate.name === id);
  if (rule) {
    return `${stableJson({ name: rule.name, severity: rule.severity, from: rule.from, module: rule.module, to: rule.to })}\n`;
  }
  const files = await sources.testFiles(id);
  if (files === undefined || files.length === 0) {
    return undefined;
  }
  const lines = [...files]
    .sort((left, right) => compareText(left.path, right.path))
    .flatMap((file) => [`file ${file.path}`, ...normalisedLines(file.content)]);
  return `${lines.join("\n")}\n`;
}

function normalisedLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}
