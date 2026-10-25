import { ConfigurationError } from "../errors.js";
import { isRecord } from "../text.js";
import type { CaseOutcome, TestCase } from "./model.js";
import { parseJson } from "./parse-json.js";
import { tagTokens } from "./tags.js";

export function parseCucumberJson({ content, uri }: { content: string; uri: string }): TestCase[] {
  const document = parseJson({ content, uri });
  if (!Array.isArray(document)) {
    throw new ConfigurationError(`${uri}: Cucumber JSON must be an array of features`);
  }
  return document.flatMap((feature) => featureCases({ feature, uri }));
}

function featureCases({ feature, uri }: { feature: unknown; uri: string }): TestCase[] {
  if (!isRecord(feature) || typeof feature.uri !== "string") {
    throw malformed({ uri, detail: "feature without a uri" });
  }
  const elements = feature.elements ?? [];
  if (!Array.isArray(elements)) {
    throw malformed({ uri, detail: `${feature.uri} elements is not an array` });
  }
  const file = feature.uri;
  const cases: TestCase[] = [];
  let background: string[] = [];
  for (const element of elements) {
    if (isRecord(element) && element.type === "background") {
      background = elementStatuses({ element, file, uri });
      continue;
    }
    cases.push(scenarioCase({ element, file, uri, background }));
    background = [];
  }
  return cases;
}

function scenarioCase({
  element,
  file,
  uri,
  background,
}: {
  element: unknown;
  file: string;
  uri: string;
  background: string[];
}): TestCase {
  const statuses = [...background, ...elementStatuses({ element, file, uri })];
  const tags = isRecord(element) ? (element.tags ?? []) : [];
  if (!Array.isArray(tags)) {
    throw malformed({ uri, detail: `scenario in ${file} has tags that are not an array` });
  }
  return {
    checks: tagTokens(tags.map((tag) => tagName({ tag, uri })).join(" ")),
    outcome: outcomeOf(statuses),
    file,
    source: uri,
  };
}

function tagName({ tag, uri }: { tag: unknown; uri: string }): string {
  if (isRecord(tag) && typeof tag.name === "string") {
    return tag.name;
  }
  throw malformed({ uri, detail: "tag without a name" });
}

function stepStatus({ step, uri }: { step: unknown; uri: string }): string {
  if (isRecord(step) && isRecord(step.result) && typeof step.result.status === "string") {
    return step.result.status;
  }
  throw malformed({ uri, detail: "step without a result status" });
}

function elementStatuses({ element, file, uri }: { element: unknown; file: string; uri: string }): string[] {
  if (!isRecord(element) || !Array.isArray(element.steps)) {
    throw malformed({ uri, detail: `scenario in ${file} without steps` });
  }
  return [
    ...hookStatuses({ hooks: element.before, uri }),
    ...element.steps.flatMap((step) => [
      ...hookStatuses({ hooks: isRecord(step) ? step.before : undefined, uri }),
      stepStatus({ step, uri }),
      ...hookStatuses({ hooks: isRecord(step) ? step.after : undefined, uri }),
    ]),
    ...hookStatuses({ hooks: element.after, uri }),
  ];
}

function hookStatuses({ hooks, uri }: { hooks: unknown; uri: string }): string[] {
  if (hooks === undefined) {
    return [];
  }
  if (!Array.isArray(hooks)) {
    throw malformed({ uri, detail: "hooks that are not an array" });
  }
  return hooks.map((hook) => stepStatus({ step: hook, uri }));
}

function outcomeOf(statuses: string[]): CaseOutcome {
  if (statuses.includes("failed")) {
    return "failed";
  }
  return statuses.length > 0 && statuses.every((status) => status === "passed") ? "passed" : "skipped";
}

function malformed({ uri, detail }: { uri: string; detail: string }): ConfigurationError {
  return new ConfigurationError(`${uri}: malformed Cucumber JSON: ${detail}`);
}
