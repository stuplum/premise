# Premise documentation

Start with [Getting started](getting-started.md) to add Premise to a repository. For the problem it is intended to solve, read [Why Premise exists](purpose.md).

## Getting started

| Guide | Use it to |
| --- | --- |
| [Getting started](getting-started.md) | Install Premise, adopt it with an agent or add an executable requirement manually, and run verification. |

## How-to guides

| Task | Guide |
| --- | --- |
| Adopt an existing repository with a coding agent | [Agent-assisted onboarding](getting-started.md#agent-assisted-onboarding) |
| Add checks and context to OMP | [OMP integration](agent-workflows.md#omp) |
| Add checks and context to Codex | [Codex integration](agent-workflows.md#codex) |
| Add checks and context to Claude Code | [Claude Code integration](agent-workflows.md#claude-code) |
| Configure optional semantic advice | [Jev advice](agent-workflows.md#optional-jev-advice) |
| Reaffirm or replace an architecture decision | [Reconsidering a decision](decisions.md#reconsidering-a-decision) |

The shipped agent instructions are separate from the user guides: [onboard](../prompts/onboard.md), [discover](../prompts/discover.md), [adopt](../prompts/adopt.md) and [audit](../prompts/audit.md). Onboarding requires human approval before adoption; the audit should use a fresh agent.

## Reference

These pages describe currently supported behaviour.

| Reference | Contents |
| --- | --- |
| [CLI and configuration](reference.md) | Commands, exit behaviour, configuration, discovery defaults and the agent JSON protocol. |
| [Architecture decisions](decisions.md) | The `.decision` language, drivers, review receipts and supersession. |
| [Cucumber provider](providers/cucumber.md) | Gherkin identities, selector scope, step definitions and execution evidence. |
| [dependency-cruiser provider](providers/dependency-cruiser.md) | Rule discovery, analysis scope and dependency evidence. |

## Explanation

- [Why Premise exists](purpose.md): the difference between following a decision and checking whether its justification still holds.
- [Decision drivers](decisions.md#what-driven-by-means): what a supporting claim does, and what it does not prove.

## Development and design history

These are for contributors. Design proposals and past choices are not installation instructions or promises of supported features.

- [Contributing](https://github.com/stuplum/premise/blob/main/CONTRIBUTING.md): development setup and verification.
- [Releasing](https://github.com/stuplum/premise/blob/main/RELEASING.md): package publication workflow.
- [Changelog](../CHANGELOG.md): shipped changes and unreleased work.
- [Product model](design/product-model.md): design direction, candidate interfaces and the current implementation boundary.
- [ADR 002: selector-scoped evaluation](decisions/002-selector-scoped-premise-evaluation.md): the accepted decision to evaluate each Gherkin premise independently.
- [ADR 001: feature-file boundary](decisions/001-feature-file-requirement-boundary.md): the earlier decision, superseded by ADR 002.

The files under `docs/decisions/` record decisions about developing Premise. They are distinct from the [`.decision` format](decisions.md) that Premise evaluates in a user's repository.

## Experiments

These reports preserve the question, method, result and limitations of an experiment. They are not current command reference or proof of a general improvement in agent reasoning.

| Report | What it records |
| --- | --- |
| [Decision-enforcement matrix](experiments/decision-enforcement-matrix.md) | A small controlled comparison of decision consistency with and without Premise enforcement. |
| [Fingerprint-free decision awareness](experiments/fingerprint-free-decision-awareness.md) | An earlier working-tree prototype and why committed review receipts replaced it. |

[Back to Premise](../README.md)
