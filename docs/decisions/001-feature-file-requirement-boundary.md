# ADR 001: Treat a feature file as the requirement boundary

- Status: Accepted
- Date: 2026-09-21

## Context

Premise collects execution coverage and calculates a fingerprint for a complete
Gherkin feature file. If that file contains multiple requirement IDs, assigning
the same artifact set and fingerprint to every ID creates false relationships:
an implementation exercised by one scenario appears to implement every
requirement in the file.

Premise could instead run Cucumber separately for each requirement tag and
fingerprint only the Gherkin selected by that tag. That would support multiple
requirements per file, but it would multiply runtime and require explicit
semantics for inherited tags, backgrounds, rules, examples, and shared
scenarios.

## Decision

For the current design, one `.feature` file is one requirement boundary. Premise
accepts at most one requirement ID in a feature file and rejects additional
IDs with a clear error.

## Consequences

- Compiled context cannot silently claim false per-requirement precision.
- Teams that need multiple requirements must split them into feature files.
- Per-tag execution and fingerprinting remain a deferred option tracked by
  [issue #1](https://github.com/stuplum/premise/issues/1).
- The decision should be reconsidered if real usage demonstrates that splitting
  feature files damages the readability or maintainability of the Gherkin.
