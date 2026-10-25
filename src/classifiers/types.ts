export const SIGNOFF_QUESTION = "Do the changed checks still support the decision's stated reasons?";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export type SignoffPayload = {
  question: string;
  decision: { id: string; title: string; context: string; because: string[] };
  changes: { check: string; before: string; after: string }[];
};

export type ClassifierResult =
  | { status: "answered"; probability: number }
  | { status: "unavailable"; reason: string };

export type ClassifierRuntime = {
  projectDirectory: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  jevEndpoint: string;
};

export function defaultRuntime({ projectDirectory }: { projectDirectory: string }): ClassifierRuntime {
  return { projectDirectory, env: process.env, timeoutMs: 10_000, jevEndpoint: JEV_ENDPOINT };
}

export function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function unavailable(reason: string): ClassifierResult {
  return { status: "unavailable", reason };
}
