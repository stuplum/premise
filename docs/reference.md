# CLI and configuration reference

The installed `premise` command evaluates executable repository knowledge, projects artifact context and records decision reviews. The bundled providers are [Cucumber](providers/cucumber.md) and [dependency-cruiser](providers/dependency-cruiser.md).

For installation and first adoption, use [Getting started](getting-started.md). For host installation, hook trust and the Jev walkthrough, use [Agent workflows](agent-workflows.md). See the [documentation index](README.md) for other guides and references.

## Commands

Run commands from the project root. The CLI uses its current working directory as the project directory; it does not search parent directories for configuration. Arguments must appear in the order shown.

| Command | Purpose | Successful processing and failure behaviour |
| --- | --- | --- |
| `premise check` | Evaluate executable premises and active decision review state | Exits `1` for any `failed` or `unknown` premise, any decision requiring reconsideration, or a command error; otherwise `0` |
| `premise test` | Evaluate executable premises with normal Cucumber output | Exits `1` if none are discovered, any is `failed` or `unknown`, or a command error occurs; otherwise `0` |
| `premise context <artifact>` | Evaluate the repository and render knowledge related to one artifact | Exits `0` when context is returned, including failed or stale knowledge or no matching knowledge; command errors exit `1` |
| `premise review <decision-id>` | Record a review of an active decision against current driver sources | Exits `0` after writing the receipt; command errors exit `1` |
| `premise agent start --session <id>` | Create or reuse a session-start decision snapshot and return orientation | Writes an agent report as JSON; inspect its `status`, not just the exit code |
| `premise agent context <artifact> --session <id>` | Return artifact context as JSON for an existing session | Writes a context projection, not an agent report; errors exit `1` |
| `premise agent stop --session <id>` | Evaluate completion against current knowledge and session history | Writes an agent report as JSON; inspect its `status`, not just the exit code |

These are the public CLI commands. There are no general flags, `--help`, `--version`, provider-selection flags or configuration-path flags. `check` and `test` accept no arguments. `context` and `review` accept exactly one positional argument. Agent commands require exactly the arguments shown, including `--session`.

Uncaught command errors print a message to standard error and set exit code `1`. These include missing or unknown commands, invalid argument shapes and configuration errors not converted into a processed agent report. There is no separate CLI exit-code taxonomy for failed assertions versus usage errors.

### `check`

`check` evaluates both bundled providers with Cucumber console output suppressed. It prints failed or unknown premises and decisions requiring reconsideration to standard output. Decision output includes the reasons, current driver sources, current decision source and instructions to review or supersede the decision.

A changed assertion that still passes remains established. Source fingerprints do not replace executable evaluation.

An empty repository can pass `check`: unlike `test`, it does not require an executable premise, and unlike `agent stop`, it does not reject an opted-in repository containing neither premises nor decisions. A successful `check` is not a session-history or Jev review.

### `test`

`test` runs the executable providers without the decision review check. Normal Cucumber output is enabled. If no executable premises are discovered, it prints `No executable requirements matched` to standard error and exits `1`. Unknown-result reasons also go to standard error.

### `context`

`context` evaluates the current repository, then projects provider evidence and related active decisions for the supplied artifact. The path must resolve inside the project, including existing symbolic links; a path need not already exist. The project directory itself is not an artifact.

Relationships are derived at runtime, not from a committed artifact-to-premise index. Executable evidence can identify exercised modules, rule subjects and violating dependencies. Decisions can relate through source drivers or through related premises and decisions.

If nothing relates to the artifact, the CLI prints `No context for <artifact>` using the supplied argument. Failed premises or decisions requiring reconsideration can appear in context without making this command exit non-zero. Use `check` for CI enforcement.

### `review`

`review` discovers the current decision and premise sources, resolves the decision's drivers and writes `.premise/reviews/<encoded-decision-id>.json`. It rejects unknown or superseded decisions. It does not execute the premises or prove that the architectural choice is correct.

Run it only after reconsidering the decision. A receipt records source fingerprints for the decision and its drivers; it cannot clear failed or unknown executable evidence. Commit review receipts. See [Architecture decisions](decisions.md) for the format, review lifecycle and additive supersession.

## Knowledge states

| Kind | State | Meaning |
| --- | --- | --- |
| Executable premise | `established` | Its provider evaluated the assertion successfully |
| Executable premise | `failed` | Evaluation did not establish the assertion; diagnostics explain the failure |
| Executable premise | `unknown` | A trustworthy evaluation could not be obtained; a reason is supplied |
| Active decision | `established` | Its current review and supporting knowledge do not require reconsideration |
| Active decision | `reconsider` | Its review is stale or supporting knowledge requires attention; reasons are supplied |

Decision establishment is a review state, not mechanical proof of a human judgement. These knowledge states are separate from agent report statuses, Jev advisory statuses and process exit codes.

## `premise.json`

The CLI reads `premise.json` from the project directory. Without that file, ordinary commands use the default configuration, equivalent to `{ "version": 1 }`. The agent gate requires the file's explicit presence. Removing it after a session starts does not disable that session's gate.

