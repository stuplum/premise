import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { glob } from "glob";
import type { AgentAdvisory } from "./agent-model.js";
import type { DecisionAst } from "./decision-model.js";
import { parseDecision } from "./decision-parser.js";
import { readConfiguration } from "./repository.js";

type Question = {
  description: string;
  instructions: string;
  criteria: { true: string; false: string };
};

type JevQuestions = {
  version: 1;
  model: string;
  thresholds: { established: number; failed: number };
  contextPaths: string[];
  questions: Record<string, Question>;
};

type DecisionSource = { uri: string; content: string; decision: DecisionAst };

type JevResponse = {
  model: string;
  answers: Record<string, { type: unknown; noul: unknown }>;
};

export async function reviewWithJev({
  projectDirectory,
  originalDecisions,
}: {
  projectDirectory: string;
  originalDecisions: Record<string, string>;
}): Promise<AgentAdvisory[]> {
  const { jev } = await readConfiguration({ projectDirectory });
  if (!jev) {
    return [];
  }

  const directory = await realpath(projectDirectory);
  const content = await readProjectFile(directory, jev.questions);
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error(`Invalid Jev configuration ${jev.questions}: expected JSON`);
  }
  const configuration = readQuestions(raw, jev.questions);
  const context = Object.fromEntries(
    await Promise.all(configuration.contextPaths.map(async (uri) => [
      uri,
      await readProjectFile(directory, uri),
    ])),
  );
  let decisions: DecisionSource[];
  try {
    if (!originalDecisions || typeof originalDecisions !== "object" || Array.isArray(originalDecisions) ||
      !Object.entries(originalDecisions).every(
      ([uri, text]) => isProjectPath(uri) && typeof text === "string",
    )) {
      return unavailable(configuration, "Jev original decision evidence is invalid");
    }
    const uris = await glob("**/*.decision", {
      cwd: directory,
      ignore: [".git/**", ".premise/**", "node_modules/**"],
      nodir: true,
    });
    decisions = await Promise.all(uris.sort().map(async (uri) => {
      const content = await readProjectFile(directory, uri);
      return { uri, content, decision: parseDecision(content) };
    }));
  } catch {
    return unavailable(configuration, "Jev decision evidence could not be read safely");
  }
  const supersededIds = new Set(decisions.flatMap(({ decision }) =>
    decision.supersedes ? [decision.supersedes.id] : [],
  ));
  const activeDecisions = decisions.filter(({ decision }) => !supersededIds.has(decision.id));
  const key = process.env.TYPESAFE_AI_API_KEY;
  if (!key?.trim()) {
    return unavailable(configuration, "Jev review requires TYPESAFE_AI_API_KEY");
  }

  let response: JevResponse;
  try {
    const result = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      redirect: "error",
      body: JSON.stringify({
        model: configuration.model,
        state: { context, decisions, originalDecisions, activeDecisions, supersededIds: [...supersededIds] },
        questions: Object.fromEntries(Object.entries(configuration.questions).map(([id, question]) => [id, {
          type: "noul",
          instructions: question.instructions,
          criteria: question.criteria,
        }])),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) {
      return unavailable(configuration, `Jev review service returned HTTP ${result.status}`);
    }
    try {
      response = await result.json() as JevResponse;
    } catch {
      return unavailable(configuration, "Jev review returned invalid JSON or an unreadable response");
    }
  } catch {
    return unavailable(configuration, "Jev review request failed or timed out");
  }

  if (!response || typeof response !== "object" || Array.isArray(response) ||
    !hasOnlyKeys(response, ["model", "answers", "usage"]) ||
    !response.answers || typeof response.answers !== "object" || Array.isArray(response.answers) ||
    !Object.keys(response.answers).every((id) => Object.hasOwn(configuration.questions, id))) {
    return unavailable(configuration, "Jev review returned an invalid response");
  }
  if (response.model !== configuration.model) {
    return unavailable(configuration, "Jev review did not return the requested pinned model");
  }
  const answers = response.answers;
  return Object.entries(configuration.questions).map(([id, question]): AgentAdvisory => {
    const answer = Object.hasOwn(answers, id) ? answers[id] : undefined;
    if (!answer || typeof answer !== "object" || Array.isArray(answer) ||
      !hasOnlyKeys(answer, ["type", "noul"]) ||
      answer.type !== "noul" || !isProbability(answer.noul)) {
      return {
        id,
        status: "unavailable",
        message: "Jev review returned a missing or invalid answer",
        model: configuration.model,
      };
    }
    const probability = answer.noul;
    const status = probability >= configuration.thresholds.established
      ? "supported"
      : probability <= configuration.thresholds.failed ? "concern" : "uncertain";
    return {
      id,
      status,
      message: `${question.description}: advisory ${status}; probability=${probability}; model=${configuration.model}`,
      probability,
      model: configuration.model,
    };
  });
}

