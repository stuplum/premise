import { stringify } from "yaml";

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