The file must be a JSON object with the following fields only:

| Field | Type and constraints | Default or effect |
| --- | --- | --- |
| `version` | Required number, exactly `1` | Configuration format version |
| `cucumber` | Optional object containing only `features` and `steps` | Uses default Cucumber discovery if omitted |
| `cucumber.features` | Optional non-empty array of non-empty strings | `["features/**/*.feature"]` |
| `cucumber.steps` | Optional non-empty array of non-empty strings | `["features/step_definitions/**/*.ts"]` |
| `jev` | Optional object containing only required `questions` | No Jev advice or request if omitted |
| `jev.questions` | String containing at least one non-whitespace character | Path to the separately validated Jev questions file |

Cucumber path arrays contain glob patterns evaluated from the project directory. Either path list can be omitted independently; an empty `cucumber` object is valid. Empty arrays are not valid. Unknown keys at any of these levels are rejected, as are `null` values in place of the documented objects or lists. Malformed JSON or an invalid schema produces `Invalid Premise configuration: premise.json`.

There is no `dependencyCruiser` field. The bundled dependency-cruiser provider discovers the first available configuration in this order:

1. `.dependency-cruiser.js`
2. `.dependency-cruiser.cjs`
3. `.dependency-cruiser.mjs`
4. `.dependency-cruiser.json`

It analyses `src`. Native dependency-cruiser options may constrain that analysis; `premise.json` cannot change its source paths or configuration filenames. No matching configuration means no architecture premises from this provider. See the [provider reference](providers/dependency-cruiser.md).

Decision discovery uses `**/*.decision`, ignoring `.git/**`, `.premise/**` and `node_modules/**`. It has no `premise.json` path override.

## Jev questions configuration

Jev is optional advice used by the agent completion check, not an executable provider. Ordinary `check`, `test`, `context` and `review` do not request Jev advice. The questions file named by `jev.questions` has no implicit model or threshold defaults.

| Field | Required value |
| --- | --- |
| `version` | Number `1` |
| `model` | Pinned string matching `^jev-\d+\.\d+\.\d+$`, without surrounding whitespace |
| `thresholds` | Object containing only `established` and `failed`, both finite numbers satisfying `0 <= failed < established <= 1` |
| `contextPaths` | Array of unique project-relative file paths; an empty array is allowed |
| `questions` | Object containing at least one question, keyed by question ID |

Each question contains only these required fields:

| Field | Required value |
| --- | --- |
| `description` | String containing non-whitespace text |
| `instructions` | String containing non-whitespace text |
| `criteria` | Object containing only `true` and `false`, both strings containing non-whitespace text |

Question IDs match `^[A-Za-z0-9][A-Za-z0-9_-]*$`. The names `constructor`, `prototype` and `__proto__` are rejected. Unknown keys are rejected at the questions-file, threshold, question and criteria levels.

The questions-file path and every context path must be project-relative regular files. Paths cannot contain backslashes, NUL characters, a `..` segment or surrounding whitespace, and cannot be absolute POSIX or Windows paths. Symbolic links must still resolve inside the project. Invalid local questions configuration or unreadable configured context blocks completion rather than becoming unavailable advice.

With Jev configured and `TYPESAFE_AI_API_KEY` available, Premise sends selected file contents, current decisions and session-start decision contents to `https://api.typesafe.ai/v1/systemone`. Select context deliberately and exclude secrets. The request has a 10-second timeout and rejects redirects. Without configured Jev advice there is no request.

| Advisory status | Meaning |
| --- | --- |
| `supported` | Returned probability is at least `thresholds.established` |
| `concern` | Returned probability is at most `thresholds.failed` |
| `uncertain` | Returned probability is between the thresholds |
| `unavailable` | Advice could not be obtained, for example because credentials are missing, the request failed or timed out, or the response is unusable |

The response must identify the requested pinned model. Missing or invalid answers are unavailable advice. Advisory results never change mechanical premise states or turn an otherwise passing agent report into `blocked`. Hosts may request an additional response to advice under their own continuation policy. See [Agent workflows](agent-workflows.md) for that policy and a complete configuration example.

## Agent protocol

The CLI protocol is intended for adapters. Bundled hosts create session IDs and run lifecycle commands automatically; normal users do not need a manual capture step.

```text
premise agent start --session <id>
premise agent context <artifact> --session <id>
premise agent stop --session <id>
```

A session ID must contain non-whitespace text and cannot start with `--`. Quote IDs or artifact paths containing shell metacharacters or spaces. Reuse the same ID for the same session and project.

### Start and stop reports

`start` and `stop` write one JSON report followed by a newline to standard output. A processed report exits `0`, including a report with `status: "blocked"`. Consumers must parse `status`. A command/protocol error that prevents a report exits `1` and writes its message to standard error.

| Field | Shape |
| --- | --- |
| `status` | `ready`, `passed`, `blocked` or `inactive` |
| `blockers` | Array of mechanical or local-configuration blockers; empty when none |
| `advisories` | Array of optional Jev results; empty when none |
| `instructions` | Optional orientation text, supplied by `start` |

