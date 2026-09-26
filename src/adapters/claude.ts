#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { runAgentContext, runAgentStart, runAgentStop } from "../agent-lifecycle.js";
import { agentSessionEnabled, resolveAgentProject } from "../agent-project.js";
import {
  adapterError,
  agentOrientation,
  claimAdvisoryFeedback,
  localArtifact,
  renderAgentReport,
} from "../agent-feedback.js";
import { renderArtifactContext } from "../context-renderer.js";

type HookEventName = "SessionStart" | "Stop" | "PreToolUse";
type HookInput = {
  cwd: string;
  session_id: string;
  hook_event_name: HookEventName;
  stop_hook_active?: boolean;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

type HookOutput = {
  decision?: "block";
  reason?: string;
  continue?: false;
  stopReason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: HookEventName;
    additionalContext?: string;
    permissionDecision?: "deny";
    permissionDecisionReason?: string;
  };
};

export async function handleClaudeHook(value: unknown, expectedEvent?: string): Promise<HookOutput> {
  const event = parseHookInput(value, expectedEvent);
  const input = {
    projectDirectory: await resolveAgentProject(event.cwd),
    sessionId: event.session_id,
  };
  if (event.hook_event_name === "SessionStart") {
    const report = await runAgentStart(input);
    if (report.status === "inactive") {
      return {};
    }
    const feedback = renderAgentReport(report);
    const additionalContext = [
      agentOrientation(input),
      "Claude Code 2.1.283 caps consecutive Stop-hook continuations at eight. Reaching that host cap can end a turn with unresolved blockers; it is not a successful Premise check. Do not change global settings or circumvent the cap.",
      feedback,
    ].join("\n\n");
    return {
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
      ...(report.status === "blocked" ? { systemMessage: feedback } : {}),
    };
  }
  if (event.hook_event_name === "Stop") {
    const report = await runAgentStop(input);
    const feedback = renderAgentReport(report);
    const advisoryFollowUp = await claimAdvisoryFeedback({
      input,
      advisories: report.advisories,
      canContinue: !event.stop_hook_active,
      alreadyDelivered: report.status === "blocked",
    });
    if (report.status === "blocked") {
      return { decision: "block", reason: feedback };
    }
    if (advisoryFollowUp) {
      return {
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: `${feedback}\nThis is an advisory-only follow-up, not a failed check. Consider the advice in your response; unchanged findings will not request another follow-up.`,
        },
      };
    }
    return report.advisories.length > 0 ? { systemMessage: feedback } : {};
  }
  const path = toolArtifact(event);
  if (!path || !await agentSessionEnabled(input)) {
    return {};
  }
  const artifact = await localArtifact({
    path,
    cwd: event.cwd,
    projectDirectory: input.projectDirectory,
  });
  if (!artifact) {
    return {};
  }
  try {
    const projection = await runAgentContext({ ...input, artifact });
    const rendered = renderArtifactContext(projection);
    return rendered
      ? {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: `Premise context for ${projection.artifact}:\n${rendered}`,
        },
      }
      : {};
  } catch (error) {
    return {
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: adapterError(error) },
    };
  }
}

function parseHookInput(value: unknown, expectedEvent?: string): HookInput {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !("cwd" in value) || typeof value.cwd !== "string" || !isAbsolute(value.cwd) ||
    !("session_id" in value) || typeof value.session_id !== "string" || !value.session_id.trim() ||
    !("hook_event_name" in value) || typeof value.hook_event_name !== "string" ||
    !["SessionStart", "Stop", "PreToolUse"].includes(value.hook_event_name) ||
    (expectedEvent !== undefined && value.hook_event_name !== expectedEvent)) {
    throw new Error("Invalid Claude hook input: expected cwd, session_id, and a matching supported hook_event_name");
  }
  if (value.hook_event_name === "Stop" &&
    (!("stop_hook_active" in value) || typeof value.stop_hook_active !== "boolean")) {
    throw new Error("Invalid Claude Stop input: stop_hook_active must be a boolean");
  }
  if (value.hook_event_name === "PreToolUse" &&
    (!("tool_name" in value) || typeof value.tool_name !== "string" || !value.tool_name.trim() ||
      !("tool_input" in value) || typeof value.tool_input !== "object" ||
      value.tool_input === null || Array.isArray(value.tool_input))) {
    throw new Error("Invalid Claude PreToolUse input: expected tool_name and tool_input");
  }
  return value as HookInput;
}

function toolArtifact(event: HookInput): string | undefined {
  if (!["Read", "Edit", "Write"].includes(event.tool_name ?? "")) {
    return undefined;
  }
  const path = event.tool_input?.file_path;
  if (typeof path !== "string" || !path.trim() || path.includes("\0")) {
    throw new Error(`Invalid Claude ${event.tool_name} input: expected tool_input.file_path`);
  }
  return path;
}

async function readHookInput(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  const timer = setTimeout(() => process.stdin.destroy(new Error("Claude hook input timed out")), 5_000);
  try {
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.byteLength;
      if (length > 1024 * 1024) {
        throw new Error("Claude hook input exceeds 1 MiB");
      }
      chunks.push(bytes);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timer);
  }
}

const entryPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => undefined) : undefined;
if (entryPath && entryPath === await realpath(fileURLToPath(import.meta.url))) {
  const expectedEvent = process.argv[2];
  try {
    process.stdout.write(`${JSON.stringify(await handleClaudeHook(await readHookInput(), expectedEvent))}\n`);
  } catch (error) {
    const reason = adapterError(error);
    const output: HookOutput = expectedEvent === "SessionStart"
      ? { continue: false, stopReason: reason, systemMessage: reason }
      : expectedEvent === "PreToolUse"
        ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }
        : { decision: "block", reason };
    process.stderr.write(`${reason}\n`);
    process.stdout.write(`${JSON.stringify(output)}\n`);
    if (!["SessionStart", "Stop", "PreToolUse"].includes(expectedEvent ?? "")) {
      process.exitCode = 2;
    }
  }
}
