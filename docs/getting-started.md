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

Premise does not require a configuration file for its default layout.

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

The current configuration format only configures Cucumber discovery.

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