| Status | Returned by | Meaning |
| --- | --- | --- |
| `ready` | `start` | Session snapshot and configuration are usable; this is not a completed executable check |
| `passed` | `stop` | Completion evaluation produced no blockers |
| `blocked` | `start` or `stop` | At least one blocker requires repair |
| `inactive` | `start` or `stop` | No `premise.json` and no existing session snapshot were found; no verification claim is made |

Each blocker contains required `kind` and `message`, with optional `id`, `state` and `source: { "uri": "..." }`. Its `kind` is one of:

- `premise`: executable evidence is `failed` or `unknown`;
- `decision`: an active decision requires reconsideration;
- `history`: a snapshotted decision changed or became unavailable;
- `evaluation`: configuration, provider evaluation, empty knowledge or freshness checks prevented verification;
- `session`: the original snapshot is missing, invalid or unreadable.

Each advisory contains `id`, `status` and `message`, with optional numeric `probability` and string `model`. Its statuses are those listed under [Jev questions configuration](#jev-questions-configuration), not agent report statuses.

`start` snapshots existing `.decision` contents in `.premise/agent-sessions/` before editing. Starting the same session again retains its original snapshot. Do not delete or replace an active snapshot to reset history. Existing decisions cannot be rewritten or removed during that session; preserve them and add reviewed `Supersedes` replacements. Later additions enter the next session's snapshot.

`stop` evaluates executable premises, decision reviews and historical contents, then obtains any configured Jev advice. An opted-in repository with neither discovered premises nor decisions is blocked. A review cannot override an executable failure or repair rewritten decision history.

Completion fingerprints repository inputs before evaluation and again after decision checks and advice. Inputs changing during that interval reject an otherwise passing result. Fingerprints cover file contents, modes and symlink referents, excluding `.git`, `node_modules`, generated agent state and configured Cucumber report outputs. Report paths overlapping executable inputs, including symlink aliases, block completion. These are not atomic filesystem snapshots and do not freeze external services or installed dependencies. Filesystem errors block verification.

### Context projections

`agent context` requires an existing session snapshot and a valid, present `premise.json`. It evaluates current executable premises and projects artifact context. It does not return a start/stop report or perform the full stop check.

Its JSON object contains:

| Field | Shape |
| --- | --- |
| `artifact` | Normalised project-relative artifact path |
| `knowledge` | Array of related premise and decision entries; may be empty |

Every knowledge entry contains `id`, `kind`, `description`, `source` and `state`. Premise entries have `kind: "premise"` and also contain `premiseType`, `provider` and `dialect`. Decision entries have `kind: "decision"` and use the decision title as their description.

`source` contains `uri` and optional `selector` and `range`. A range has `start` and `end`, each with `line` and `column`; Cucumber locations are one-based. State shapes are:

- `established`: `{ "status": "established" }`;
- `failed`: `status` plus a `diagnostics` array, each containing `message` and optional `uri` and `range`;
- `unknown`: `status` plus a string `reason`;
- `reconsider`: `status` plus a `reasons` array, each containing `id`, `kind`, `message` and `status`. Reason kinds are `decision`, `premise` or `review`; reason statuses are `failed`, `reconsider`, `stale` or `unknown`.

Premise entries use `established`, `failed` or `unknown`; decision entries use `established` or `reconsider`. Context retrieval exits `0` even when entries report failed or stale knowledge. Consumers must not interpret a context projection as successful completion.

## Environment and generated state

| Setting or path | Purpose |
| --- | --- |
| `TSX_TSCONFIG_PATH` | Explicit Cucumber TypeScript configuration; otherwise Premise looks for `tsconfig.json`, then `tsconfig.base.json` in the project root |
| `TYPESAFE_AI_API_KEY` | Credential for optional Jev requests; keep it out of committed files |
| `PREMISE_CODEX_TIMEOUT_MS` | Optional positive integer no greater than `550000`, lowering the Codex launcher's default 550-second budget |
| `PREMISE_CLAUDE_TIMEOUT_MS` | Optional positive integer no greater than `550000`, lowering the Claude launcher's default 550-second budget |
| `.premise/reviews/` | Decision review receipts; commit these |
| `.premise/agent-sessions/` | Generated original decision snapshots; ignore in version control |
| `.premise/agent-feedback/` | Generated host feedback state; ignore in version control |

The bundled Codex and Claude hooks have 600-second deadlines. Do not lower a host timeout below its launcher's budget. Timeouts and host continuation limits are not successful verification. In particular, Claude Code's continuation cap can end a turn despite a blocked Premise report. The CLI protocol itself does not override host limits.

These adapters enforce a workflow, not a security boundary. Trust repository and hook code: Cucumber steps and dependency-cruiser configurations execute local code. Disabled hooks, interruption, tampered state and host limits can bypass enforcement. For the tested host versions, Claude's continuation cap, OMP's bounded waits and the complete trust requirements, see [Agent workflows](agent-workflows.md).
