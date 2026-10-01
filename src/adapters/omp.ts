import { runAgentStart } from "../agent-lifecycle.js";
import type { AgentReport, AgentSessionInput } from "../agent-model.js";
import { agentSessionEnabled, resolveAgentProject } from "../agent-project.js";
import {
  adapterError,
  agentOrientation,
  localArtifact,
  renderAgentReport,
} from "../agent-feedback.js";
import type { ArtifactContextProjection } from "../context-projection.js";
import { renderArtifactContext } from "../context-renderer.js";
import type { RepositoryVerification } from "../repository-snapshot.js";
import { evaluateOmpCheck, runOmpCommand, type OmpCheckedReport } from "./omp-check.js";

type ExtensionContext = {
  cwd: string;
  sessionManager: { getSessionId(): string };
  ui: { notify(message: string, type: "info" | "warning" | "error"): void };
};
type TextContent = { type: "text"; text: string };
type ToolContent = TextContent | { type: "image"; data: string; mimeType: string };
type ToolResult = { content: ToolContent[]; details?: unknown; isError?: boolean };
type StopResult = { decision: "block"; reason: string } | { continue: true; additionalContext: string } | undefined;
type PremiseToolInput = { action: "context" | "check" | "review"; artifact?: string; decision?: string };
type ExtensionAPI = {
  zod: {
    string(): { optional(): unknown };
    enum(values: ["context", "check", "review"]): unknown;
    object(shape: Record<string, unknown>): unknown;
  };
  on(event: "session_start" | "session_switch" | "session_branch" | "session_tree" | "session_shutdown", handler: (event: unknown, ctx: ExtensionContext) => Promise<void>): void;
  on(event: "before_agent_start", handler: (event: unknown, ctx: ExtensionContext) => Promise<{ message: { customType: string; content: string; display: boolean } }>): void;
  on(event: "message_start", handler: (event: { message: { role: string; customType?: string; attribution?: string } }, ctx: ExtensionContext) => Promise<void>): void;
  on(event: "tool_result", handler: (event: { toolName: string; input: Record<string, unknown>; content: ToolContent[]; isError: boolean }, ctx: ExtensionContext) => Promise<{ content: ToolContent[] } | undefined>): void;
  on(event: "session_stop", handler: (event: { stop_hook_active: boolean; signal?: AbortSignal }, ctx: ExtensionContext) => Promise<StopResult>): void;
  registerTool(definition: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    loadMode: "essential";
    execute(id: string, params: PremiseToolInput, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext): Promise<ToolResult>;
  }): void;
};
type PendingCheck = {
  controller: AbortController;
  result: Promise<OmpCheckedReport>;
  finished: boolean;
  verification?: Promise<RepositoryVerification>;
  verified?: RepositoryVerification;
};
type Session = {
  input: AgentSessionInput;
  started: Promise<AgentReport>;
  work: Promise<void>;
  operations: Set<AbortController>;
  pending?: PendingCheck;
  turn: number;
  adviceDelivered: boolean;
};

