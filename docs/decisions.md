# Architecture decisions

Premise represents architecture decisions as human-authored `.decision` files.

Decisions are part of the repository knowledge graph, but they are not executable Premises.

Premise does not attempt to mechanically prove that a human architectural judgement is correct.

Instead it tracks:

* the choice;
* its rationale;
* accepted costs;
* the knowledge that drove it;
* supersession history;
* whether it has been reviewed against its current drivers.

## Format

A minimal decision looks like:

```text
Decision ARCH-001 "Keep domain independent of HTTP"
Driven by premise BEHAVIOUR-001
Choose keep domain code independent of HTTP infrastructure
Because domain behaviour should not depend on its delivery mechanism
Accept mapping is required at the HTTP boundary
```

The statement order is significant.

A decision contains:

```text
Decision <id> "<title>"
Driven by <kind> <id>
[Driven by <kind> <id> ...]
Choose <choice>
Because <rationale>
[Accept <cost> ...]
[Supersedes <decision-id>]
```

At least one `Driven by` statement is required.

`Choose` and `Because` are required.

`Accept` may appear zero or more times.

`Supersedes` is optional.

Blank lines are ignored.

## Drivers

A decision can currently be driven by a Premise:

```text
Driven by premise ORDER-006
```

another decision:

```text
Driven by decision OPS-002
```

or a repository source:

```text
Driven by source requirements/order-confirmation.md
```

The compatibility form:

```text
Driven by requirement ORDER-006
```

is accepted and normalized internally to:

```text
Driven by premise ORDER-006
```

New decisions should use `premise`.

## What `Driven by` means

A driver represents knowledge that materially supports the decision.

For example:

```text
ORDER-006
"Accepted orders survive delivery failure"
        │
        │ drives
        ▼
ORDER-002
"Use durable confirmation storage"
```

Do not add a driver simply because two repository artifacts are related.

If changing the driver would not reasonably cause the decision to be reconsidered, it probably should not be a driver.

## Review lifecycle

After creating or reconsidering an active decision, record the review:

```sh
premise review ORDER-002
```

Premise writes a receipt under:

```text
.premise/reviews/
```

The receipt records:

* the decision identity and source fingerprint;
* each driver identity and source fingerprint.

This establishes:

> This human decision was reviewed against these exact versions of its declared drivers.

It does not establish:

> The architecture described by the decision has been mechanically proven.

Those are different claims.

## When a decision requires reconsideration

A decision is reported as `reconsider` when its current review can no longer be trusted.

This includes:

* the decision source changed;
* one of its driver sources changed;
* an executable Premise driver failed;
* an executable Premise driver became unknown;
* a decision driver itself requires reconsideration.

For example:

```text
ORDER-006 FAILED
      │
      ▼
ORDER-002 RECONSIDER
```

This does not mean `ORDER-002` mechanically failed.

It means the knowledge supporting the human decision has changed or can no longer be established.

## Reconsidering a decision

Run:

```sh
premise check
```

For a decision requiring reconsideration, Premise prints:

* the reasons;
* current driver sources;
* the current decision source.

After reconsidering it, either:

### Retain the decision

If it remains valid:

```sh
premise review ORDER-002
```

Commit the updated receipt.

### Replace the decision

If the old choice no longer applies, preserve it as history and create a new decision:

```text
Decision ORDER-003 "Alternative confirmation delivery"
Driven by premise ORDER-006
Choose use the new delivery architecture
Because the operating assumptions have changed
Accept migration complexity
Supersedes ORDER-002
```

Then review the new active decision.

## Supersession

Decisions are preserved as repository history.

A newer decision may supersede an older one:

```text
Supersedes ORDER-002
```

Premise validates the supersession graph and prevents invalid histories such as a decision superseding itself.

Only active, non-superseded decisions participate as current architectural knowledge.

## Decisions and executable enforcement

A decision may imply constraints that can be checked mechanically.

For example:

```text
Decision ARCH-001 "Keep domain transport-independent"
...
```

may imply:

```text
Domain code must not import HTTP infrastructure.
```

The decision itself should remain human judgement.

The enforceable repository constraint should be represented by an executable Premise using an appropriate native assertion mechanism, such as dependency-cruiser.

Do not turn `Choose`, `Because` or `Accept` statements into synthetic tests merely to make the decision executable.

## Review receipts

Review receipts belong in version control.

They are intentionally small and represent an explicit human review event.

Fingerprints are appropriate here because their purpose is source identity:

```text
reviewed decision version
+
reviewed driver versions
```

Fingerprints must not be used as a substitute for executable Premise evaluation.

