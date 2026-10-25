import { isAbsolute, relative, resolve, sep } from "node:path";
import { minimatch } from "minimatch";
import { loadConfig } from "./config.js";
import { loadDecisions } from "./decisions.js";
import { ConfigurationError } from "./errors.js";
import type { Decision } from "./model.js";
import { loadAvailableRules } from "./reports/load.js";
import type { RuleResult } from "./reports/model.js";
import { isRecord } from "./text.js";

export type ContextResult = { path: string; decisions: Decision[]; notes: string[] };

export async function decisionsForFile({
  projectDirectory,
  file,
}: {
  projectDirectory: string;
  file: string;
}): Promise<ContextResult> {
  const path = projectPath({ projectDirectory, file });
  const config = await loadConfig({ projectDirectory });
  const decisions = await loadDecisions({ projectDirectory, config });
  const { rules, missing } = await loadAvailableRules({ projectDirectory, config });
  return {
    path,
    decisions: decisions.filter(
      (decision) =>
        decision.status === "accepted" && (matchesScope({ decision, path }) || matchesRule({ decision, path, rules })),
    ),
    notes: missing.map((pattern) => `No dependency-cruiser report matches ${pattern}; matched by scope only.`),
  };
}

export function formatContext(result: ContextResult): string {
  const blocks = result.decisions.map((decision) =>
    [
      `${decision.id} ${decision.title}`,
      `  decision: ${decision.decision}`,
      "  because:",
      ...decision.because.map((reason) => `    - ${reason}`),
    ].join("\n"),
  );
  const lines = blocks.length > 0 ? blocks : [`No accepted decisions apply to ${result.path}.`];
  return `${[...lines, ...result.notes].join("\n")}\n`;
}

function projectPath({ projectDirectory, file }: { projectDirectory: string; file: string }): string {
  const path = relative(projectDirectory, resolve(projectDirectory, file));
  if (path === "" || path.startsWith("..") || isAbsolute(path)) {
    throw new ConfigurationError(`${file} is outside the project`);
  }
  return path.split(sep).join("/");
}

function matchesScope({ decision, path }: { decision: Decision; path: string }): boolean {
  return decision.scope.some((pattern) => minimatch(path, pattern, { dot: true }));
}

function matchesRule({ decision, path, rules }: { decision: Decision; path: string; rules: RuleResult[] }): boolean {
  const linked = new Set([...decision.supportedBy, ...decision.enforcedBy].map((link) => link.check));
  return rules.some((rule) => linked.has(rule.name) && ruleAppliesTo({ rule, path }));
}

function ruleAppliesTo({ rule, path }: { rule: RuleResult; path: string }): boolean {
  const from = isRecord(rule.definition.from) ? rule.definition.from : {};
  const included = from.path === undefined || patternsOf(from.path).some((pattern) => new RegExp(pattern).test(path));
  const excluded = from.pathNot !== undefined && patternsOf(from.pathNot).some((pattern) => new RegExp(pattern).test(path));
  return included && !excluded;
}

function patternsOf(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter((pattern): pattern is string => typeof pattern === "string");
}
