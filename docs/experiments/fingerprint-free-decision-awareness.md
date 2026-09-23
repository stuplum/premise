# Fingerprint-free decision awareness

## Question

Can Premise bring a relevant architecture decision back into an agent's context
when its driving Gherkin changes, without maintaining decision fingerprints or
generated decision state?

## Experiment

The experiment uses an ordinary Git working tree:

1. Discover Gherkin requirement IDs from configured feature paths.
2. Discover and parse `.decision` files.
3. Resolve every `Driven by requirement` reference against the discovered
   requirements.
4. Ask Git which tracked files differ from `HEAD`.
5. For each changed requirement, print every directly driven decision together
   with the complete live Gherkin and decision sources.

## Result

The mechanism works without fingerprints. A linked Gherkin change makes
`premise check` fail and provides both raw sources for reconsideration. Changing
an unrelated requirement does not surface the decision. No `.premise/decisions`
state is created.

This demonstrates deterministic knowledge discovery and context delivery. It
does not yet demonstrate that an agent will make a better architectural choice;
that requires a separate agent trial using this mechanism.

## Follow-up

The working-tree mechanism was useful for discovery but insufficient for
enforcement. It became clean immediately after a commit, could not prove review
in CI, and had no way to distinguish retaining a valid decision from forgetting
to reconsider it.

Premise now records a compact, committed review receipt for each active decision.
The receipt fingerprints the decision and its declared drivers; it is generated
state rather than agent context. This allows `premise check` to enforce review in
both dirty working trees and clean CI checkouts. The original experiment remains
documented here because it explains why the receipt mechanism was introduced.

## Boundaries

- Only tracked working-tree changes relative to `HEAD` are considered.
- Only direct requirement-to-decision relationships are followed.
- Decisions are authoritative choices, not mechanically evaluated premises.
- Existing implementation-context fingerprints remain in Premise but are not
  used by this experiment.
- Premise provider discovery and evaluation are not part of this slice.

## Next evidence needed

Run a blinded agent trial in which changed Gherkin invalidates an assumption in
a linked decision. Compare whether the agent reconsiders or supersedes the
decision when Premise supplies the linked raw sources versus when it receives only
the repository change.
