# Changelog

## Unreleased

Initial experimental release.

- Runs executable Gherkin through bundled Cucumber support.
- Evaluates executable premises through provider-neutral `established`,
  `failed`, and `unknown` results during `premise check`.
- Evaluates named dependency-cruiser rules as architecture premises alongside
  Cucumber behaviour and compiles their subject evidence into shared context.
- Discovers implementation relationships from successful feature execution.
- Stores compiled relationships as provider-neutral schema v2 premise evidence
  without executable-validity fingerprints.
- Removes `premise acknowledge`; executable premises are established only by
  provider evaluation.
- Retrieves live requirement context for implementation files.
- Provides a standalone architecture-decision language with a distributable
  grammar and source-located AST.
- Resolves decision drivers to tagged Gherkin, other decisions, or ordinary
  repository files.
- Records compact per-decision review receipts for local verification and CI.
- Rejects unreviewed or stale active decisions and returns their live sources.
- Validates decision supersession targets, branches, and cycles while preserving
  superseded decisions as history.
- Supports Node.js 20, 22, and 24.
