import type { ClassifierConfig } from "../model.js";
import { classifyWithCommand } from "./command.js";
import { classifyWithJev } from "./jev.js";
import type { ClassifierResult, ClassifierRuntime, SignoffPayload } from "./types.js";

export function classify({
  payload,
  classifier,
  runtime,
}: {
  payload: SignoffPayload;
  classifier: ClassifierConfig;
  runtime: ClassifierRuntime;
}): Promise<ClassifierResult> {
  return classifier.adapter === "jev"
    ? classifyWithJev({ payload, classifier, runtime })
    : classifyWithCommand({ payload, classifier, runtime });
}
