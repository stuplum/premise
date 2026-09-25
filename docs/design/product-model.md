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

## Identity belongs to the repository

`discover()` returns complete, explicitly identified premises, not every native
assertion a tool can enumerate. Repository authors own stable premise IDs and
the choice of which assertions represent repository knowledge. Providers own
dialect interpretation and the translation from native metadata or explicit
bindings into `Premise`. The core validates the resulting identities; it does
not assign them.

Three things remain distinct:

- A native definition, such as an OpenAPI schema, exists without a Premise ID.
- A premise binds a repository-owned ID to an assertion reference and describes
  the claim that should be evaluated.
- An execution evaluates that claim in a project-scoped session. Its result
  and evidence are not a new premise identity.

A provider may enumerate native definitions internally before applying bindings.
An unbound definition is not automatically a premise. In particular, an
`operationId`, schema name, filename or JSON Pointer is a locator, not an
implicit stable knowledge ID. Moving or renaming the definition requires
updating its binding, not changing the premise ID.

### Metadata sources

Use native metadata when it expresses the intended value. Gherkin stable tags
and dependency-cruiser rule names already serve as explicit IDs by their
provider conventions; no sidecar is required for them. A native description
can supply the premise description, and a provider may derive the premise type
from the kind of claim it evaluates.

When identity cannot be expressed natively, a provider can read an explicit
dialect extension or a provider-specific sidecar in its prepared session.
The binding supplies only missing metadata. It must not force authors to
maintain a second copy of native descriptions or assertion definitions.

A provider must diagnose a configured binding whose target is missing or
ambiguous, missing required metadata, and conflicting native/sidecar values.
It must not silently choose between competing IDs or generate one from a
native name. The core's existing duplicate-ID check still applies across
providers. Selector validity remains the provider's responsibility.

The existing untagged-Cucumber `cucumber:<uri>` identity is an execution-only
compatibility convention, not a model for assigning stable repository
knowledge IDs to new dialects.

### Concrete OpenAPI binding

The following is a proposed OpenAPI provider convention, not a bundled
provider or a supported Premise configuration file. Both variants fit the
current `discover(): Promise<readonly Premise[]>` contract.

Suppose `openapi.json` contains this schema within an otherwise complete
OpenAPI document:

```json
{
  "components": {
    "schemas": {
      "Learner": {
        "type": "object",
        "description": "A learner has a stable string ID",
        "required": ["id"],
        "properties": {
          "id": { "type": "string" }
        }
      }
    }
  }
}
```

If the repository owns the document, it can add `"x-premise-id": "API-012"`
to `Learner`. A schema-contract provider reads the explicit ID, derives
`type: "contract"` from its evaluation semantics, and reuses `description`.
The extension is the only additional metadata.

For a generated or externally owned document, leave it unchanged and configure
the provider with this sidecar binding instead:

```json
{
  "premises": [
    {
      "id": "API-012",
      "ref": {
        "uri": "openapi.json",
        "selector": "#/components/schemas/Learner"
      }
    }
  ]
}
```

Either variant discovers the same premise:

```json
{
  "id": "API-012",
  "type": "contract",
  "description": "A learner has a stable string ID",
  "assertion": {
    "dialect": "openapi",
    "ref": {
      "uri": "openapi.json",
      "selector": "#/components/schemas/Learner"
    }
  }
}
```

The schema remains the assertion source. The sidecar supplies identity, not
another schema or another copy of its description. If the schema has no useful
description, the binding must provide one. A provider evaluating schema
conformance would also need configured subjects or observations; merely
resolving the schema does not establish the premise.

### Why retain complete-premise discovery

Returning native assertions from every provider would make the core own
binding configuration and metadata precedence before a third dialect has
demonstrated a shared need. A universal manifest would also duplicate metadata
for dialects whose native conventions already suffice.

Keep binding inside providers and retain the existing public API. The accepted
cost is that sidecar formats and their diagnostics are provider-specific.
Reconsider a shared binding API when implemented providers demonstrate common
requirements that cannot be handled cleanly inside their sessions.

This decision does not add OpenAPI execution, a universal manifest or a new
`dependsOn` field to the runtime `Premise` contract.

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
