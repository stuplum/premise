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
    hookEventName: "SessionStart" | "PreToolUse";
    additionalContext?: string;
    permissionDecision?: "deny";
    permissionDecisionReason?: string;
  };
};

export async function handleCodexHook(value: unknown, expectedEvent?: string): Promise<HookOutput> {
  const event = parseHookInput(value, expectedEvent);
  const input = {
    projectDirectory: await resolveAgentProject(event.cwd),
    sessionId: event.session_id,
  };
  if (event.hook_event_name === "SessionStart") {
    const report = await runAgentStart(input);
    const additionalContext = report.status === "inactive"
      ? renderAgentReport(report)
      : `${agentOrientation(input)}\n\n${renderAgentReport(report)}`;
    return {
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
      ...(report.status === "blocked" ? { systemMessage: renderAgentReport(report) } : {}),
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
        decision: "block",
        reason: `${feedback}\nThis is an advisory-only follow-up, not a failed check. Consider the advice in your response; unchanged findings will not request another follow-up.`,
      };
    }
    return report.advisories.length > 0 ? { systemMessage: feedback } : {};
  }
  const paths = toolArtifacts(event);
  if (paths.length === 0) {
    return {};
  }
  if (!await agentSessionEnabled(input)) {
    return {};
  }
  const contexts: string[] = [];
  for (const path of paths) {
    const artifact = await localArtifact({
      path,
      cwd: event.cwd,
      projectDirectory: input.projectDirectory,
    });
    if (!artifact) {
      continue;
    }
    const projection = await runAgentContext({ ...input, artifact });
    const rendered = renderArtifactContext(projection);
    if (rendered) {
      contexts.push(`Premise context for ${projection.artifact}:\n${rendered}`);
    }
  }
  return contexts.length > 0
    ? { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: contexts.join("\n") } }
    : {};
}

function parseHookInput(value: unknown, expectedEvent?: string): HookInput {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !("cwd" in value) || typeof value.cwd !== "string" || !isAbsolute(value.cwd) ||
    !("session_id" in value) || typeof value.session_id !== "string" || !value.session_id.trim() ||
    !("hook_event_name" in value) ||
    !["SessionStart", "Stop", "PreToolUse"].includes(String(value.hook_event_name)) ||
    (expectedEvent !== undefined && value.hook_event_name !== expectedEvent)) {
    throw new Error("Invalid Codex hook input: expected cwd, session_id, and a matching supported hook_event_name");
  }
  if (value.hook_event_name === "Stop" &&
    (!("stop_hook_active" in value) || typeof value.stop_hook_active !== "boolean")) {
    throw new Error("Invalid Codex Stop input: stop_hook_active must be a boolean");
  }
  if (value.hook_event_name === "PreToolUse" &&
    (!("tool_name" in value) || typeof value.tool_name !== "string" ||
      !("tool_input" in value) || typeof value.tool_input !== "object" ||
      value.tool_input === null || Array.isArray(value.tool_input))) {
    throw new Error("Invalid Codex PreToolUse input: expected tool_name and tool_input");
  }
  return value as HookInput;
}

function toolArtifacts(event: HookInput): string[] {
  const input = event.tool_input;
  if (!input) {
    return [];
  }
  if (event.tool_name === "apply_patch") {
    if (typeof input.command !== "string" || !input.command.startsWith("*** Begin Patch\n")) {
      throw new Error("Invalid Codex apply_patch input: expected a patch in tool_input.command");
    }
    return [...new Set(Array.from(
      input.command.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm),
      (match) => match[1].trimEnd(),
    ))];
  }
  return [];
}

async function readHookInput(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  const timer = setTimeout(() => process.stdin.destroy(new Error("Codex hook input timed out")), 5_000);
  try {
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.byteLength;
      if (length > 1024 * 1024) {
        throw new Error("Codex hook input exceeds 1 MiB");
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
    process.stdout.write(`${JSON.stringify(await handleCodexHook(await readHookInput(), expectedEvent))}\n`);
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
