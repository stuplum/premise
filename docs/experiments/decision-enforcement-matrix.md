# Decision-enforcement matrix

## Question

Does Premise add anything beyond ordinary requirements or Gherkin when an agent
must implement a change that invalidates an accepted architecture decision?

## Design

Twelve fresh agents received the same task across a two-by-two matrix, with
three runs per condition:

| Condition | Gherkin | Premise enforcement |
| --- | --- | --- |
| Bare | No | No |
| Gherkin only | Yes | No |
| Premise only | No | Yes |
| Premise + Gherkin | Yes | Yes |

The repositories shared the same implementation, tests, requirement semantics,
accepted synchronous-delivery decision, unrelated code, and distracting
documentation. Agents were not told to inspect ADRs, run Premise, or supersede a
decision. In Premise conditions, the normal test command invoked `premise check`
and the changed driver made its committed review receipt stale.

## Result

| Condition | Behaviour passes | Decision reconsidered | Consistent supersession | Mechanically verified |
| --- | ---: | ---: | ---: | ---: |
| Bare | 3/3 | 3/3 | 3/3 | 0/3 |
| Gherkin only | 3/3 | 3/3 | 2/3 | 0/3 |
| Premise only | 3/3 | 3/3 | 3/3 | 3/3 |
| Premise + Gherkin | 3/3 | 3/3 | 3/3 | 3/3 |

The inconsistent Gherkin-only run added a replacement ADR saying it superseded
the original but left the original ADR marked Accepted. The repository's tests
still passed. Every Premise run added a valid superseding `.decision`, generated
the active decision's review receipt, and passed the same normal verification
command.

## Finding

The experiment does not show that Premise improves an agent's implementation
reasoning. All conditions implemented the behaviour successfully, and all
agents noticed the conflicting decision in this deliberately small fixture.

It does show a narrower, useful advantage: Premise makes decision consistency a
mechanically checked repository property. Gherkin remains valuable as a
business-readable executable requirement format, but did not enforce the
decision lifecycle. Premise provided the same enforcement when the driver was an
ordinary Markdown requirement, so Gherkin is an adapter rather than a core
dependency.

## Limits and next evidence

Three repetitions per condition are not statistically strong, and the fixture
is smaller and cleaner than the mature repositories that motivated Premise. The
next trial should reuse this matrix against a real change in a documentation-
heavy repository where the relevant decision is difficult to discover. Token
usage was unavailable and should be captured if a future runner exposes it.
