# Changelog

## Unreleased

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
