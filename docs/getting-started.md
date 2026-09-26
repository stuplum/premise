# Getting started

Premise adds executable repository knowledge and reviewed architecture decisions to an existing project.

It currently includes providers for:

* Gherkin through Cucumber;
* forbidden architecture dependencies through dependency-cruiser.

Architecture decisions use Premise's `.decision` format and a separate human review lifecycle.

## Requirements

Premise requires Node.js 20 or newer.

## Installation

### pnpm

```sh
pnpm add --save-dev @stuplum/premise
```

### npm

```sh
npm install --save-dev @stuplum/premise
```

### yarn

```sh
yarn add --dev @stuplum/premise
```

### bun

```sh
bun add --dev @stuplum/premise
```

The `premise` CLI is installed into the project's normal package binary directory.

For example:

```sh
pnpm premise check
```

or from a package script:

```json
{
  "scripts": {
    "premise": "premise check"
  }
}
```

## Agent-assisted onboarding

The recommended way to introduce Premise to an existing repository is the shipped onboarding workflow.

Give a coding agent:

```text
Onboard this repository to Premise.

Read and follow:

node_modules/@stuplum/premise/prompts/onboard.md

Begin with discovery only. Do not modify the repository until you have
shown me the proposed adoption scope and I have explicitly approved it.
```

The workflow deliberately separates:

```text
discovery
    ↓
human approval
    ↓
adoption
    ↓
independent audit
```

Discovery should identify a small number of consequential repository claims rather than attempt to model the entire codebase.

After adoption, run `prompts/audit.md` with a fresh agent.

## Manual setup

The ordinary CLI does not require a configuration file for its default layout. Agent lifecycle enforcement requires an explicit `premise.json`.

### Gherkin

Default feature path:

```text
features/**/*.feature
```

Default step definition path:

```text
features/step_definitions/**/*.ts
```

See [Cucumber provider](providers/cucumber.md).

### Architecture constraints

Premise automatically looks for the first available dependency-cruiser configuration named:

```text
.dependency-cruiser.js
.dependency-cruiser.cjs
.dependency-cruiser.mjs
.dependency-cruiser.json
```

See [dependency-cruiser provider](providers/dependency-cruiser.md).

### Decisions

Premise discovers:

```text
**/*.decision
```

It ignores decisions under:

```text
.git/
.premise/
node_modules/
```

See [Architecture decisions](decisions.md).

## Configuration

Create `premise.json` in the repository root when the default Cucumber paths do not fit the project.

For example:

```json
{
  "version": 1,
  "cucumber": {
    "features": [
      "specifications/**/*.feature"
    ],
    "steps": [
      "specifications/support/**/*.ts"
    ]
  }
}
```

Both `features` and `steps` accept one or more glob patterns.

Configuration supports Cucumber discovery and optional Jev advice. Its presence also opts the repository into the agent lifecycle gate.

## Agent lifecycle integration

Install Premise as a development dependency, then create `premise.json` in the project root:

```json
{
  "version": 1
}
```

The adapters were exercised with OMP `18.3.2`, Codex `0.155.0`, and Claude Code `2.1.283` on macOS. Node.js 20+ must be available as `node` on `PATH`, including when OMP itself runs on Bun. The bundled Codex and Claude Code command hooks target POSIX shells.

The workflow is:

