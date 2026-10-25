import { stringify } from "yaml";
import { faker } from "@faker-js/faker";

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
