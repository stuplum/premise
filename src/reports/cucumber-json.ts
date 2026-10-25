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
  return elements
    .filter((element) => !(isRecord(element) && element.type === "background"))
    .map((element) => scenarioCase({ element, file, uri }));
}

function scenarioCase({ element, file, uri }: { element: unknown; file: string; uri: string }): TestCase {
  if (!isRecord(element) || !Array.isArray(element.steps)) {
    throw malformed({ uri, detail: `scenario in ${file} without steps` });
  }
  const tags = element.tags ?? [];
  if (!Array.isArray(tags)) {
    throw malformed({ uri, detail: `scenario in ${file} has tags that are not an array` });
  }
  return {
    checks: tagTokens(tags.map((tag) => tagName({ tag, uri })).join(" ")),
    outcome: outcomeOf(element.steps.map((step) => stepStatus({ step, uri }))),
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

function outcomeOf(statuses: string[]): CaseOutcome {
  if (statuses.includes("failed")) {
    return "failed";
  }
  return statuses.length > 0 && statuses.every((status) => status === "passed") ? "passed" : "skipped";
}

function malformed({ uri, detail }: { uri: string; detail: string }): ConfigurationError {
  return new ConfigurationError(`${uri}: malformed Cucumber JSON: ${detail}`);
}
