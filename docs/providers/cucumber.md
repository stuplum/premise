# Cucumber provider

Premise includes a Cucumber provider for executable behavioural Premises written in Gherkin.

## Default paths

Features:

```text
features/**/*.feature
```

Step definitions:

```text
features/step_definitions/**/*.ts
```

Override these with `premise.json`:

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

## Define a behavioural Premise

Give the feature a stable ID tag:

```gherkin
@PAY-001
Feature: Take a payment

  Scenario: Accept a valid payment
    When the customer submits a valid payment
    Then the payment is accepted
```

Premise discovers this as approximately:

```text
ID: PAY-001
type: behaviour
dialect: gherkin
provider: cucumber
assertion: features/payment.feature
selector: @PAY-001
```

The feature filename is used as its description in the current implementation.

## Step definitions

Import Cucumber functions from Premise:

```ts
import { Given, Then, When } from "@stuplum/premise/cucumber";
```

For example:

```ts
When("the customer submits a valid payment", async function () {
  // exercise the application
});

Then("the payment is accepted", function () {
  // verify the result
});
```

These are normal executable Cucumber step definitions.

A Premise is established because the scenarios execute successfully, not because the feature file parses or contains a valid ID.

## Run behavioural Premises

```sh
premise test
```

or:

```sh
premise check
```

The Cucumber provider performs a dry run and a real execution.

The dry run establishes baseline module loading. Premise then compares execution coverage with the real run to identify implementation modules exercised by the scenarios.

## Evidence

For a tagged successful feature, provider evidence includes:

```text
assertion → the .feature source
executed  → implementation modules exercised during execution
```

This evidence is used by:

```sh
premise context <artifact>
```

For example:

```sh
premise context src/payment.ts
```

can associate `src/payment.ts` with `PAY-001` when execution evidence shows that the behavioural Premise exercised that module.

This relationship is derived from current evaluation. Premise does not write a generated artifact-to-Premise index.

## Untagged features

Untagged Gherkin remains executable for compatibility.

Premise assigns it an internal identity based on its source path:

```text
cucumber:<feature-uri>
```

It can still succeed or fail as executable input.

However, without a stable Premise ID, Premise does not expose implementation artifact relationships for that feature.

Tag repository knowledge that should participate in the knowledge graph.

## Current feature boundary

The current provider supports at most one stable Premise ID in each `.feature` file.

For example, this is supported:

```gherkin
@ORDER-001
Feature: Order lifecycle

  Scenario: Dispatch an order
    ...
```

Multiple Premise IDs in one feature file are currently rejected.

This is an implementation limitation rather than a conceptual requirement of Premise.

## Missing step definitions

If feature files are found but no configured step definitions are available, evaluation returns `unknown`.

This is different from `failed`.

`unknown` means Premise could not obtain a trustworthy evaluation of the claim.

## TypeScript

Premise executes Cucumber through `tsx`.

For TypeScript configuration it uses, in order:

1. an externally supplied `TSX_TSCONFIG_PATH`;
2. `tsconfig.json` in the project root;
3. `tsconfig.base.json` in the project root.

## Dynamic imports

Step definition files containing dynamic `import()` calls produce a warning:

```text
Dynamic module coverage may be unreliable for ...
```

The behavioural test can still execute, but implementation evidence discovered through coverage may be incomplete.

## What establishment means

For a Gherkin Premise:

```text
established
```

means Cucumber successfully executed the feature.

```text
failed
```

means Cucumber evaluated it and execution did not establish the expected behaviour.

```text
unknown
```

means Premise could not obtain a trustworthy executable result, for example because no step definitions were available.

Successful parsing alone is never enough to establish the behavioural claim.

