import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { classifyWithCommand } from "../src/classifiers/command.js";
import { classifyWithJev } from "../src/classifiers/jev.js";
import { JEV_ENDPOINT, type ClassifierResult } from "../src/classifiers/types.js";
import { createPayload, judgeScript } from "./support/fixtures.js";
import { createProject } from "./support/project.js";

const thresholds = { established: 0.8, failed: 0.2 };
const commandClassifier = { adapter: "command" as const, command: ["node", "judge.mjs"], model: "judge-1", thresholds };
const jevClassifier = { adapter: "jev" as const, model: "jev-1.13.0", thresholds };
const liveKey = process.env.TYPESAFE_AI_API_KEY;
const skipLive = liveKey ? false : "TYPESAFE_AI_API_KEY is not set";

async function judge({ t, respond, timeoutMs = 10_000 }: { t: TestContext; respond: string; timeoutMs?: number }) {
  const projectDirectory = await createProject({ t, files: { "judge.mjs": judgeScript({ respond }) } });
  const payload = createPayload();
  const result = await classifyWithCommand({
    payload,
    classifier: commandClassifier,
    runtime: { projectDirectory, env: process.env, timeoutMs, jevEndpoint: JEV_ENDPOINT },
  });
  return { projectDirectory, payload, result };
}

function assertUnavailable({ result, pattern }: { result: ClassifierResult; pattern: RegExp }) {
  assert.equal(result.status, "unavailable");
  assert.match(result.status === "unavailable" ? result.reason : "", pattern);
}

test("a command classifier receives the payload and model and returns its probability", async (t) => {
  const { projectDirectory, payload, result } = await judge({
    t,
    respond: "process.stdout.write(JSON.stringify({ model, probability: 0.93 }));",
  });

  assert.deepEqual(result, { status: "answered", probability: 0.93 });
  assert.deepEqual(JSON.parse(await readFile(join(projectDirectory, "received.json"), "utf8")), { ...payload, model: "judge-1" });
});

test("a command classifier reporting another model is unavailable", async (t) => {
  const { result } = await judge({ t, respond: 'process.stdout.write(JSON.stringify({ model: "other", probability: 0.93 }));' });

  assertUnavailable({ result, pattern: /did not come from model judge-1/ });
});

test("malformed or out-of-range command output is unavailable", async (t) => {
  const malformed = await judge({ t, respond: 'process.stdout.write("not json");' });
  const outOfRange = await judge({ t, respond: "process.stdout.write(JSON.stringify({ model, probability: 1.5 }));" });

  assertUnavailable({ result: malformed.result, pattern: /output is not JSON/ });
  assertUnavailable({ result: outOfRange.result, pattern: /no probability between 0 and 1/ });
});

test("a command that exits non-zero is unavailable", async (t) => {
  const { result } = await judge({ t, respond: "process.exit(3);" });

  assertUnavailable({ result, pattern: /exited with code 3/ });
});

test("a command that runs past the timeout is unavailable", async (t) => {
  const { result } = await judge({
    t,
    respond: "setTimeout(() => process.stdout.write(JSON.stringify({ model, probability: 0.93 })), 2000);",
    timeoutMs: 200,
  });

  assertUnavailable({ result, pattern: /timed out after 200 ms/ });
});

async function exits(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(20);
  }
  return false;
}

test("a timeout also stops processes the command started", { skip: process.platform === "win32" && "POSIX process groups" }, async (t) => {
  const projectDirectory = await createProject({ t, files: {} });

  const result = await classifyWithCommand({
    payload: createPayload(),
    classifier: { ...commandClassifier, command: ["sh", "-c", "sleep 30 & echo $! > grandchild.pid; wait"] },
    runtime: { projectDirectory, env: process.env, timeoutMs: 300, jevEndpoint: JEV_ENDPOINT },
  });
  const grandchild = Number(await readFile(join(projectDirectory, "grandchild.pid"), "utf8"));

  assertUnavailable({ result, pattern: /timed out after 300 ms/ });
  assert.equal(await exits(grandchild), true);
});

test("output larger than 1 MiB is unavailable", async (t) => {
  const { result } = await judge({ t, respond: 'process.stdout.write("x".repeat(2 * 1024 * 1024));' });

  assertUnavailable({ result, pattern: /output exceeds 1048576 bytes/ });
});

test("a command that cannot start is unavailable", async (t) => {
  const projectDirectory = await createProject({ t, files: {} });

  const result = await classifyWithCommand({
    payload: createPayload(),
    classifier: { ...commandClassifier, command: ["./no-such-judge"] },
    runtime: { projectDirectory, env: process.env, timeoutMs: 10_000, jevEndpoint: JEV_ENDPOINT },
  });

  assertUnavailable({ result, pattern: /could not start/ });
});

test("jev without a key is unavailable without a request", async (t) => {
  const projectDirectory = await createProject({ t, files: {} });

  const result = await classifyWithJev({
    payload: createPayload(),
    classifier: jevClassifier,
    runtime: { projectDirectory, env: {}, timeoutMs: 10_000, jevEndpoint: "http://127.0.0.1:9/" },
  });

  assertUnavailable({ result, pattern: /TYPESAFE_AI_API_KEY is not set/ });
});

test("jev at an unreachable endpoint is unavailable", async (t) => {
  const projectDirectory = await createProject({ t, files: {} });

  const result = await classifyWithJev({
    payload: createPayload(),
    classifier: jevClassifier,
    runtime: { projectDirectory, env: { TYPESAFE_AI_API_KEY: "x" }, timeoutMs: 2_000, jevEndpoint: "http://127.0.0.1:9/" },
  });

  assertUnavailable({ result, pattern: /request failed/ });
});

test("jev rejects an invalid key", { skip: skipLive }, async (t) => {
  const projectDirectory = await createProject({ t, files: {} });

  const result = await classifyWithJev({
    payload: createPayload(),
    classifier: jevClassifier,
    runtime: { projectDirectory, env: { TYPESAFE_AI_API_KEY: "invalid" }, timeoutMs: 10_000, jevEndpoint: JEV_ENDPOINT },
  });

  assertUnavailable({ result, pattern: /HTTP 40[13]/ });
});

test("jev answers with a probability from the pinned model", { skip: skipLive }, async (t) => {
  const projectDirectory = await createProject({ t, files: {} });

  const result = await classifyWithJev({
    payload: createPayload(),
    classifier: jevClassifier,
    runtime: { projectDirectory, env: { TYPESAFE_AI_API_KEY: liveKey ?? "" }, timeoutMs: 10_000, jevEndpoint: JEV_ENDPOINT },
  });

  assert.equal(result.status, "answered");
  assert.ok(result.status === "answered" && result.probability >= 0 && result.probability <= 1);
});
