import { spawn } from "node:child_process";
import type { CommandClassifier } from "../model.js";
import { isRecord } from "../text.js";
import {
  isProbability,
  unavailable,
  type ClassifierResult,
  type ClassifierRuntime,
  type SignoffPayload,
} from "./types.js";

export function classifyWithCommand({
  payload,
  classifier,
  runtime,
}: {
  payload: SignoffPayload;
  classifier: CommandClassifier;
  runtime: ClassifierRuntime;
}): Promise<ClassifierResult> {
  return new Promise((resolve) => {
    const [file, ...args] = classifier.command;
    const child = spawn(file ?? "", args, { cwd: runtime.projectDirectory, env: runtime.env, stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(unavailable(`timed out after ${runtime.timeoutMs} ms`));
    }, runtime.timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(unavailable(`could not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? readOutput({ output, model: classifier.model }) : unavailable(`exited with code ${code}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ ...payload, model: classifier.model }));
  });
}

function readOutput({ output, model }: { output: string; model: string }): ClassifierResult {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return unavailable("output is not JSON");
  }
  if (!isRecord(value) || value.model !== model) {
    return unavailable(`output did not come from model ${model}`);
  }
  if (!isProbability(value.probability)) {
    return unavailable("output has no probability between 0 and 1");
  }
  return { status: "answered", probability: value.probability };
}
