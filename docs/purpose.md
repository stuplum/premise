# Why Premise exists

**Premise exists to make the conditions supporting a decision mechanically
checkable, expose when they no longer hold, and preserve the decision when it
is replaced.**

Code can still obey a decision after a new requirement makes that decision
unsuitable. Keeping documentation consistent with code is not enough.

This document states product intent, not a claim that the complete lifecycle is
implemented. Use it to judge proposed work. The [product model](design/product-model.md)
records the design and current implementation boundary.

## The problem

Coding agents can treat an existing architectural decision as something to
preserve, bending a new implementation around it instead of recognising that
the requirements have changed. When challenged, they can rewrite the old decision
to match the new implementation, losing the earlier reasoning as an explicit
checkpoint.

More prose does not fix either failure. A claim that an agent can simply ignore
is not an enforced constraint. Equally, enforcing the consequences of an old
decision must not turn that decision into a permanent obstacle to new requirements.

## The defining example

A service fetches data from several upstream APIs and combines their responses.
The team decides against local persistence because the required queries can be
satisfied this way, without consumers, synchronisation or a local replica.

Later, users need filtering and sorting across the combined dataset. The current
upstream-access approach cannot satisfy those requirements within the required
constraints.

The implementation may still conform perfectly to the old decision. A check that
there is no local database could still pass. But the supporting claim, **“this
approach satisfies the required query behaviour”**, no longer holds.

Premise must make that change actionable:

1. The changed requirement has an executable assertion, not just a prose description.
2. Before implementation changes, evaluation exposes the unmet requirement through
   an explicitly linked supporting premise.
3. The affected decision requires reconsideration, with the failed claim and
   evidence available to the reviewer.
4. If the team chooses a local query model, a new decision supersedes the old one
   and records the new costs, including persistence and synchronisation.
5. The previous decision and the context that justified it remain available.
   Checks specific to the retired choice do not unconditionally block its replacement.

The old decision was not necessarily wrong. It was reasonable under conditions
that have changed. Premise must preserve that distinction, not choose the new
architecture on the team's behalf.

## Principles

- **Intent precedes implementation.** Assertions should express what must be true,
  independently of the application code chosen to satisfy them. Gherkin is useful
  because behaviour can be specified without writing that implementation first.
- **Enforcement needs executable evidence.** A statement, diagram or capability
  label is not enforced merely because it exists. An evaluator must be able to
  detect a relevant violation and explain what it checked. Unknown is not success;
  an empty or unrelated check is not evidence for the claim.
- **Justification and conformance are different.** Check both whether code follows
  a decision and whether the conditions supporting that decision still hold.
  A newly required capability can invalidate the justification before code drifts.
- **Decisions remain judgement.** Explanatory rationale can be valuable without
  being mechanically provable. Preserve it as reasoning, not as a supposedly
  enforced premise. Failed premises demand reconsideration, not an automatic redesign.
- **Changed decisions preserve history.** Reaffirm an unchanged choice when it
  remains justified. Record a replacement as a new decision, rather than rewriting
  the old choice and treating it as though it had always applied.
- **Choose tools for the claims they express and enforce.** Architectural and domain
  assertions should carry the intended concepts, not merely low-level restrictions
  with explanatory prose attached. Existing integrations do not determine product scope.

## How to judge the next change

Before choosing a provider, format or feature, identify:

- the claim it makes mechanically checkable;
- the requirement or repository change that should make that claim fail;
- the evidence distinguishing success, violation and inability to evaluate;
- the decision affected, and how reconsideration and replacement preserve its history.

If we cannot demonstrate that connection, we have added tooling or documentation,
not yet demonstrated the reason Premise exists.