export default function premiseExtension(omp: ExtensionAPI): void {
  const sessions = new Map<string, Session>();
  let disposed = false;

  async function sessionFor(ctx: ExtensionContext, start: boolean): Promise<Session> {
    if (disposed) {
      throw new Error("The Premise extension has shut down");
    }
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) {
      throw new Error("OMP did not supply a stable session id");
    }
    const projectDirectory = await resolveAgentProject(ctx.cwd);
    if (disposed) {
      throw new Error("The Premise extension has shut down");
    }
    let session = sessions.get(sessionId);
    if (session && session.input.projectDirectory !== projectDirectory) {
      throw new Error("OMP changed this session's project directory; start a new session for the new project");
    }
    if (!session) {
      if (!start) {
        throw new Error("The Premise session snapshot was not started before work");
      }
      const input = { projectDirectory, sessionId };
      session = { input, started: runAgentStart(input), work: Promise.resolve(), operations: new Set(), turn: 0, adviceDelivered: false };
      sessions.set(sessionId, session);
    }
    return session;
  }

  function schedule<T>(session: Session, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted || disposed) {
      abort();
    }
    session.operations.add(controller);
    const result = session.work.then(async () => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    }).finally(() => {
      signal?.removeEventListener("abort", abort);
      session.operations.delete(controller);
    });
    session.work = result.then(() => undefined, () => undefined);
    return { controller, result };
  }

  function pendingCheck(session: Session, signal?: AbortSignal): PendingCheck {
    if (!session.pending) {
      const pending: PendingCheck = {
        ...schedule(session, (operationSignal) => evaluateOmpCheck(session.input, operationSignal), signal),
        finished: false,
      };
      void pending.result.then(() => { pending.finished = true; }, () => { pending.finished = true; });
      session.pending = pending;
    }
    return session.pending;
  }

  function disposePending(pending: PendingCheck, abort: boolean): void {
    pending.verified?.dispose();
    void pending.verification?.then((verification) => verification.dispose(), () => undefined);
    if (abort) {
      pending.controller.abort();
    }
  }

  function clearPending(session: Session, pending: PendingCheck, abort: boolean): void {
    if (session.pending === pending) {
      session.pending = undefined;
    }
    disposePending(pending, abort);
  }

  async function currentReport(session: Session, pending: PendingCheck) {
    const awaitingEvaluation = !pending.finished;
    const checked = await pending.result;
    if (session.pending !== pending || disposed) {
      throw new Error("The Premise completion check belongs to an interrupted turn; retry completion");
    }
    if (checked.report.status === "inactive") {
      return { session, pending, report: checked.report, current: !await agentSessionEnabled(session.input) };
    }
    let current = awaitingEvaluation && checked.fingerprint !== undefined;
    if (!awaitingEvaluation && checked.fingerprint && checked.snapshot) {
      pending.verification ??= checked.snapshot
        .verify(pending.controller.signal)
        .then((verification) => {
          pending.verified = verification;
          return verification;
        });
      const verification = await pending.verification;
      current =
        verification.fingerprint === checked.fingerprint &&
        (await verification.current(pending.controller.signal));
    }
    if (session.pending !== pending || disposed) {
      throw new Error("The Premise completion check belongs to an interrupted turn; retry completion");
    }
    return { session, pending, report: checked.report, current };
  }

  function changedTree(session: Session, pending: PendingCheck, signal?: AbortSignal): string {
    if (session.pending === pending) {
      clearPending(session, pending, true);
      pendingCheck(session, signal);
    }
    return "Premise: blocked. Repository content changed during or after evaluation. A fresh check is running for the current tree; wait for it and retry completion without changing files.";
  }

  for (const event of ["session_start", "session_switch", "session_branch", "session_tree"] as const) {
    omp.on(event, async (_event, ctx) => {
      try {
        const report = await (await sessionFor(ctx, true)).started;
        if (report.status === "blocked") {
          ctx.ui.notify(renderAgentReport(report), "warning");
        }
      } catch (error) {
        ctx.ui.notify(adapterError(error), "error");
      }
    });
  }

  omp.on("session_shutdown", async () => {
    disposed = true;
    const pendingVerifications: Promise<unknown>[] = [];
    for (const session of sessions.values()) {
      if (session.pending) {
        if (session.pending.verification) {
          pendingVerifications.push(
            session.pending.verification.catch(() => undefined),
          );
        }
        disposePending(session.pending, true);
      }
      for (const controller of session.operations) {
        controller.abort();
      }
    }
    await Promise.all([
      ...[...sessions.values()].map((session) => session.work),
      ...pendingVerifications,
    ]);
    sessions.clear();
  });

  omp.on("message_start", async ({ message }, ctx) => {
    const startsUserTurn = message.role === "user" ||
      (message.role === "custom" && message.attribution === "user" &&
        ["skill-prompt", "collab-prompt"].includes(message.customType ?? ""));
    if (!startsUserTurn) {
      return;
    }
    const previous = sessions.get(ctx.sessionManager.getSessionId());
    if (previous) {
      previous.turn++;
      previous.adviceDelivered = false;
      if (previous.pending) {
        disposePending(previous.pending, true);
      }
      previous.pending = undefined;
      for (const controller of previous.operations) {
        controller.abort();
      }
    }
  });

  omp.on("before_agent_start", async (_event, ctx) => {
    let content: string;
    try {
      const session = await sessionFor(ctx, true);
      const report = await session.started;
      content = report.status === "inactive"
        ? renderAgentReport(report)
        : [
          agentOrientation(session.input),
          'Use the native premise tool: {action:"context",artifact:"src/file.ts"}, {action:"check"}, or {action:"review",decision:"DECISION-ID"}. Review records your deliberate reassessment; it does not repair failing executable requirements.',
          "Read/write file results automatically include related context. Directory reads, URLs, shell commands, and edits without a structured path require explicit premise context access.",
          renderAgentReport(report),
        ].join("\n\n");
    } catch (error) {
      content = adapterError(error);
    }
    return { message: { customType: "premise.orientation", content, display: false } };
  });

  omp.registerTool({
    name: "premise",
    label: "Premise",
    description: "Inspect an artifact's executable premises and architecture decisions, run a fresh completion check, or deliberately record a decision review. Jev is advice only; review cannot clear executable failures or changed history.",
    parameters: omp.zod.object({
      action: omp.zod.enum(["context", "check", "review"]),
      artifact: omp.zod.string().optional(),
      decision: omp.zod.string().optional(),
    }),
    loadMode: "essential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      let pending: PendingCheck | undefined;
      let session: Session | undefined;
      const abort = () => pending?.controller.abort();
      try {
        signal?.throwIfAborted();
        session = await sessionFor(ctx, true);
        await session.started;
        const input = session.input;
        if (params.action === "context") {
          if (!params.artifact?.trim()) {
            throw new Error("The context action requires artifact");
          }
          const arguments_ = ["agent", "context", params.artifact, "--session", input.sessionId];
          const output = await schedule(session, (operationSignal) => runOmpCommand(input, arguments_, operationSignal), signal).result;
          const projection: ArtifactContextProjection = JSON.parse(output);
          return {
            content: [{ type: "text", text: renderArtifactContext(projection) || `No Premise context for ${projection.artifact}` }],
            details: projection,
          };
        }
        if (params.action === "review") {
          if (!params.decision?.trim()) {
            throw new Error("The review action requires decision");
          }
          const arguments_ = ["review", params.decision];
          await schedule(session, (operationSignal) => runOmpCommand(input, arguments_, operationSignal), signal).result;
          return { content: [{ type: "text", text: `Recorded review of ${params.decision}. Completion still requires a fresh passing Premise check.` }] };
        }
        if (params.action !== "check") {
          throw new Error("Unknown Premise action");
        }
        pending = pendingCheck(session, signal);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
        }
        const checked = await currentReport(session, pending);
        if (!checked.current) {
          return { content: [{ type: "text", text: changedTree(session, pending, signal) }], isError: true };
        }
        clearPending(session, pending, false);
        const report = checked.report;
        session.adviceDelivered ||= report.advisories.length > 0;
        return { content: [{ type: "text", text: renderAgentReport(report) }], details: report };
      } catch (error) {
        if (session && pending && session.pending === pending) {
          clearPending(session, pending, true);
        }
        return { content: [{ type: "text", text: adapterError(error) }], isError: true };
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  });

  omp.on("tool_result", async (event, ctx) => {
    if (event.isError || !["read", "write", "edit"].includes(event.toolName) || typeof event.input.path !== "string") {
      return;
    }
    try {
      const session = await sessionFor(ctx, false);
      const report = await session.started;
      if (report.status === "inactive") {
        return;
      }
      const artifact = await localArtifact({
        path: event.input.path,
        cwd: ctx.cwd,
        projectDirectory: session.input.projectDirectory,
        readSelector: event.toolName === "read",
      });
      if (!artifact) {
        return;
      }
      const arguments_ = ["agent", "context", artifact, "--session", session.input.sessionId];
      const output = await schedule(session, (signal) => runOmpCommand(session.input, arguments_, signal)).result;
      const projection: ArtifactContextProjection = JSON.parse(output);
      const text = renderArtifactContext(projection);
      if (text) {
        return { content: [...event.content, { type: "text", text: `Premise context for ${projection.artifact}:\n${text}` }] };
      }
    } catch (error) {
      return { content: [...event.content, { type: "text", text: adapterError(error) }] };
    }
  });

  omp.on("session_stop", async (event, ctx) => {
    let session: Session | undefined;
    let pending: PendingCheck | undefined;
    let timer: NodeJS.Timeout | undefined;
    let interrupted = false;
    let abortWait: (() => void) | undefined;
    const turn = sessions.get(ctx.sessionManager.getSessionId())?.turn;
    const bounded = new Promise<{ blocked: string }>((resolve) => {
      timer = setTimeout(() => resolve({ blocked: "Premise: blocked. The repository check is still running. Wait and retry completion; the same evaluation will continue in the background. Do not claim verification yet." }), 20_000);
      abortWait = () => {
        interrupted = true;
        pending?.controller.abort();
        resolve({ blocked: "Premise: blocked. The completion check was interrupted; retry completion to run a fresh check." });
      };
      event.signal?.addEventListener("abort", abortWait, { once: true });
      if (event.signal?.aborted) {
        abortWait();
      }
    });
    const checking = (async () => {
      session = await sessionFor(ctx, false);
      await session.started;
      if (interrupted || session.turn !== turn || disposed) {
        throw new Error("Premise completion was interrupted before evaluation started");
      }
      pending = pendingCheck(session, event.signal);
      return currentReport(session, pending);
    })().catch((error: unknown) => {
      if (session && pending && session.pending === pending) {
        clearPending(session, pending, true);
      }
      return { blocked: adapterError(error) };
    });
    try {
      const result = await Promise.race([checking, bounded]);
      if ("blocked" in result) {
        return { decision: "block", reason: result.blocked };
      }
      if (!result.current) {
        return { decision: "block", reason: changedTree(result.session, result.pending, event.signal) };
      }
      clearPending(result.session, result.pending, false);
      const report = result.report;
      const feedback = renderAgentReport(report);
      const advisoryFollowUp = report.advisories.length > 0 && !result.session.adviceDelivered;
      result.session.adviceDelivered ||= report.advisories.length > 0;
      if (report.status === "blocked") {
        return { decision: "block", reason: feedback };
      }
      if (advisoryFollowUp) {
        return { continue: true, additionalContext: `${feedback}\nThis follow-up only delivers advice. Consider it in your response; model approval is not required.` };
      }
    } finally {
      clearTimeout(timer);
      if (abortWait) {
        event.signal?.removeEventListener("abort", abortWait);
      }
    }
  });
}
