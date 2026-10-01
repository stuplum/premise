import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setImmediate as nextTurn, setTimeout as wait } from "node:timers/promises";
import premiseExtension from "../dist/adapters/omp.js";
import type { AgentReport } from "../src/agent-model.js";
import { createProject } from "./lifecycle-fixture.js";

type API = Parameters<typeof premiseExtension>[0];

function host(projectDirectory: string, t: TestContext) {
  const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
  let tool: Parameters<API["registerTool"]>[0] | undefined;
  const context = {
    cwd: projectDirectory,
    sessionManager: { getSessionId: () => "omp-lifecycle-regression" },
    ui: { notify() {} },
  };
  const api: API = {
    zod: { object: () => ({}), enum: () => ({}), string: () => ({ optional: () => ({}) }) },
    on(event, handler) {
      handlers.set(event, (payload) => handler(payload as never, context));
    },
    registerTool(definition) { tool = definition; },
  };
  premiseExtension(api);
  const emit = (event: string, payload: unknown = {}) => handlers.get(event)?.(payload);
  t.after(async () => { await emit("session_shutdown"); });
  return {
    emit,
    async check() {
      assert.ok(tool);
      return tool.execute("check", { action: "check" }, undefined, undefined, context);
    },
    async start() {
      await emit("session_start");
      await emit("before_agent_start");
      await emit("message_start", { message: { role: "user", content: "Check the repository" } });
    },
    stop: () => emit("session_stop", { stop_hook_active: false }) as Promise<{ decision?: string; reason?: string; continue?: boolean } | undefined>,
  };
}

async function blockedEvaluator(t: TestContext) {
  const project = await createProject({ t });
  const barrier = await mkdtemp(join(tmpdir(), "premise-evaluation-barrier-"));
  t.after(() => rm(barrier, { recursive: true, force: true }));
  const ready = join(barrier, "ready");
  const released = join(barrier, "released");
  await project.write({
    path: "features/step_definitions/query.steps.ts",
    content: [
      'import assert from "node:assert/strict";',
      'import { access, writeFile } from "node:fs/promises";',
      'import { setTimeout as wait } from "node:timers/promises";',
      'import { Then } from "@stuplum/premise/cucumber";',
      'import { queryProducts } from "../../src/catalog.ts";',
      'Then("the query returns every product", { timeout: 15000 }, async () => {',
      '  assert.deepEqual(queryProducts().map(product => product.name).sort(), ["Apple", "Pear"]);',
      `  await writeFile(${JSON.stringify(ready)}, "ready");`,
      `  while (!(await access(${JSON.stringify(released)}).then(() => true, () => false))) await wait(25);`,
      '});',
      '',
    ].join("\n"),
  });
  return {
    project,
    async ready() {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await readFile(ready).then(() => true, () => false)) return;
        await wait(25);
      }
      throw new Error("The real evaluator did not reach its barrier");
    },
    release: () => writeFile(released, "continue"),
  };
}

test("hidden hook preparation does not cancel an in-flight real completion evaluation", async (t) => {
  const evaluator = await blockedEvaluator(t);
  const runtime = host(evaluator.project.projectDirectory, t);
  await runtime.start();
  const stopping = runtime.stop();
  await evaluator.ready();
  await runtime.emit("before_agent_start");
  await runtime.emit("message_start", { message: { role: "custom", customType: "session-stop-continuation", attribution: "agent" } });
  await evaluator.release();
  assert.equal(await stopping, undefined);
});

test("a genuine new user turn cancels an older in-flight completion evaluation", async (t) => {
  const evaluator = await blockedEvaluator(t);
  const runtime = host(evaluator.project.projectDirectory, t);
  await runtime.start();
  const stopping = runtime.stop();
  await evaluator.ready();
  await runtime.emit("message_start", { message: { role: "user", content: "Change the requirement first" } });
  await evaluator.release();
  assert.equal((await stopping)?.decision, "block");
});

