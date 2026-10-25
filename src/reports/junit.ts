import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ConfigurationError } from "../errors.js";
import { isRecord } from "../text.js";
import type { CaseOutcome, TestCase } from "./model.js";
import { tagTokens } from "./tags.js";

type JunitCase = Record<string, unknown>;

const repeatable = new Set(["testsuite", "testcase", "failure", "error", "skipped"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => repeatable.has(name),
});

export function parseJunit({ content, uri }: { content: string; uri: string }): TestCase[] {
  const validation = XMLValidator.validate(content);
  if (validation !== true) {
    throw new ConfigurationError(`${uri}: invalid JUnit XML: ${validation.err.msg}`);
  }
  const document: unknown = parser.parse(content);
  if (!isRecord(document) || !("testsuites" in document || "testsuite" in document)) {
    throw new ConfigurationError(`${uri}: not a JUnit report`);
  }
  return collectCases(document).map((junitCase) => toTestCase({ junitCase, uri }));
}

function collectCases(node: unknown): JunitCase[] {
  if (!isRecord(node)) {
    return [];
  }
  const own = Array.isArray(node.testcase) ? node.testcase.filter(isRecord) : [];
  const suites = [node.testsuites, ...(Array.isArray(node.testsuite) ? node.testsuite : [])];
  return [...own, ...suites.flatMap(collectCases)];
}

function toTestCase({ junitCase, uri }: { junitCase: JunitCase; uri: string }): TestCase {
  const name = junitCase["@_name"];
  if (typeof name !== "string") {
    throw new ConfigurationError(`${uri}: testcase without a name`);
  }
  return {
    checks: tagTokens(name),
    outcome: outcomeOf(junitCase),
    file: stringAttribute({ junitCase, attribute: "@_file" }) ?? stringAttribute({ junitCase, attribute: "@_classname" }),
    source: uri,
  };
}

function outcomeOf(junitCase: JunitCase): CaseOutcome {
  if ("failure" in junitCase || "error" in junitCase) {
    return "failed";
  }
  return "skipped" in junitCase ? "skipped" : "passed";
}

function stringAttribute({ junitCase, attribute }: { junitCase: JunitCase; attribute: string }): string | undefined {
  const value = junitCase[attribute];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
