# Changelog

## 0.3.0 - 2026-10-25

- Rewrites Premise to read existing reports instead of running checks. Supports JUnit, Cucumber JSON and
  dependency-cruiser JSON, matched to decisions by exact `@<ID>` tokens and rule names.
- Replaces `.decision` files with YAML ADRs validated by `schema/decision.schema.json`, with options, reasons,
  consequences, `scope`, `supported_by`, `enforced_by`, `signoff` and `supersedes`.
- Adds `sha256:` fingerprints of normalised check text in each ADR link, `premise refresh`, the `stale` state, and
  recovery of the signed text from git history.
- Adds `premise signoff --base` with `jev` and `command` classifier adapters.
- Treats dependency-cruiser rules as unknown when the report has unresolved imports or uses `includeOnly` or `exclude`.
- Removes the Cucumber and dependency-cruiser providers, the `./cucumber` export, review receipts, `premise review`,
  `premise test`, the `.decision` grammar, onboarding prompts and Node.js 20 support.

## 0.2.0 - 2026-10-02

- Reserves canonical provider, premise type, dialect, and evidence-role
  identifiers, with independent `namespace:name` extensions for third parties.
- Rejects invalid registry identifiers before provider preparation, invalid
  discoveries before evaluation, and ambiguous roles in evaluation evidence.
- Exposes `isKnownEvidenceRole` and `KnownEvidenceRole` for consumers that
  distinguish canonical evidence semantics from opaque extensions.
- Discovers Cucumber premise declarations from the Gherkin AST, retaining
  node descriptions, source locations and inherited scenario selections.
- Reports malformed Gherkin, duplicate stable-ID declarations and tagged
  nodes without executable scenarios.
- Evaluates multiple premises in one feature independently, with selector-scoped
  dry runs, outcomes and coverage evidence including shared backgrounds.
- Clarifies repository-owned premise identity and provider-owned metadata
  binding, with native and sidecar OpenAPI examples using the existing API.

## 0.1.1 - 2026-09-24

- Makes provider definitions reusable across projects through explicit,
  project-scoped sessions.
- Adds executable interleaving validation for the bundled Cucumber and
  dependency-cruiser providers.
- Adds adoption, discovery, audit, and onboarding prompts with expanded
  provider and decision documentation.

- Runs executable Gherkin through bundled Cucumber support.
- Evaluates executable premises through provider-neutral `established`,
  `failed`, and `unknown` results during `premise check`.
- Evaluates named dependency-cruiser rules as architecture premises alongside
  Cucumber behaviour and exposes their subject evidence to shared context.
- Resolves `Driven by premise` decision relationships through the generic
  provider registry; legacy `Driven by requirement` syntax remains compatible.
- Separates provider evaluation from graph-derived knowledge state and
  propagates explained `reconsider` state through dependent decisions.
- Projects artifact context as structured, current premise and decision
  knowledge while retaining source references for deeper inspection.
- Discovers implementation relationships from successful feature execution.
- Projects artifact relationships from current provider evidence without
  committed generated context indexes.
- Removes `premise acknowledge`; executable premises are established only by
  provider evaluation.
- Retrieves live requirement context for implementation files.
- Provides a standalone architecture-decision language with a distributable
  grammar and source-located AST.
- Resolves decision drivers to generic premises, other decisions, or ordinary
  repository files.
- Records compact per-decision review receipts for local verification and CI.
- Rejects unreviewed or stale active decisions and returns their live sources.
- Validates decision supersession targets, branches, and cycles while preserving
  superseded decisions as history.
- Supports Node.js 20, 22, and 24.
