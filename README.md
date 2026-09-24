# Premise

Premise keeps the knowledge that shapes software visible when the software
changes. It connects executable requirements, architecture decisions, source
files, and generated review evidence so that normal repository verification can
stop stale assumptions from being silently ignored.

It is designed for repositories shared by product teams, engineers, and coding
agents. Human-authored sources remain authoritative; Premise adds focused
discovery and mechanical enforcement rather than another layer of generated
documentation.

> **Status:** experimental 0.1 software. Premise has demonstrated reliable
> decision-lifecycle enforcement in a controlled agent experiment. It has not
> demonstrated that it improves an agent's architectural reasoning.

This repository is currently unlicensed. Its source is public for evaluation,
but no permission to copy, modify, or redistribute it is granted.

## Why Premise exists

Behaviour changes, but architecture records and supporting documentation often
do not. A coding agent may find an old decision and follow it blindly, overlook
it entirely, or implement around it without recording why the architecture
changed.

Gherkin is excellent at expressing expected behaviour and driving acceptance
tests. It does not, by itself, enforce the lifecycle of the architectural
decisions affected by that behaviour. Premise treats these as related but
separate forms of knowledge:

- Requirements describe expected behaviour.
- Decisions record an intended architectural choice, its rationale, and costs.
- Review receipts prove that a particular decision and its declared drivers
  were considered together.
- Providers mechanically evaluate executable assertions. Bundled Cucumber
  support is the first provider, not a requirement of the core model.

## What Premise does today

### Enforce architecture-decision review

Architecture decisions are human-authored `.decision` files:

```text
Decision ORDER-002 "Durable confirmation delivery"
Driven by requirement ORDER-006
Choose durable storage of pending confirmations
Because accepted orders must survive delivery outages
Accept possible duplicate delivery
Supersedes ORDER-001
```

The language has a distributable grammar and a source-located AST. Premise
validates decision identity, structure, drivers, and single acyclic supersession
history.

A decision may be driven by tagged Gherkin, another decision, or any ordinary
repository file:

```text
Driven by requirement ORDER-006
Driven by decision OPS-002
Driven by source requirements/order-confirmation.md
```

After reviewing an active decision against its current drivers, record that
review:

```sh
premise review ORDER-002
```

Premise writes a small receipt to `.premise/reviews/`. The receipt contains
source identities and content fingerprints, not a generated summary. Commit it
with the decision and implementation.

If the decision or any driver later changes, `premise check` fails and returns
the complete live sources that need reconsideration. The reviewer must either:

- retain the decision by reviewing it against the new driver version; or
- preserve it as history and add a reviewed decision that supersedes it.

Add the check to the repository's normal verification command so the same rule
applies locally, to agents, and in CI:

```json
{
  "scripts": {
    "verify": "premise check && npm test"
  }
}
```

### Run executable Gherkin and retrieve focused context

Premise bundles Cucumber for JavaScript and TypeScript projects. Tag a feature
with a stable requirement ID:

```gherkin
@PAY-001
Feature: Take a payment
  Scenario: Accept a valid payment
    When the customer submits a valid payment
    Then the payment is accepted
```

Import step functions from the package-provided Cucumber entry point:

```ts
import { Given, Then, When } from "@stuplum/premise/cucumber";
```

Run the executable requirements:

```sh
premise test
```

For successful tagged features, Premise compares dry-run and real execution
coverage and records the implementation functions exercised by the scenarios.
The generated relationships live under `.premise/compiled/` and are committed.

An engineer or agent can then retrieve the current requirement relevant to an
implementation file without loading the repository's entire documentation set:

```sh
premise context src/payment.ts
```

`premise check` evaluates the current executable premises through their
providers. A changed premise that still passes is established without an
administrative acknowledgement; one that fails or cannot be evaluated makes
the check fail:

```sh
premise check
```

Decision review remains separate. A changed decision or decision driver still
requires the explicit `premise review <decision-id>` judgement described above.

Gherkin integration currently treats one feature file as one requirement
boundary. A feature may contain one stable requirement ID. Multiple IDs are
rejected because execution coverage is currently attributed at file level.

## Installation

```sh
pnpm add --save-dev @stuplum/premise
```

Premise requires Node.js 20 or newer. It works in standalone projects and
monorepos; it does not depend on Nx.

No configuration file is required for the default layout:

- features: `features/**/*.feature`
- step definitions: `features/step_definitions/**/*.ts`
- decisions: `**/*.decision`

Discovery paths can be overridden with `premise.json`:

```json
{
  "version": 1,
  "cucumber": {
    "features": ["specifications/**/*.feature"],
    "steps": ["specifications/support/**/*.ts"]
  }
}
```

## Repository artifacts

- `**/*.decision` — authoritative architecture decisions.
- `.premise/reviews/` — generated decision-review receipts.
- `.premise/compiled/` — generated requirement-to-implementation relationships.
- `premise.json` — optional discovery configuration.

The generated artifacts are intentionally small and belong in version control.
They allow verification to work in a clean CI checkout rather than relying on
an agent's memory or local working-tree state.

## What the evidence says

A controlled experiment ran twelve fresh coding agents across four conditions:
plain requirements, Gherkin, Premise with plain requirements, and Premise with
Gherkin.

All twelve implemented the requested behaviour. One Gherkin-only run added a
replacement ADR but left the obsolete ADR marked Accepted. All six Premise runs
produced a valid supersession chain and a current review receipt.

This supports a narrow claim: Premise can make decision consistency a repository
invariant. It does not show that Premise makes agents reason better, and it does
not reduce the value of Gherkin as a business-readable executable requirement
format. See [the experiment report](docs/experiments/decision-enforcement-matrix.md)
for the design, results, and limitations.

## Product model

Premise keeps three concepts separate:

- **Premise type** — what kind of knowledge is represented, such as behaviour,
  architecture, structure, contract, data, or policy.
- **Dialect** — how the mechanical assertion is expressed, such as Gherkin,
  OpenAPI, JSON Schema, or Rego.
- **Provider** — the tool that evaluates the assertion and returns an
  established, failed, or unknown result.

Architecture decisions remain authoritative context rather than mechanically
evaluated premises. They participate in the same knowledge relationships but do
not receive a synthetic pass or fail status.

The provider abstraction is product direction rather than a claim that all of
these dialects are implemented today. Current executable support is Cucumber;
decision drivers are language- and framework-agnostic.

## Development

```sh
pnpm install
pnpm verify
pnpm pack --dry-run
```

Link a development checkout into a consumer without changing the consumer's
package manifest:

```sh
cd /path/to/premise
npm link

cd /path/to/consumer
npm link --no-save --package-lock=false @stuplum/premise
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and
[RELEASING.md](RELEASING.md) for the maintainer release checklist.
