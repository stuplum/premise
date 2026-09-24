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

  prepare(context: EvaluationContext): Promise<PremiseProviderSession>;
}

export interface PremiseProviderSession {
  discover(): Promise<readonly Premise[]>;
  evaluate(premise: Premise): Promise<EvaluationResult>;
}

export interface EvaluationContext {
  projectDirectory: string;
}
```

Discovery belongs to a prepared provider session in the current model. Native
tools already have different ways to identify their assertions, and forcing
them through a central manifest would merely move provider-specific assumptions
into the core. A provider definition is reusable configuration; preparing it
creates a project-scoped session that owns discovery state and cached analysis.
The core validates provider IDs, supported dialects, and globally unique premise
IDs before asking those same sessions to evaluate their discoveries.

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

Decision drivers use `Driven by premise <id>` and resolve through the same
validated provider registry as evaluation. The decision model therefore does
not know whether a premise is Gherkin, a dependency constraint, or another
dialect. Legacy `Driven by requirement <id>` syntax is accepted at the parser
boundary and immediately normalized to a premise relationship. Existing review
receipts require a fresh review to migrate their stored driver kind.

## Evaluation state and knowledge state

Provider evaluation has exactly three outcomes:

- `established` — the provider evaluated the assertion successfully;
- `failed` — the provider evaluated the assertion and found it false; and
- `unknown` — the provider could not obtain a trustworthy result.

`reconsider` is not a provider result. It is derived by the Premise core when a
decision is not reviewed against its current sources, depends on a failed or
unknown premise, or depends on another decision requiring reconsideration. A
current reviewed decision is `established` in the graph sense, which means it
is presently trusted; it does not imply that a provider mechanically evaluated
the human judgement.

Reconsideration reasons retain the causal knowledge ID, kind, and state. Direct
and transitive reasons are sorted by kind, ID, and state so propagation and CLI
output are deterministic. These states are runtime projections and are not
persisted. Review receipts record explicit human judgement, not current state.

## Artifact context projection

`premise context` selects artifact relationships from current provider evidence
and combines them with active decision relationships to produce a typed
knowledge projection for one artifact. The projection exists in memory and is
not written as a generated artifact-context index.

Each premise entry retains its type, dialect, provider, description, evaluation
state, and assertion reference. Relevant decisions include those driven by an
indexed premise, by the artifact source itself, or transitively by another
relevant decision. Decision entries retain their current review-derived state
and reasons. Rendering this projection for the CLI is separate from creating
it, so other consumers can use the structured representation directly.

## Current implementation boundary

The current package implements:

- a provider-neutral discovery, evaluation, result, and evidence boundary;
- executable Gherkin through a bundled Cucumber provider;
- forbidden dependency rules through a bundled dependency-cruiser provider;
- provider-neutral premise drivers for architecture decisions;
- requirement-to-implementation context discovery;
- the `.decision` language and parser;
- decision-driver resolution and supersession validation; and
- committed review receipts enforced by `premise check`.

`premise check` derives executable premise state from provider evaluation. It
does not treat a changed source fingerprint as proof that a premise failed.
Decision review remains a separate human-judgement lifecycle backed by review
receipts.

`premise acknowledge` has been removed because administrative acknowledgement
cannot establish executable truth.

## What the second provider exposed

The dependency-cruiser integration exercises a different assertion syntax,
execution model, and evidence shape without adding architecture branches to the
core evaluator or shared knowledge model. It revealed one Cucumber assumption:
an empty discovery result had been treated as a Cucumber evaluation failure.
Empty discovery is now valid for each optional provider, while `premise test`
rejects an empty aggregate result after all providers have run.

The same evidence model represents Cucumber execution with the `executed` role
and dependency-cruiser scope with the `subject` role. Provider-specific rule
selection, dependency diagnostics, and source matching remain inside the
dependency-cruiser adapter. The only shared wiring change is the default
provider registry.

Untagged Gherkin features remain executable for compatibility. The Cucumber
provider gives them an internal `cucumber:<uri>` identity so they can pass
through the same evaluator, while omitting artifact evidence so they remain
outside repository knowledge until given a stable ID.
