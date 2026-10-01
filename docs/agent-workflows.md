# Agent workflows

Enable Premise's session-start context and completion checks in OMP, Codex or Claude Code. If the repository does not yet have executable premises, begin with [getting started](getting-started.md). For the underlying JSON commands, see the [agent protocol reference](reference.md#agent-protocol). All guides are listed in the [documentation index](README.md).

## Opt in and start a session

Install Premise as a project development dependency, then create `premise.json` in the project root:

```json
{
  "version": 1
}
```

The ordinary CLI can use its default discovery paths without this file. The agent lifecycle gate requires the explicit opt-in.

The adapters were exercised with OMP `18.3.2`, Codex `0.155.0`, and Claude Code `2.1.283` on macOS. Node.js 20+ must be available as `node` on `PATH`, including when OMP itself runs on Bun. The bundled Codex and Claude Code command hooks target POSIX shells.

1. Follow the [OMP](#omp), [Codex](#codex) or [Claude Code](#claude-code) setup below, then launch your agent from the project root with the integration loaded and its hooks enabled and trusted. The session-start hook automatically snapshots existing `.decision` files in `.premise/agent-sessions/` before you make changes. You do not need to run a separate capture command or choose a session ID.
2. Inspect relevant premises and decisions while editing.
3. Attempt completion. Premise evaluates the current repository automatically.
4. Repair failed or unknown executable premises and reconsider stale decisions.
5. Explicitly run `premise review DECISION-ID` if the existing choice remains justified. Otherwise preserve the original record, add a new decision with `Supersedes DECISION-ID`, and review the replacement. See [architecture decisions](decisions.md).

A review does not override an executable failure. Records captured at session start cannot be rewritten or removed during that session. Decisions added later are included in the next session's snapshot.

## Completion and freshness

Completion checks fingerprint repository inputs before evaluation and after decision checks and Jev advice. A passing evaluation is rejected if those inputs changed while the check was running.

Fingerprints include file contents, modes and symlink referents. They exclude `.git`, `node_modules`, Premise's generated agent state and configured Cucumber report outputs. Reports are still generated; output paths that overlap executable inputs block completion, including symlink aliases. Fingerprints are not atomic filesystem snapshots and do not freeze external services or installed dependency contents. Large trees incur full scans; filesystem errors block rather than count as successful verification.

**These adapters enforce a workflow, not a security boundary.** Trust the repository and hook code: Cucumber steps and dependency-cruiser configurations execute local code. Disabled or modified hooks, operator interruption, host runtime limits and tampered session state can bypass the workflow. Subagents do not receive an independent completion guarantee.

## OMP

From the project root, load the installed extension:

```sh
omp --extension ./node_modules/@stuplum/premise/dist/adapters/omp.js
```

The extension provides a native `premise` tool:

```json
{ "action": "context", "artifact": "src/catalog.ts" }
```

```json
{ "action": "check" }
```

```json
{ "action": "review", "decision": "QUERY-010" }
```

Structured file reads and writes receive related context automatically. Directory reads, URLs, shell commands and edits without a structured file path need an explicit context request. The completion check runs regardless of whether the agent used that tool.

Slow checks continue across bounded stop-hook waits instead of exceeding OMP's handler deadline. Completed verification is retained for the next retry, with filesystem watching and metadata checks rejecting later mutations before the result is consumed. In-flight work survives hidden hook continuations, but a genuine new user turn cancels it.

## Codex

Keep the project-local Premise installation available. Codex copies plugins into its cache; the bundled dependency-free launcher resolves and runs the project's installed Premise rather than relying on npm dependencies being copied with the plugin.

Add the installed package to a local marketplace in `.agents/plugins/marketplace.json`:

```json
{
  "name": "premise-local",
  "plugins": [
    {
      "name": "premise",
      "source": {
        "source": "local",
        "path": "./node_modules/@stuplum/premise"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

From that project root:

```sh
codex plugin marketplace add .
codex plugin add premise@premise-local
codex
```

Review and trust the installed hooks before starting work. Do not routinely bypass hook trust. See the [Codex hook documentation](https://learn.chatgpt.com/docs/hooks) for the host's review and execution policy.

The plugin supplies session orientation, adds context before structured `apply_patch` edits and performs a fresh check on every stop. All files in one patch receive context from a single executable evaluation. If a valid patch cannot obtain context because repository configuration is broken, it receives a warning rather than a denial, allowing configuration repairs; completion remains blocked until the configuration is repaired. The plugin does not infer artifact paths from arbitrary shell commands. Mechanical blockers continue to block on subsequent stop attempts; advice can request at most one extra response per genuine turn.

The launcher fails closed after 550 seconds, before the bundled host hook's 600-second deadline. `PREMISE_CODEX_TIMEOUT_MS` may lower that budget to a positive integer no greater than `550000`. An exhausted budget is not successful verification. Do not lower the host timeout below the launcher's budget; longer-running suites require a different hook policy or the OMP integration.

## Claude Code

From the project root, load the installed plugin for the session:

```sh
claude --plugin-dir "$PWD/node_modules/@stuplum/premise"
```

Review and trust the package's hooks before use. The Claude manifest explicitly loads `hooks/claude.json`; the Codex manifest separately loads `hooks/codex.json`. There is no shared default `hooks/hooks.json`, which Claude would also load. Keep the project-local Premise installation available when loading a cached plugin: the dependency-free launcher resolves that installation rather than relying on npm dependencies in the cache.

`SessionStart` supplies orientation and preserves the original snapshot on resume or compaction. `PreToolUse` supplies related context for `Read`, `Edit` and `Write` using their structured `file_path`. Shell commands and `@` file references need an explicit `premise agent context` request. Context does not grant tool permission. If a valid file operation cannot obtain context because repository configuration is broken, it receives a warning so configuration can still be repaired.

The launcher and hooks use Claude's `CLAUDE_PROJECT_DIR` to retain the original project when the working directory changes. Relative artifact paths still resolve from the event's working directory. Start a new Claude session to switch projects.

`Stop` reruns executable checks and blocks mechanical failures, stale reviews, changed decision history and configuration errors. It does not bypass checks when `stop_hook_active` is true. Jev advice uses a non-error follow-up rather than a failed-check response, with unchanged findings deduplicated across attempts and turns.

**Claude's continuation limit is not successful verification.** With the default limit in Claude Code `2.1.283`, eight consecutive stop-hook continuations are allowed; Claude overrides the ninth block and ends the turn even if Premise still fails. Premise does not change `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` or circumvent this host limit. Resolve the reported blockers and run another check before claiming completion. Operator interruption and API failures also fall outside the normal `Stop` path. See the [Claude hook reference](https://code.claude.com/docs/en/hooks#stop).

The launcher fails closed after 550 seconds, before the bundled hook's 600-second deadline, and terminates its evaluation process group. `PREMISE_CLAUDE_TIMEOUT_MS` may lower that budget to a positive integer no greater than `550000`. A timeout is not successful verification. Do not lower the host timeout below the launcher's budget.

## Optional Jev advice

Jev supplies advisory feedback about decisions. It does not establish an executable premise, record a human review or override a mechanical blocker.

Add a questions file to `premise.json`:

```json
{
  "version": 1,
  "jev": {
    "questions": "questions.json"
  }
}
```

For example, create `questions.json` with context paths that exist in your repository:

```json
{
  "version": 1,
  "model": "jev-1.13.0",
  "thresholds": {
    "established": 0.8,
    "failed": 0.2
  },
  "contextPaths": [
    "src/catalog.ts",
    "features/query.feature"
  ],
  "questions": {
    "REVIEW-001": {
      "description": "The query decision remains justified",
      "instructions": "Does the active query decision remain justified by the supplied requirements and implementation?",
      "criteria": {
        "true": "The choice is compatible with the requirements and implementation.",
        "false": "The choice conflicts with the requirements or implementation."
      }
    }
  }
}
```

Set `TYPESAFE_AI_API_KEY` in the agent's environment. Enabling Jev sends the selected files, current decisions and session-start decision contents to `https://api.typesafe.ai/v1/systemone`. Select that context deliberately and do not include secrets. Decision content is sent in addition to the files selected by `contextPaths`.

Question and context paths must resolve to regular files inside the project, including after symlink resolution. The model must be pinned as `jev-N.N.N`. Requests have a 10-second timeout and reject redirects; the response must identify the requested model. See the [configuration reference](reference.md) for the complete schema.

Results are `supported`, `concern`, `uncertain` or `unavailable`. Missing credentials, transport failures, timeouts and unusable responses are unavailable advice, not mechanical failures. Invalid local question configuration or unreadable configured context must be repaired. No configured Jev review means no network request.

## Session state and adapter protocol

Ignore generated session and feedback state, but keep decision review receipts:

```gitignore
.premise/agent-sessions/
.premise/agent-feedback/
```

Do not delete an active session's snapshot to reset decision history. Starting the same session again does not replace that snapshot. Keep `.premise/reviews/` in version control.

Adapters use these JSON commands:

```sh
premise agent start --session SESSION-ID
premise agent context src/catalog.ts --session SESSION-ID
premise agent stop --session SESSION-ID
```

These are protocol commands for adapter authors or manual diagnosis, not extra setup steps for an installed integration. A processed report exits zero even when its JSON `status` is `blocked`; consumers must inspect the report. Command/protocol errors exit non-zero. The ordinary `premise check` retains its non-zero failure behaviour for CI.

For report fields and the distinction between mechanical blockers and advice, see the [agent protocol reference](reference.md#agent-protocol).

## Troubleshooting

- **No automatic check:** launch from the project root with `premise.json`, the integration loaded and hooks enabled and trusted. Ensure Node.js 20+ is available as `node` on the hook's `PATH`.
- **Cached plugin cannot start:** retain the project's local Premise installation; the launcher does not depend on npm packages in the host plugin cache.
- **Context warning during an edit:** repair the reported repository configuration. The warning permits repair, but does not waive the completion check.
- **Changed inputs or overlapping report outputs:** stop concurrent repository mutations or move generated reports away from executable inputs, then run another check. Do not disable the freshness guard to obtain a pass.
- **Timeout or Claude continuation cap:** completion has not been verified. Resolve the blocker and check again; a host ending the turn is not evidence that Premise passed.
- **Unavailable Jev advice:** check credentials, network access and the pinned model. Invalid local configuration still needs repair; unavailable external advice does not replace mechanical checks.