1. Follow the [OMP](#omp), [Codex](#codex), or [Claude Code](#claude-code) setup below, then launch your agent from the project root with the Premise integration loaded and its hooks enabled and trusted. Its session-start hook automatically snapshots the existing `.decision` files in `.premise/agent-sessions/` before you make changes. You do not need to run a separate capture command or choose a session ID.
2. Inspect relevant premises and decisions while editing.
3. Attempt completion. Premise evaluates the current repository automatically.
4. Repair failed or unknown executable premises and reconsider stale decisions.
5. Explicitly run `premise review DECISION-ID` if the existing choice remains justified. Otherwise preserve the original record, add a new decision with `Supersedes DECISION-ID`, and review the replacement.

A review does not override an executable failure. Records captured at session start cannot be rewritten or removed during that session. Decisions added later are included in the next session's snapshot.

The adapters are workflow enforcement, not a security boundary. Trust the repository and hook code: Cucumber steps and dependency-cruiser configurations execute local code. Disabled or modified hooks, operator interruption, host runtime limits, and tampered session state can bypass the workflow. Subagents do not receive an independent completion guarantee.

### OMP

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

Structured file reads and writes receive related context automatically. Directory reads, URLs, shell commands, and edits without a structured file path need an explicit context request. The completion check runs regardless of whether the agent used that tool.

Slow checks continue across bounded stop-hook waits instead of exceeding OMP's handler deadline. Repository fingerprints guard against edits made during evaluation or before consuming a completed result. In-flight work survives hidden hook continuations, but a genuine new user turn cancels it.

Fingerprints include file contents, modes, and symlink referents, excluding `.git`, `node_modules`, and Premise's generated agent state. They are not atomic filesystem snapshots and do not freeze external services or installed dependency contents. Large trees incur full scans; filesystem errors block rather than count as successful verification.

### Codex

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

The plugin supplies session orientation, adds context before structured `apply_patch` edits, and performs a fresh check on every stop. It does not infer artifact paths from arbitrary shell commands. Mechanical blockers continue to block on subsequent stop attempts; advice can request at most one extra response per genuine turn.

The launcher fails closed after 550 seconds, before the bundled host hook's 600-second deadline. `PREMISE_CODEX_TIMEOUT_MS` may lower that budget to a positive integer no greater than `550000`. An exhausted budget is not successful verification. Do not lower the host timeout below the launcher's budget; longer-running suites require a different hook policy or the OMP integration.

### Claude Code

From the project root, load the installed plugin for the session:

```sh
claude --plugin-dir "$PWD/node_modules/@stuplum/premise"
```

Review and trust the package's hooks before use. The Claude manifest explicitly loads `hooks/claude.json`; the Codex manifest separately loads `hooks/codex.json`. There is no shared default `hooks/hooks.json`, which Claude would also load. Keep the project-local Premise installation available when loading a cached plugin: the dependency-free launcher resolves that installation rather than relying on npm dependencies in the cache.

`SessionStart` supplies orientation and preserves the original snapshot on resume or compaction. `PreToolUse` supplies related context for `Read`, `Edit`, and `Write` using their structured `file_path`. Shell commands and `@` file references need an explicit `premise agent context` request. Context does not grant tool permission. If a valid file operation cannot obtain context because repository configuration is broken, it receives a warning so configuration can still be repaired.

`Stop` reruns executable checks and blocks mechanical failures, stale reviews, changed decision history, and configuration errors. It does not bypass checks when `stop_hook_active` is true. Jev advice uses a non-error follow-up rather than a failed-check response, with unchanged findings deduplicated across attempts and turns.

**Claude's continuation limit is not successful verification.** With the default limit in Claude Code `2.1.283`, eight consecutive stop-hook continuations are allowed; Claude overrides the ninth block and ends the turn even if Premise still fails. Premise does not change `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` or circumvent this host limit. Resolve the reported blockers and run another check before claiming completion. Operator interruption and API failures also fall outside the normal `Stop` path. See the [Claude hook reference](https://code.claude.com/docs/en/hooks#stop).

The launcher fails closed after 550 seconds, before the bundled hook's 600-second deadline, and terminates its evaluation process group. `PREMISE_CLAUDE_TIMEOUT_MS` may lower that budget to a positive integer no greater than `550000`. A timeout is not successful verification. Do not lower the host timeout below the launcher's budget.

### Optional Jev advice

Add a questions file to `premise.json`:

```json
{
  "version": 1,
  "jev": {
    "questions": "questions.json"
  }
}
```

For example, `questions.json`:

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

Set `TYPESAFE_AI_API_KEY` in the agent's environment. Enabling Jev sends the selected files, current decisions, and session-start decision contents to `https://api.typesafe.ai/v1/systemone`. Select that context deliberately and do not include secrets.

Results are `supported`, `concern`, `uncertain`, or `unavailable`. Missing credentials, transport failures, timeouts, and unusable responses are unavailable advice, not mechanical failures. Invalid local question configuration or unreadable configured context must be repaired. No configured Jev review means no network request.

### Session state and adapter protocol

Ignore generated session and feedback state, but keep decision review receipts:

```gitignore
.premise/agent-sessions/
.premise/agent-feedback/
```

Do not delete an active session's snapshot to reset decision history. Starting the same session again does not replace that snapshot.

Adapters use these JSON commands:

```sh
premise agent start --session SESSION-ID
premise agent context src/catalog.ts --session SESSION-ID
premise agent stop --session SESSION-ID
```

A processed report exits zero even when its JSON `status` is `blocked`; consumers must inspect the report. Command/protocol errors exit non-zero. The ordinary `premise check` retains its existing non-zero failure behaviour for CI.

## Running Premise

### Check repository knowledge

```sh
premise check
```

`premise check`:

1. discovers executable Premises;
2. evaluates each through its provider;
3. derives the current state of decisions from their reviews and drivers;
4. exits non-zero if an executable Premise is `failed` or `unknown`;
5. exits non-zero if an active decision requires reconsideration.

A provider can report:

* `established` — the executable assertion was evaluated and held;
* `failed` — it was evaluated and found false;
* `unknown` — a trustworthy evaluation could not be obtained.

A changed assertion that continues to pass remains established. Premise does not use source fingerprints as a substitute for evaluating executable Premises.

### Run executable Premises

```sh
premise test
```

This evaluates the configured executable providers with normal test output enabled.

The command fails if:

* no executable Premises are discovered;
* any Premise fails;
* any Premise is unknown.

Unlike `premise check`, `premise test` does not perform the decision review check.

### Retrieve context

```sh
premise context src/domain/order.ts
```

Premise evaluates the current repository and projects knowledge relevant to the supplied artifact.

Context may include:

* relevant executable Premises;
* provider and dialect;
* current evaluation state;
* assertion source;
* related reviewed decisions;
* reasons a related decision requires reconsideration.

Context is derived at runtime. Premise does not require a committed artifact-to-Premise index.

If no relevant knowledge is found:

```text
No context for src/domain/order.ts
```

### Review a decision

```sh
premise review ARCH-001
```

This records that the current decision has been reviewed against the current versions of its declared drivers.

Use this only after actually reconsidering the decision.

See [Architecture decisions](decisions.md).

## Add Premise to normal verification

Premise is intended to run alongside the repository's existing verification rather than replace it.

For example:

```json
{
  "scripts": {
    "verify": "premise check && npm test"
  }
}
```

Or with pnpm:

```json
{
  "scripts": {
    "verify": "premise check && pnpm test"
  }
}
```

Run the same verification command in CI.

This means repository changes cannot silently leave:

* executable Premises failing;
* executable Premises unevaluable;
* active decisions stale against their declared drivers.

## Repository artifacts

Premise uses authoritative repository sources rather than generating a second knowledge database.

Typical committed artifacts are:

```text
*.feature
*.decision
.dependency-cruiser.*
premise.json
.premise/reviews/
```

`.premise/reviews/` is different from executable Premise state.

Decision review receipts contain fingerprints because they record exactly which source versions a human reviewed.

Executable Premises are not established by fingerprints. Their providers must evaluate the underlying claim.

## Recommended first adoption

Keep the first adoption small.

A useful first pass usually contains:

* a few important existing behavioural guarantees;
* one or two meaningful architecture boundaries;
* existing architectural decisions with genuine rationale.

Avoid creating Premises for implementation details merely because they are mechanically testable.

For every proposed Premise, ask:

> If the implementation changed so that this claim became false, without changing the assertion itself, would its evaluator notice?

If not, it is not providing useful executable validation.

## Next

* [Architecture decisions](decisions.md)
* [Cucumber provider](providers/cucumber.md)
* [dependency-cruiser provider](providers/dependency-cruiser.md)
* [Product model](design/product-model.md)