test("an implementation edit during evaluation cannot reuse the old passing result", async (t) => {
  const evaluator = await blockedEvaluator(t);
  const runtime = host(evaluator.project.projectDirectory, t);
  await runtime.start();
  const stopping = runtime.stop();
  await evaluator.ready();
  await evaluator.project.write({ path: "src/catalog.ts", content: "export function queryProducts() { return []; }\n" });
  await evaluator.release();
  assert.equal((await stopping)?.decision, "block");
  const latest = await runtime.stop();
  assert.equal(latest?.decision, "block");
  assert.match(latest?.reason ?? "", /QUERY-001/);
});

test("an inactive OMP project is not blocked by unrelated dangling filesystem entries", async (t) => {
  const project = await createProject({ t, configured: false });
  await symlink("missing-target", join(project.projectDirectory, "unrelated-link"));
  const runtime = host(project.projectDirectory, t);
  await runtime.start();
  assert.equal(await runtime.stop(), undefined);
});

test("explicit checks return current advice without scheduling repeated automatic follow-ups", async (t) => {
  const key = process.env.TYPESAFE_AI_API_KEY;
  delete process.env.TYPESAFE_AI_API_KEY;
  t.after(() => {
    if (key === undefined) delete process.env.TYPESAFE_AI_API_KEY;
    else process.env.TYPESAFE_AI_API_KEY = key;
  });
  const project = await createProject({ t });
  await project.enableJev({ unavailable: true });
  const runtime = host(project.projectDirectory, t);
  await runtime.start();
  assert.equal((await runtime.stop())?.continue, true);

  const checked = await runtime.check();
  const report = checked.details as AgentReport;
  assert.deepEqual(report.advisories.map(({ id, status }) => ({ id, status })), [
    { id: "REVIEW-001", status: "unavailable" },
  ]);
  assert.equal(await runtime.stop(), undefined);
});

test("OMP completion accepts changing ignored Cucumber reports but still blocks implementation failures", async (t) => {
  const project = await createProject({ t });
  await project.write({ path: "cucumber.cjs", content: "module.exports = { default: { format: ['json:report.json'] } };\n" });
  await project.write({ path: ".gitignore", content: "report.json\n" });
  project.agent({ action: "start" });
  assert.equal(project.agent({ action: "stop" }).status, "passed");
  const previousReport = JSON.parse(await project.read("report.json"));
  previousReport[0].elements[0].steps[0].result.duration = Number.MAX_SAFE_INTEGER;
  await project.write({ path: "report.json", content: JSON.stringify(previousReport) });

  const runtime = host(project.projectDirectory, t);
  await runtime.start();
  const completed = await runtime.stop();
  const generatedReport = JSON.parse(await project.read("report.json"));
  assert.equal(generatedReport[0].elements[0].steps[0].result.status, "passed");
  assert.notEqual(generatedReport[0].elements[0].steps[0].result.duration, Number.MAX_SAFE_INTEGER);
  assert.equal(completed, undefined);

  await runtime.emit("message_start", { message: { role: "user", content: "Remove the products" } });
  await project.write({ path: "src/catalog.ts", content: "export function queryProducts() { return []; }\n" });
  const failed = await runtime.stop();
  assert.equal(failed?.decision, "block");
  assert.match(failed?.reason ?? "", /QUERY-001/);
});

