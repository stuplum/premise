import { faker } from "@faker-js/faker";
import { stringify } from "yaml";
import { fingerprintOf } from "../../src/fingerprint.js";
import { stableJson } from "../../src/stable-json.js";

export type ConfigDocument = Record<string, unknown>;

export function createConfig(overrides: ConfigDocument = {}): ConfigDocument {
  return {
    decisions: "decisions",
    reports: [{ format: "junit", path: "reports/unit.xml" }],
    ...overrides,
  };
}

export function configFile(overrides: ConfigDocument = {}): Record<string, string> {
  return { "premise.yaml": stringify(createConfig(overrides)) };
}

export type DecisionDocument = Record<string, unknown> & { id: string };

export function createDecision(overrides: Partial<DecisionDocument> = {}): DecisionDocument {
  const option = faker.lorem.words(3);
  return {
    id: `ADR-${faker.number.int({ min: 100, max: 999 })}`,
    title: faker.lorem.sentence(),
    status: "accepted",
    date: "2026-10-25",
    context: faker.lorem.paragraph(),
    options: [{ name: option, pros: [faker.lorem.sentence()], cons: [faker.lorem.sentence()] }],
    decision: option,
    because: [faker.lorem.sentence()],
    consequences: [faker.lorem.sentence()],
    ...overrides,
  };
}

export function decisionFiles({ decisions }: { decisions: DecisionDocument[] }): Record<string, string> {
  return Object.fromEntries(
    decisions.map((decision) => [`decisions/${decision.id}.yaml`, stringify(decision)]),
  );
}

export type JunitCaseFixture = { name: string; outcome?: "passed" | "failed" | "skipped"; file?: string };

export function junitReport({ cases }: { cases: JunitCaseFixture[] }): string {
  const body = cases.map((testCase) => {
    const file = testCase.file === undefined ? "" : ` file="${escapeXml(testCase.file)}"`;
    const open = `<testcase name="${escapeXml(testCase.name)}" classname="test"${file}`;
    if (testCase.outcome === "failed") {
      return `${open}><failure message="boom"/></testcase>`;
    }
    if (testCase.outcome === "skipped") {
      return `${open}><skipped/></testcase>`;
    }
    return `${open}/>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n${body.join("\n")}\n</testsuites>\n`;
}

export type ScenarioFixture = { tags: string[]; statuses: string[]; type?: string };

export function cucumberJsonReport({ scenarios }: { scenarios: ScenarioFixture[] }): string {
  return JSON.stringify([
    {
      uri: "features/example.feature",
      elements: scenarios.map((scenario) => ({
        type: scenario.type ?? "scenario",
        tags: scenario.tags.map((name) => ({ name })),
        steps: scenario.statuses.map((status) => ({ result: { status } })),
      })),
    },
  ]);
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export type RuleFixture = {
  name: string;
  severity?: string;
  comment?: string;
  from?: Record<string, unknown>;
  to?: Record<string, unknown>;
};

export function dependencyCruiserReport({
  rules = [],
  violations = [],
  unresolved = false,
  optionsUsed = {},
}: {
  rules?: RuleFixture[];
  violations?: string[];
  unresolved?: boolean;
  optionsUsed?: Record<string, unknown>;
} = {}): string {
  return JSON.stringify({
    modules: [
      { source: "src/a.ts", dependencies: [{ resolved: unresolved ? "missing" : "src/b.ts", couldNotResolve: unresolved }] },
      { source: "src/b.ts", dependencies: [] },
    ],
    summary: {
      violations: violations.map((name) => ({ from: "src/a.ts", to: "src/b.ts", rule: { name, severity: "error" } })),
      optionsUsed,
      ruleSetUsed: { forbidden: rules },
    },
  });
}

export const noDbRule = { name: "no-db", severity: "error", from: { path: "^src" }, to: { path: "pg" } };

export const noDbText = `${stableJson(noDbRule)}\n`;

export const noDbFingerprint = fingerprintOf(noDbText);

export function decisionProject({
  decisions,
  violations = [],
  cases = [],
  config = {},
}: {
  decisions: DecisionDocument[];
  violations?: string[];
  cases?: JunitCaseFixture[];
  config?: ConfigDocument;
}): Record<string, string> {
  return {
    ...configFile({
      reports: [
        { format: "dependency-cruiser", path: "reports/depcruise.json" },
        { format: "junit", path: "reports/unit.xml" },
      ],
      ...config,
    }),
    ...decisionFiles({ decisions }),
    "reports/depcruise.json": dependencyCruiserReport({ rules: [noDbRule], violations }),
    "reports/unit.xml": junitReport({ cases }),
  };
}
