import { ConfigurationError } from "../errors.js";
import { arrayOf, compareText, isRecord } from "../text.js";
import type { RuleResult } from "./model.js";
import { parseJson } from "./parse-json.js";

export function parseDependencyCruiser({ content, uri }: { content: string; uri: string }): RuleResult[] {
  const document = parseJson({ content, uri });
  if (
    !isRecord(document) ||
    !Array.isArray(document.modules) ||
    !isRecord(document.summary) ||
    !Array.isArray(document.summary.violations) ||
    !isRecord(document.summary.optionsUsed)
  ) {
    throw new ConfigurationError(`${uri}: not a dependency-cruiser JSON report`);
  }
  const summary = document.summary;
  const blindReason = blindnessOf({
    modules: document.modules,
    optionsUsed: summary.optionsUsed as Record<string, unknown>,
    ignored: summary.ignore,
  });
  const violated = new Set(
    (summary.violations as unknown[]).flatMap((violation) =>
      isRecord(violation) && isRecord(violation.rule) && typeof violation.rule.name === "string" ? [violation.rule.name] : [],
    ),
  );
  const ruleSet = isRecord(summary.ruleSetUsed) ? summary.ruleSetUsed : {};
  return [...arrayOf(ruleSet.forbidden), ...arrayOf(ruleSet.required)]
    .filter(isRecord)
    .flatMap((rule) =>
      typeof rule.name === "string"
        ? [
            {
              name: rule.name,
              definition: { name: rule.name, severity: rule.severity, from: rule.from, to: rule.to },
              violated: violated.has(rule.name),
              blindReason: blindReason ?? (rule.severity === "ignore" ? "rule severity is ignore, so it is not checked" : undefined),
              source: uri,
            },
          ]
        : [],
    );
}

function blindnessOf({
  modules,
  optionsUsed,
  ignored,
}: {
  modules: unknown[];
  optionsUsed: Record<string, unknown>;
  ignored: unknown;
}): string | undefined {
  const unresolved = modules
    .filter(isRecord)
    .filter(
      (module) =>
        module.couldNotResolve === true ||
        arrayOf(module.dependencies).some((dependency) => isRecord(dependency) && dependency.couldNotResolve === true),
    )
    .map((module) => String(module.source))
    .sort(compareText);
  if (unresolved.length > 0) {
    return `unresolved imports in ${unresolved.join(", ")}`;
  }
  if (optionsUsed.includeOnly !== undefined) {
    return "includeOnly can hide unresolved imports";
  }
  if (optionsUsed.exclude !== undefined) {
    return "exclude can hide unresolved imports";
  }
  if (optionsUsed.knownViolations !== undefined) {
    return "known violations are ignored";
  }
  if (typeof ignored === "number" && ignored > 0) {
    return `${ignored} violations were ignored`;
  }
  return undefined;
}
