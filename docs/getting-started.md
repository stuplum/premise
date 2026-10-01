# Getting started

Premise adds executable repository knowledge and reviewed architecture decisions to an existing project. Start with a few important claims, connect them to real checks, and run those checks alongside your existing verification.

This guide covers installation, agent-assisted adoption and a small manual example. For command and configuration details, use the [reference](reference.md). Browse all guides in the [documentation index](README.md).

## Installation

Use **Node.js 20 or newer**. Install Premise as a development dependency with your project's package manager:

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

The package installs the `premise` CLI into the project's normal package binary directory. Run it through your package manager, for example `pnpm premise check` or `npm exec -- premise check`, or from a package script.

The ordinary CLI does not require `premise.json` when using the default layout. Agent lifecycle enforcement is a separate opt-in and requires that file.

## Agent-assisted onboarding

For an existing repository, use the shipped onboarding workflow. After installation, give your coding agent this instruction:

```text
Onboard this repository to Premise.

Read and follow:
node_modules/@stuplum/premise/prompts/onboard.md

Begin with discovery only. Do not modify the repository until you have
shown me the proposed adoption scope and I have explicitly approved it.
```

Keep the four stages separate:

1. **Discovery:** identify consequential repository claims and existing decisions without changing files. A useful first scope is a few behavioural guarantees, one or two architecture boundaries and decisions with genuine rationale.
2. **Human approval:** approve or amend that scope before adoption starts. Do not treat silence or an existing plan as approval.
3. **Adoption:** implement only the approved assertions and decisions, then run repository verification. Record decision reviews only after the human has reviewed the decision and explicitly asked for the review to be recorded.
4. **Fresh audit:** give a fresh agent `node_modules/@stuplum/premise/prompts/audit.md`. Ask it to re-derive the claims from the current repository rather than trust the adopting agent's reasoning or a passing check.

For each proposed premise, ask: if the implementation made this claim false without changing the assertion, would its evaluator notice? A passing assertion is useful only when it checks the stated claim.

## Manual setup

This standalone example checks a payment acceptance rule with Gherkin and real TypeScript code. It uses the default feature and step-definition paths, so no `premise.json` or TypeScript configuration is needed.

### 1. Create a small project

In a directory where `premise-example` does not already exist:

```sh
mkdir premise-example
cd premise-example
npm init -y
npm pkg set type=module
npm install --save-dev @stuplum/premise
mkdir -p src features/step_definitions
```

Create `src/payment.ts`:

```ts
export function submitPayment(amount: number): "accepted" | "rejected" {
  return amount > 0 ? "accepted" : "rejected";
}
```

This deliberately small application accepts positive payment amounts and rejects zero or negative amounts.

### 2. Declare and implement the assertion

Create `features/payment.feature`:

```gherkin
@PAY-001
Feature: Accept only positive payments

  Scenario Outline: Validate the payment amount
    When the customer submits a payment of <amount>
    Then the payment is <result>

    Examples:
      | amount | result   |
      | 25     | accepted |
      | 0      | rejected |
      | -1     | rejected |
```

The stable tag `@PAY-001` identifies the premise. Its scenarios must execute successfully to establish the claim.

Create `features/step_definitions/payment.steps.ts`:

```ts
import assert from "node:assert/strict";
import { Then, When } from "@stuplum/premise/cucumber";
import { submitPayment } from "../../src/payment.ts";

When("the customer submits a payment of {int}", function (amount: number) {
  this.paymentResult = submitPayment(amount);
});

Then("the payment is {word}", function (expected: string) {
  assert.equal(this.paymentResult, expected);
});
```

Import Cucumber functions from `@stuplum/premise/cucumber` so your steps use Premise's Cucumber instance. Premise runs TypeScript steps through its bundled `tsx` dependency.

### 3. Run and inspect the premise

From the example project's root:

```sh
npm exec -- premise test
npm exec -- premise check
npm exec -- premise context src/payment.ts
```

`test` runs executable premises with normal test output. `check` also checks decision review state. `context` evaluates the repository and shows knowledge related to the implementation file, including `PAY-001` when execution evidence associates it with `src/payment.ts`.