test("OMP completion retains settled slow verification across bounded waits without accepting later mutations", async (t) => {
  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  type FingerprintGate = {
    release: () => void;
    released: Promise<void>;
    finish: () => void;
    finished: Promise<void>;
  };
  function fingerprintGate(): FingerprintGate {
    const released = deferred<void>();
    const finished = deferred<void>();
    return {
      release: released.resolve,
      released: released.promise,
      finish: finished.resolve,
      finished: finished.promise,
    };
  }

  for (const mutateAfterVerification of [false, true]) {
    const evaluator = await blockedEvaluator(t);
    const projectDirectory = await fs.realpath(evaluator.project.projectDirectory);
    const runtime = host(evaluator.project.projectDirectory, t);
    await runtime.start();
    const originalSetTimeout = globalThis.setTimeout;
    const originalLstat = fs.lstat;
    let expireStopWait: (() => void) | undefined;
    const clock = t.mock.method(globalThis, "setTimeout", ((
      callback: (...arguments_: unknown[]) => void,
      delay?: number,
      ...arguments_: unknown[]
    ) => {
      const timer = originalSetTimeout(callback, delay, ...arguments_);
      if (delay === 20_000) {
        expireStopWait = () => {
          clearTimeout(timer);
          callback(...arguments_);
        };
      }
      return timer;
    }) as typeof setTimeout);
    const gates = new Set<FingerprintGate>();
    let nextFingerprint = deferred<FingerprintGate>();
    let activeFingerprint: FingerprintGate | undefined;
    let restoreLstat: (() => void) | undefined;
    const deadline = deferred<never>();
    const watchdog = originalSetTimeout(() => deadline.reject(new Error("The completion regression did not reach its next filesystem boundary")), 30_000);

    function withinDeadline<T>(operation: Promise<T>) {
      return Promise.race([operation, deadline.promise]);
    }

    async function takeFingerprint() {
      const fingerprint = await withinDeadline(nextFingerprint.promise);
      nextFingerprint = deferred<FingerprintGate>();
      return fingerprint;
    }

    try {
      const evaluating = runtime.stop();
      await withinDeadline(evaluator.ready());
      assert.ok(expireStopWait);
      expireStopWait();
      assert.equal((await withinDeadline(evaluating))?.decision, "block");

      const delayedLstat = t.mock.method(fs, "lstat", (async (...arguments_: Parameters<typeof fs.lstat>) => {
        if (arguments_[0] !== projectDirectory || !arguments_[1]?.bigint) {
          return originalLstat(...arguments_);
        }
        if (!activeFingerprint) {
          const fingerprint = fingerprintGate();
          activeFingerprint = fingerprint;
          gates.add(fingerprint);
          nextFingerprint.resolve(fingerprint);
          await fingerprint.released;
          return originalLstat(...arguments_);
        }
        const fingerprint = activeFingerprint;
        activeFingerprint = undefined;
        try {
          return await originalLstat(...arguments_);
        } finally {
          void nextTurn().then(fingerprint.finish);
        }
      }) as typeof fs.lstat);
      restoreLstat = () => {
        delayedLstat.mock.restore();
        syncBuiltinESMExports();
      };
      syncBuiltinESMExports();
      await evaluator.release();
      const evaluatedFingerprint = await takeFingerprint();
      evaluatedFingerprint.release();
      await withinDeadline(evaluatedFingerprint.finished);

      const verifying = runtime.stop();
      const verification = await takeFingerprint();
      expireStopWait();
      assert.equal((await withinDeadline(verifying))?.decision, "block");
      verification.release();
      await withinDeadline(verification.finished);

      if (mutateAfterVerification) {
        restoreLstat();
        restoreLstat = undefined;
        await evaluator.project.write({ path: "src/catalog.ts", content: "export function queryProducts() { return []; }\n" });
        assert.equal((await withinDeadline(runtime.stop()))?.decision, "block");
        const failed = await withinDeadline(runtime.stop());
        assert.equal(failed?.decision, "block");
        assert.match(failed?.reason ?? "", /QUERY-001/);
      } else {
        const retry = runtime.stop();
        const result = await withinDeadline(Promise.race([
          retry.then((completion) => ({ completion })),
          nextFingerprint.promise.then(() => ({ waiting: true })),
        ]));
        if ("waiting" in result) expireStopWait();
        assert.equal(await withinDeadline(retry), undefined);
      }
    } finally {
      clearTimeout(watchdog);
      for (const gate of gates) gate.release();
      restoreLstat?.();
      clock.mock.restore();
      await evaluator.release();
      await runtime.emit("session_shutdown");
    }
  }
});
