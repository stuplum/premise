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

## Canonical identifiers and extensions

Provider IDs, premise types, dialect IDs, and evidence roles are independent,
case-sensitive string vocabularies. Their unqualified identifiers are reserved
for the following canonical meanings:

| Vocabulary | Canonical identifiers |
| --- | --- |
| Provider ID | `cucumber`, `dependency-cruiser` |
| Premise type | `behaviour`, `architecture`, `contract`, `data`, `policy`, `structure` |
| Dialect ID | `gherkin`, `dependency-cruiser`, `openapi`, `json-schema`, `rego` |
| Evidence role | `assertion`, `executed`, `subject`, `dependency` |

A provider ID identifies an evaluator implementation, not a premise or an
assertion language. A type classifies the knowledge: behaviour describes
observable outcomes, architecture constrains system organisation, contract
describes interface obligations, data constrains information, policy expresses
rules governing permitted states or actions, and structure constrains shape or
composition. A dialect names the assertion language or format independently of
both its evaluator and its premise type. Recognising a dialect identifier does
not mean that a bundled provider implements it.

Third-party identifiers use `namespace:name` in all four vocabularies, including
the provider ID itself. Both components start with a lowercase ASCII letter,
then contain lowercase ASCII letters or digits in non-empty, hyphen-separated
segments. Exactly one colon is required. Whitespace, uppercase letters,
underscores, repeated hyphens, and leading or trailing hyphens are invalid.
For example, `acme:payment-checker` can evaluate `shared-vocabulary:payment-schema`
assertions of type `finance:payment-policy` and emit `shared-vocabulary:input`
evidence without any core release.

The namespace identifies the organisation or vocabulary owner and should remain
stable; it is not required to equal the emitting provider's namespace. Providers
can share established types, dialects, and roles. A qualified identifier is
opaque to generic consumers, even if its name matches a canonical identifier:
`acme:assertion` is not an alias for `assertion`. Public fields remain strings,
not closed enums. Producers must use the exact canonical spelling when they
intend its meaning; the core does not silently normalise `behavior`, `Gherkin`,
or other aliases.

`discoverPremises` and `evaluatePremises` validate the entire registry's provider
IDs and declared dialects before preparing any provider. Discovered premise
types and dialects must use valid vocabulary, and the emitting provider must
declare the exact dialect. All discoveries are validated before any evaluation.
Evidence roles are validated when evaluation results cross back into the core,
for both established and failed results. Invalid identifiers reject the call
rather than returning ambiguous knowledge. Calling a provider session directly
bypasses these core boundary checks.

These rules do not apply to repository-owned stable premise IDs such as
`PAY-001`, assertion source URIs, or dialect-specific selectors such as
`@PAY-001` and `#/Payment`. Those retain their existing identity and syntax.

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

The canonical evidence roles describe why a source participates:

- `assertion`: the source that defines the mechanical assertion;
- `executed`: implementation source exercised while evaluating the assertion;
- `subject`: source selected as the object of a check, whether or not executed;
- `dependency`: a dependency target involved in the evaluated relationship.

A missing role is permitted and makes no claim about the relationship's kind.
Generic consumers can import `isKnownEvidenceRole` and the `KnownEvidenceRole`
type from `@stuplum/premise` to narrow a value to the canonical role vocabulary.
The guard returns false for qualified extensions, absent roles, and invalid
values; it is not an extension-identifier validator. Unknown qualified roles
should be preserved without interpreting their suffix as a canonical role.
Artifact context excludes canonical `assertion` evidence from implementation
relationships, while retaining matching evidence with other or absent roles.

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
