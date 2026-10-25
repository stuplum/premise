import { spawn, type ChildProcess } from "node:child_process";
import type { CommandClassifier } from "../model.js";
import { isRecord } from "../text.js";
import {
  isProbability,
  unavailable,
  type ClassifierResult,
  type ClassifierRuntime,
  type SignoffPayload,
} from "./types.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;

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
    const child = spawn(file ?? "", args, {
      cwd: runtime.projectDirectory,
      env: runtime.env,
      stdio: ["pipe", "pipe", "ignore"],
      detached: process.platform !== "win32",
    });
    let output = "";
    let finished = false;
    const finish = ({ result, kill }: { result: ClassifierResult; kill: boolean }) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      if (kill) {
        killProcessGroup(child);
      }
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ result: unavailable(`timed out after ${runtime.timeoutMs} ms`), kill: true }),
      runtime.timeoutMs,
    );
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        finish({ result: unavailable(`output exceeds ${MAX_OUTPUT_BYTES} bytes`), kill: true });
      }
    });
    child.on("error", (error) => finish({ result: unavailable(`could not start: ${error.message}`), kill: false }));
    child.on("close", (code) =>
      finish({
        result: code === 0 ? readOutput({ output, model: classifier.model }) : unavailable(`exited with code ${code}`),
        kill: false,
      }),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ ...payload, model: classifier.model }));
  });
}

function killProcessGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined && process.platform !== "win32") {
      process.kill(-child.pid, "SIGKILL");
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
  child.stdout?.destroy();
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
