# Premise

**Links architecture decisions to the results of a repository's own checks.**

Premise reads the JUnit, Cucumber JSON and dependency-cruiser reports a repository already produces, matches them by ID to decisions written as YAML ADRs, and reports each decision as `holds`, `violated`, `reconsider` or `stale`. It runs no tests. Every outcome is a function of committed files and reports; nothing is left to a coding agent's judgement.

- **Conformance:** an `enforced_by` check failing means the code no longer follows the decision.
- **Justification:** a `supported_by` check failing or disappearing means the reasons for the decision no longer hold.
- **Drift:** a linked check whose meaning changed since the decision was last signed off needs a human, or a configured classifier, to confirm the decision still stands.

Start with [Why Premise exists](docs/purpose.md).

> Experimental `0.3` software. Requires Node.js 22+.

## Install

```sh
pnpm add --save-dev @stuplum/premise
```

## Commands

```sh
premise check                    # state of every accepted decision
premise refresh ADR-001          # write a decision's fingerprints after review
premise signoff --base main      # classifier sign-off for changed fingerprints, in CI
premise context src/domain/a.ts  # decisions that govern a file
premise render --out docs/adr    # Markdown views of every ADR
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Reference](docs/reference.md)
- [Why Premise exists](docs/purpose.md)
- [Experiment results](docs/experiments/decision-enforcement-matrix.md)
- [Contributing](CONTRIBUTING.md)