function unavailable(configuration: JevQuestions, message: string): AgentAdvisory[] {
  return Object.keys(configuration.questions).map((id) => ({
    id,
    status: "unavailable",
    message,
    model: configuration.model,
  }));
}

function readQuestions(raw: unknown, uri: string): JevQuestions {
  const value = raw as JevQuestions;
  const invalid = (message: string): never => {
    throw new Error(`Invalid Jev configuration ${uri}: ${message}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !hasOnlyKeys(value, ["version", "model", "thresholds", "contextPaths", "questions"])) {
    return invalid("expected only version, model, thresholds, contextPaths and questions");
  }
  if (value.version !== 1) {
    return invalid("version must be 1");
  }
  if (typeof value.model !== "string" || value.model.trim() !== value.model ||
    !/^jev-\d+\.\d+\.\d+$/.test(value.model)) {
    return invalid("model must be pinned as jev-N.N.N");
  }
  if (!value.thresholds || typeof value.thresholds !== "object" || Array.isArray(value.thresholds) ||
    !hasOnlyKeys(value.thresholds, ["established", "failed"]) ||
    !isProbability(value.thresholds.established) || !isProbability(value.thresholds.failed) ||
    value.thresholds.failed >= value.thresholds.established) {
    return invalid("thresholds must satisfy 0 <= failed < established <= 1");
  }
  if (!Array.isArray(value.contextPaths) || !value.contextPaths.every(isProjectPath) ||
    new Set(value.contextPaths).size !== value.contextPaths.length) {
    return invalid("contextPaths must contain unique project-relative file paths");
  }
  if (!value.questions || typeof value.questions !== "object" || Array.isArray(value.questions) ||
    Object.keys(value.questions).length === 0) {
    return invalid("questions must contain at least one question");
  }
  for (const [id, question] of Object.entries(value.questions)) {
    if (id.trim() !== id || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) ||
      ["constructor", "prototype", "__proto__"].includes(id)) {
      return invalid("question IDs must use letters, numbers, hyphens or underscores and must not be reserved object keys");
    }
    if (!question || typeof question !== "object" || Array.isArray(question) ||
      !hasOnlyKeys(question, ["description", "instructions", "criteria"]) ||
      !isNonemptyString(question.description) || !isNonemptyString(question.instructions) ||
      !question.criteria || typeof question.criteria !== "object" || Array.isArray(question.criteria) ||
      !hasOnlyKeys(question.criteria, ["true", "false"]) ||
      !isNonemptyString(question.criteria.true) || !isNonemptyString(question.criteria.false)) {
      return invalid(`question ${id} requires description, instructions and true/false criteria strings`);
    }
  }
  return value;
}

async function readProjectFile(directory: string, uri: string): Promise<string> {
  if (!isProjectPath(uri)) {
    throw new Error(`Invalid Jev path ${uri}: expected a project-relative file path`);
  }
  let path: string;
  try {
    path = await realpath(resolve(directory, uri));
  } catch {
    throw new Error(`Cannot resolve Jev file ${uri}`);
  }
  const relativePath = relative(directory, path);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Jev file ${uri} must stay inside the project`);
  }
  try {
    if (!(await stat(path)).isFile()) {
      throw new Error();
    }
    return await readFile(path, "utf8");
  } catch {
    throw new Error(`Cannot read Jev file ${uri} as a regular file`);
  }
}

function isProjectPath(value: unknown): value is string {
  return isNonemptyString(value) && value.trim() === value &&
    !isAbsolute(value) && !win32.isAbsolute(value) && !value.includes("\\") &&
    !value.includes("\0") && !value.split("/").includes("..");
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function hasOnlyKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
