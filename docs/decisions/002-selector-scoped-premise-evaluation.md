---
status: accepted
date: 2026-09-25
deciders: [Stuart Plumbley]
---

# ADR 002: Evaluate each Gherkin premise through its tag selector

## Context

A feature file can express several independently identified claims. Whole-file
execution cannot distinguish their outcomes or implementation evidence, and
requiring one ID per file makes an execution limitation dictate how authors
organise Gherkin. Discovery now retains the official AST's declarations and
the scenarios or outline rows selected through inherited tags.

## Options considered

### Keep the file-level boundary

- Good: one baseline and execution pair per file, with simple attribution.
- Bad: authors must split otherwise valid features to express separate claims.

### Execute each premise's selector independently

- Good: native Gherkin tag semantics determine scope, including rules,
  backgrounds and examples; outcomes and coverage belong to the selected claim.
- Bad: overlapping premises repeat execution and increase runtime.

### Partition coverage from one shared execution

- Good: scenarios execute once even when they support several claims.
- Bad: requires trustworthy per-scenario coverage and hook attribution that the
  current process-level coverage mechanism does not provide.

## Decision

Run a separate dry run and real execution using the same tag selector for each
premise. Preserve the feature URI and stable tag as its assertion reference.
The explicit declaration identifies the premise; inherited tags determine its
selected scenarios and outline rows. Backgrounds run with the selected cases.

Accept repeated execution rather than falsely associating another premise's
outcome or artifacts with the selected claim. Different IDs may intentionally
share scenarios, while duplicate declarations of the same ID remain invalid.

## Consequences

- Good: multiple claims can coexist in one feature without sharing unrelated
  outcomes or execution evidence.
- Cost: execution scales with the number of premises, not just feature files.
- Cost: untagged scenarios in a tagged file are outside premise evaluation unless
  selected by an ancestor tag; an ordinary Cucumber run still executes them.
- Revisit when: reliable per-scenario coverage can preserve this attribution
  contract without repeated execution.

## References

- Supersedes: [ADR 001](001-feature-file-requirement-boundary.md)
- [Issue 5](https://github.com/stuplum/premise/issues/5)
- [Issue 17](https://github.com/stuplum/premise/issues/17)
