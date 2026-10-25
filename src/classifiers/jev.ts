import type { JevClassifier } from "../model.js";
import { errorMessage, isRecord } from "../text.js";
import {
  SIGNOFF_QUESTION,
  isProbability,
  unavailable,
  type ClassifierResult,
  type ClassifierRuntime,
  type SignoffPayload,
} from "./types.js";

const instructions = `${SIGNOFF_QUESTION} Judge only from state.decision and the before and after text of each entry in state.changes.`;
const criteriaTrue = "The changed checks still assert what the decision's reasons rely on.";
const criteriaFalse = "The changed checks no longer assert, or now contradict, what the decision's reasons rely on.";

export async function classifyWithJev({
  payload,
  classifier,
  runtime,
}: {
  payload: SignoffPayload;
  classifier: JevClassifier;
  runtime: ClassifierRuntime;
}): Promise<ClassifierResult> {
  const key = runtime.env.TYPESAFE_AI_API_KEY?.trim();
  if (!key) {
    return unavailable("TYPESAFE_AI_API_KEY is not set");
  }
  let response: Response;
  try {
    response = await fetch(runtime.jevEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      redirect: "error",
      body: JSON.stringify({
        model: classifier.model,
        state: payload,
        questions: { supports: { type: "noul", instructions, criteria: { true: criteriaTrue, false: criteriaFalse } } },
      }),
      signal: AbortSignal.timeout(runtime.timeoutMs),
    });
  } catch (error) {
    return unavailable(`request failed: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    return unavailable(`HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return unavailable("response is not JSON");
  }
  return readAnswer({ body, model: classifier.model });
}

function readAnswer({ body, model }: { body: unknown; model: string }): ClassifierResult {
  if (!isRecord(body) || body.model !== model) {
    return unavailable(`response did not come from model ${model}`);
  }
  const answer = isRecord(body.answers) ? body.answers.supports : undefined;
  if (!isRecord(answer) || answer.type !== "noul" || !isProbability(answer.noul)) {
    return unavailable("response has no probability between 0 and 1");
  }
  return { status: "answered", probability: answer.noul };
}
