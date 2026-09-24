# Premise

**Executable repository knowledge for software teams and coding agents.**

Premise connects executable requirements, architecture constraints and architectural decisions so that important repository knowledge can be checked as the code changes.

Premises are mechanically evaluated. Decisions remain human judgement and are tracked against the knowledge that drove them.

> Experimental `0.1` software. Requires Node.js 20+.

## Install

```sh
pnpm add --save-dev @stuplum/premise
```

```sh
npm install --save-dev @stuplum/premise
```

```sh
yarn add --dev @stuplum/premise
```

```sh
bun add --dev @stuplum/premise
```

## Onboard an existing repository

Premise ships with prompts for agent-assisted onboarding.

Give your coding agent:

```text
Onboard this repository to Premise.

Read and follow:

node_modules/@stuplum/premise/prompts/onboard.md

Begin with discovery only. Do not modify the repository until you have
shown me the proposed adoption scope and I have explicitly approved it.
```

The onboarding flow is:

```text
discover → review → adopt → audit
```

After adoption, use a fresh agent for the independent audit:

```text
Read and follow:

node_modules/@stuplum/premise/prompts/audit.md

Audit this repository's Premise integration.
Do not modify the repository.
```

See [Getting started](docs/getting-started.md) for manual setup and CI integration.

## Current support

| Knowledge                | Assertion                | Evaluation             |
| ------------------------ | ------------------------ | ---------------------- |
| Behaviour                | Gherkin                  | Cucumber               |
| Architecture constraints | dependency-cruiser rules | dependency-cruiser     |
| Architecture decisions   | `.decision`              | Human review lifecycle |

## Commands

```sh
premise check
```

Evaluate executable Premises and decision consistency.

```sh
premise test
```

Run executable Premises and collect provider evidence.

```sh
premise context src/example.ts
```

Show repository knowledge relevant to an implementation file.

```sh
premise review ARCH-001
```

Record that a decision has been reviewed against its current drivers.

## Example

An executable architecture Premise can be expressed as a dependency-cruiser rule:

```json
{
  "forbidden": [
    {
      "name": "ARCH-003",
      "comment": "Domain code must not depend on HTTP infrastructure",
      "severity": "error",
      "from": { "path": "^src/domain" },
      "to": { "path": "^src/http" }
    }
  ]
}
```

`premise check` evaluates the claim against the current repository.

A decision can then reference executable repository knowledge:

```text
Decision ORDER-002 "Durable confirmation delivery"
Driven by premise ORDER-006
Choose durable storage of pending confirmations
Because accepted orders must survive delivery outages
Accept possible duplicate delivery
```

Premise tracks whether that decision has been reviewed against its current drivers.

## Documentation

* [Getting started](docs/getting-started.md)
* [Architecture decisions](docs/decisions.md)
* [Cucumber provider](docs/providers/cucumber.md)
* [dependency-cruiser provider](docs/providers/dependency-cruiser.md)
* [Product model](docs/design/product-model.md)
* [Experiment results](docs/experiments/decision-enforcement-matrix.md)
* [Contributing](CONTRIBUTING.md)

## Status

Premise is experimental software.

The source repository is public for evaluation but is currently unlicensed.

