# Premise

**Executable requirements and architecture constraints, linked to the decisions they support.**

Code can still follow an architecture decision after a new requirement makes that decision unsuitable. Premise checks the supporting claims and brings affected decisions back for review, without erasing why they were made.

For example, adding a sorting requirement to a query that only returns upstream results:

```text
QUERY-001 failed via cucumber.
- Cucumber did not establish QUERY-001 (features/query.feature)
Reconsider decision QUERY-010: Query upstream systems directly

Reason: Supporting premise QUERY-001 failed.
Reason: Decision has not been reviewed against its current drivers.
```

*Excerpt from `premise check`. The full report includes the requirement, original decision and next steps.*

- **Check repository claims.** Evaluate Gherkin behaviour with Cucumber and dependency rules with dependency-cruiser. Missing or inconclusive evidence is not a pass.
- **Review decisions when their drivers change.** Reaffirm a choice after reconsidering it, or record a replacement with `Supersedes`. Decisions remain human judgement, not mechanically proven truths.
- **Keep checks in the agent workflow.** OMP, Codex and Claude Code integrations supply relevant context and check evidence and decision history before completion.

## Install

Requires Node.js 20 or newer.

```sh
npm install --save-dev @stuplum/premise
```

[Other package managers](docs/getting-started.md#installation).

Follow [Getting started](docs/getting-started.md) to adopt Premise with a coding agent or add your first executable requirement manually. Once configured:

```sh
npm exec -- premise check
npm exec -- premise context src/payment.ts
```

## Documentation

[Getting started](docs/getting-started.md) · [Agent integrations](docs/agent-workflows.md) · [CLI and configuration](docs/reference.md)

[Why Premise exists](docs/purpose.md) · [All documentation](docs/README.md) · [Contributing](https://github.com/stuplum/premise/blob/main/CONTRIBUTING.md)

The documentation index separates user guides and reference material from design proposals, internal decision records and historical experiments.

## Status

Experimental `0.2` software. Current executable providers are Cucumber and dependency-cruiser; architecture decisions use the `.decision` format and a human review lifecycle.

Agent hooks are workflow enforcement, not a security boundary. Host limits and interrupted sessions can bypass the normal completion path. See [agent setup and limitations](docs/agent-workflows.md) before relying on them.

## Licence

The source repository is public for evaluation but is currently unlicensed.