To see the assertion catch a bug, change `amount > 0` to `amount >= 0` in `src/payment.ts` and rerun `npm exec -- premise check`. The zero-payment example should fail. Restore `amount > 0` and rerun the check before continuing.

### What you built

You now have one named claim backed by executable scenarios rather than a prose promise. There is no committed artifact-to-premise index: Premise derives the relationship to `src/payment.ts` from evaluation.

In your real project, replace the example rule with a consequential existing behaviour. Use the [Cucumber guide](providers/cucumber.md) for discovery, custom paths and execution evidence. Add architecture boundaries with the [dependency-cruiser guide](providers/dependency-cruiser.md), and record genuine design choices with the [decision guide](decisions.md). A decision review records human reconsideration; it does not make a failing executable premise pass.

## Enable agent integration

Once the repository has useful assertions, follow [agent workflows](agent-workflows.md) to enable OMP, Codex or Claude Code. That guide covers installation, hook trust, automatic session snapshots, completion checks and optional Jev advice.

Create an explicit `premise.json` to opt in, even when all CLI discovery defaults fit:

```json
{
  "version": 1
}
```

The integrations enforce a workflow, not a security boundary. Read the host-specific limits before relying on a completion check. Jev is optional advisory feedback, not executable validation.

## Run in normal verification and CI

Keep your existing tests. Add Premise alongside them in `package.json`, adapting the existing `verify` script rather than discarding its checks:

```json
{
  "scripts": {
    "verify": "premise check && npm test"
  }
}
```

This assumes `npm test` already runs your project's tests. For the standalone example above, which has no separate test suite, use `"verify": "premise check"` instead.

Commit the package lockfile, install development dependencies in CI, and run the same verification script. For an npm project:

```sh
npm ci --include=dev
npm run verify
```

A failed or unknown executable premise, or an active decision needing reconsideration, makes `premise check` exit non-zero. `unknown` means a trustworthy evaluation could not be obtained, not that the claim passed. See the [command reference](reference.md) for the distinction between `check` and `test`.

## Commit sources and reviews, not session state

Commit the authoritative inputs your project uses:

- Feature files, step definitions and the implementation they exercise.
- `.decision` files and `.premise/reviews/` decision review receipts.
- `premise.json`, when configured, and any dependency-cruiser configuration.
- Package scripts, dependency declarations and your package manager's lockfile.

Add these entries to `.gitignore` when enabling agent workflows:

```gitignore
.premise/agent-sessions/
.premise/agent-feedback/
```

Do not ignore all of `.premise/`: review receipts belong in version control. They record which driver versions a human reviewed; they are not a cache of successful executable checks. Do not delete an active session's snapshot to reset decision history.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `premise` is not found | Run it through the project's package manager, or use it inside a package script. Check that development dependencies are installed. |
| `premise test` finds no executable premises | Run from the project root and check the feature and step paths. A bare install does not create assertions. |
| A behavioural premise is `unknown` | Check for missing step definitions and read the provider diagnostic. The [Cucumber guide](providers/cucumber.md) covers discovery and TypeScript loading. |
| No context is returned for an implementation file | Use a stable premise ID and ensure the selected scenarios actually exercise the module. An import alone is not execution evidence. |
| An active decision requires reconsideration | Reconsider it against its current drivers, then [record a review or superseding decision](decisions.md). Do not record a review merely to clear the check. |
| Agent completion is not enforced | Check that `premise.json` exists and the integration is loaded with hooks enabled and trusted. Read the [host limits](agent-workflows.md), especially Claude Code's continuation cap. |
| A hook reports changed repository inputs | Finish the concurrent edits or generators and request another check. See the [freshness guard](agent-workflows.md#completion-and-freshness). |

## Next

- [Documentation index](README.md)
- [Agent workflows](agent-workflows.md)
- [CLI and configuration reference](reference.md)
- [Architecture decisions](decisions.md)
- [Cucumber provider](providers/cucumber.md)
- [dependency-cruiser provider](providers/dependency-cruiser.md)
