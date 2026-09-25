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

The description comes from the tagged Gherkin node's name, such as `Take a payment`, rather than the feature filename.

## Discovery and declaration scope

Premise parses each feature with the official Gherkin parser. Stable ID tags such as `@PAY-001` belong to the actual node on which they are declared:

| Tagged node | Selected executable cases |
| --- | --- |
| Feature | Scenarios and outline rows throughout the feature, including its rules |
| Rule | Scenarios and outline rows within that rule |
| Scenario | That scenario |
| Scenario Outline | Rows from all of that outline's Examples blocks |
| Examples | Rows from that Examples block only |

The compiler supplies inherited tags and expanded outline rows. An ID inherited by several scenarios or rows remains one declaration. Repeating the same ID explicitly, whether on the same node or on separate nodes, is rejected with both tag locations. IDs in comments, descriptions, doc strings and table cells are not declarations.

The assertion reference retains the feature URI, stable tag selector and a `range` pointing to the declaring node's keyword. Its start and end are the same one-based line and column because Gherkin supplies a start location, not a full source span. Untagged features use the Feature name and location where available.

Malformed Gherkin, including tags on unsupported nodes such as Background, is rejected with the parser's source-located diagnostic. A stable ID must select at least one compiled scenario or outline row containing executable steps. Empty tagged features, rules, scenarios and Examples blocks are rejected rather than silently losing their identity.

Different IDs can legitimately select shared scenarios. Each premise is evaluated independently using its stable tag selector. A shared scenario contributes to every premise that selects it, without extending any premise to unrelated scenarios.

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

The Cucumber provider performs a separate dry run and real execution for each premise, applying the same tag selector to both runs.

The dry run establishes baseline module loading. Premise then compares execution coverage with that premise's real run to identify implementation modules exercised by its selected scenarios. Feature and Rule Backgrounds run normally for those scenarios, so their exercised modules also contribute evidence. Modules merely imported by another scenario's step definitions are excluded by the baseline comparison.

## Evidence

For a tagged premise, provider evidence includes:

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

## Multiple premises in one feature

A `.feature` file can contain several stable IDs, each with its own independently addressable `uri` and `selector`:

```gherkin
Feature: Order lifecycle

  @ORDER-007
  Scenario: A dispatched order cannot be modified
    Given an order has been dispatched
    Then modifying it is rejected

  @ORDER-008
  Scenario: An unshipped order can be cancelled
    Given an order has not been shipped
    Then cancelling it succeeds
```

Evaluating `@ORDER-007` does not run `@ORDER-008` or attribute its exclusive implementation modules to the first premise. Inherited Feature and Rule tags select their descendant scenarios, while Examples tags select only their own outline rows.

Existing single-ID features continue to work. A feature with no stable ID still runs as a whole; untagged scenarios inside a file containing stable IDs run only when selected through an ancestor tag. Use the ordinary Cucumber runner to execute every scenario regardless of premise declarations.

Independent execution requires two Cucumber processes per premise, including where selections overlap. This trades runtime for reliable outcomes and evidence rather than reusing whole-file coverage. [ADR 002](../decisions/002-selector-scoped-premise-evaluation.md) supersedes the old file-level restriction.

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

