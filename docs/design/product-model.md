# Premise product model

## Status

This document records design direction, not a fully implemented public API.

## Separate the type, dialect, and provider

Premise should represent mechanical knowledge without assuming that one format
or tool defines its meaning. Three concepts remain independent:

- A **premise type** describes the nature of the knowledge: behaviour,
  architecture, structure, contract, data, or policy.
- A **dialect** describes how its mechanical assertion is expressed: Gherkin,
  OpenAPI, JSON Schema, Rego, ArchUnit, or another format.
- A **provider** evaluates assertions in one or more dialects.

This prevents the core from treating Gherkin, behaviour, and Cucumber as the
same concept. Gherkin is a dialect, behaviour is a premise type, and Cucumber is
a provider.

## Candidate premise API

```ts
export interface Premise {
  id: string;
  description: string;
  type?: string;
  assertion: Assertion;
  dependsOn?: string[];
}

export interface Assertion {
  dialect: string;
  ref: AssertionRef;
}

export interface AssertionRef {
  uri: string;
  selector?: string;
}
```

The `URI + optional selector` boundary identifies an assertion without requiring
the core to interpret dialect-specific selectors. A Gherkin provider may treat
`@ORDER-007` as a tag, while an OpenAPI provider may treat a selector as a JSON
Pointer.

## Provider API

```ts
export interface PremiseProvider {
  readonly id: string;
  readonly dialects: readonly string[];

  discover(context: EvaluationContext): Promise<readonly Premise[]>;

  evaluate(
    premise: Premise,
    context: EvaluationContext,
  ): Promise<EvaluationResult>;
}

export interface EvaluationContext {
  projectDirectory: string;
}
```

Discovery belongs to the provider in the current model. Native tools already
have different ways to identify their assertions, and forcing them through a
central manifest before a second provider exists would merely move
provider-specific assumptions into the core. The core validates provider IDs,
supported dialects, and globally unique premise IDs before asking providers to
evaluate their discoveries.

Providers translate their native output into a small common result:

```ts
export type EvaluationResult =
  | { status: "established"; evidence?: Evidence[] }
  | { status: "failed"; evidence?: Evidence[]; diagnostics: Diagnostic[] }
  | { status: "unknown"; reason: string };
```

Provider-specific concepts should not leak into dependency propagation, context
retrieval, or invalidation logic owned by the core.

## Evidence

Providers may report the repository evidence involved in an evaluation:

```ts
export interface Evidence {
  uri: string;
  range?: Range;
  role?: string;
}
```

Evidence identifies live source. It is not a fingerprint and should not become
a generated explanation of that source.

## Decisions are related but distinct

An architecture decision records an authoritative choice, rationale, accepted
costs, and history. It is not a mechanically established or failed assertion.

Decisions can depend on premises and other decisions, and their review lifecycle
can be mechanically enforced. Premise should not assign them a synthetic pass or
fail status merely to fit them into the provider model.

## Current implementation boundary

The current package implements:

- a provider-neutral discovery, evaluation, result, and evidence boundary;
- executable Gherkin through a bundled Cucumber provider;
- requirement-to-implementation context discovery;
- the `.decision` language and parser;
- decision-driver resolution and supersession validation; and
- committed review receipts enforced by `premise check`.

`premise check` derives executable premise state from provider evaluation. It
does not treat a changed source fingerprint as proof that a premise failed.
Decision review remains a separate human-judgement lifecycle backed by review
receipts.

Compiled context still uses the earlier requirement/fingerprint persistence
shape. Those fingerprints are legacy context data rather than executable
validity, pending replacement with provider-neutral evidence. A genuinely
different second provider remains the test of whether the implemented boundary
is sufficiently generic.

Untagged Gherkin features remain executable for compatibility. The Cucumber
provider gives them an internal `cucumber:<uri>` identity so they can pass
through the same evaluator, while the existing context compiler continues to
exclude them from repository knowledge.
