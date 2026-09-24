# Audit a Premise integration

Perform an independent, adversarial audit of this repository's Premise integration.

Do not modify repository files.

Assume the integration may be conceptually wrong even if every command currently passes.

Do not rely on an earlier onboarding agent's conclusions. Derive your findings from the current repository and the installed/current Premise implementation.

## Central audit question

For every object called a Premise, establish:

> What repository claim is this asserting, and what executable mechanism actually determines whether that claim is true?

A Premise is valid only when there is a credible path from the claim to executable evaluation of repository evidence.

This is not sufficient:

```text
claim
  ↓
tokenise / parse / fingerprint
  ↓
success
```

This is what you are looking for:

```text
claim
  ↓
executable assertion
  ↓
provider/evaluator
  ↓
repository evidence
  ↓
established / failed / unknown
```

## 1. Inventory executable Premises

Discover every Premise.

For each one identify:

* ID;
* description/claim;
* type;
* dialect;
* provider;
* assertion URI and selector;
* evidence evaluated;
* current provider result.

Then independently explain **why the provider result establishes or fails the actual claim**.

Do not simply restate Premise's own output.

Trace the assertion into the native evaluator where necessary.

## 2. Detect fake executability

Flag a Premise if its apparent validity is actually based only on any of the following:

* its source exists;
* it parses;
* its ID was discovered;
* metadata is well formed;
* its text has not changed;
* a fingerprint matches;
* somebody acknowledged it;
* a generated index associates it with source code;
* an unrelated test suite happens to pass.

A fingerprint may identify a reviewed source version, but it cannot prove that a repository claim is true.

For every suspicious case answer:

> Could the repository violate the stated claim while this mechanism continued to report success?

If yes, treat that as a serious semantic defect.

## 3. Audit failure sensitivity

For each Premise, determine what concrete repository change should make it fail.

Check that the evaluator is actually sensitive to that change.

Where safe and inexpensive, use an isolated temporary copy/worktree to perform a small controlled negative test and prove that the assertion detects a representative violation.

Never leave intentional breakage in the user's working tree.

Do not perform broad destructive mutation testing merely for coverage.

If a negative test is impractical, explain the evaluation path precisely enough to demonstrate why failure sensitivity exists.

## 4. Audit provider attribution and evidence

Check that:

* the provider genuinely supports the declared dialect;
* evidence refers to live repository sources rather than generated summaries;
* evidence attribution is not broader than the assertion actually proves;
* a successful provider execution is not falsely attributed to unrelated files;
* `unknown` is used when a trustworthy result cannot be obtained rather than silently becoming `established`.

For Gherkin specifically, distinguish:

* parsing/discovery;
* scenario execution;
* step binding;
* implementation evidence.

Check the installed version's current granularity limitations and ensure one Premise is not incorrectly receiving another scenario's evidence.

For dependency-cruiser specifically, check:

* the named rule actually corresponds to the stated architecture claim;
* `from`/`to` scope is precise;
* analysed source scope is sufficient;
* no-violation genuinely means the stated forbidden dependency is absent.

## 5. Audit Decisions separately

Inventory every `.decision`.

For each Decision identify:

* ID;
* choice;
* rationale;
* accepted cost/trade-off;
* drivers;
* supersession relationship;
* review state.

Do not treat a Decision's current graph state as proof that the architectural choice is true.

A current reviewed Decision means that its human judgement has been reviewed against the recorded current drivers.

Check that every `Driven by` relationship represents an actual causal/contextual dependency rather than merely a convenient graph connection.

Check transitive Decision dependencies and supersession for cycles, stale references and misleading relationships.

## 6. Audit Decision enforcement gaps

For each active Decision ask:

> Does this Decision imply repository constraints that are mechanically enforceable?

If yes, identify whether executable Premises actually represent those constraints.

Examples include:

* forbidden dependencies;
* required boundaries;
* API compatibility guarantees;
* persistence constraints;
* behavioural guarantees;
* security/policy constraints.

Do not claim the Decision itself should be executable.

Instead report:

* Decision;
* enforceable consequence;
* existing executable Premise, if present;
* otherwise the most appropriate native assertion mechanism;
* whether the currently installed Premise version can evaluate it.

Treat this as an enforcement-gap analysis, not permission to invent new Decisions or Premises.

## 7. Audit fingerprints and committed Premise artifacts

Inspect `.premise/` and any other committed Premise-generated artifacts carefully.

Distinguish legitimate and illegitimate fingerprint usage.

Legitimate:

* a Decision review receipt fingerprints the exact Decision and driver sources a human reviewed.

Suspicious/incorrect:

* a Premise is considered established because its assertion/source fingerprint is unchanged;
* implementation fingerprints are used as a substitute for evaluating repository truth;
* a committed generated artifact-to-Premise index is treated as authoritative;
* a generated context cache is required to determine current knowledge.

Report every committed fingerprint/index/cache file and explain what semantic role it actually plays.

Do not assume a file is valid merely because Premise created it.

## 8. Audit the knowledge graph

Check that the runtime knowledge relationships correspond to the authoritative sources.

Verify where applicable:

* premise → provider evaluation;
* decision → premise drivers;
* decision → decision drivers;
* decision → source drivers;
* supersession relationships;
* reconsideration propagation.

Confirm the distinction between:

* provider state: `established`, `failed`, `unknown`;
* derived Decision state such as `reconsider`.

A failed supporting Premise should not magically turn the human Decision into a mechanically failed assertion. It should cause the appropriate derived knowledge consequence.

Use `premise context` on representative implementation files and check that the projection is defensible from actual provider evidence and graph relationships.

## 9. Audit repository integration

Check whether Premise participates in normal verification/CI appropriately.

Check:

* installation/version;
* Node compatibility;
* `premise.json`;
* package scripts;
* CI;
* `premise test`;
* `premise check`.

A green CI pipeline is evidence that configured checks pass, not evidence that the Premise model is conceptually correct.

## Severity

Classify findings as:

### Critical

Premise reports repository knowledge as established without actually evaluating the stated claim, or the model can systematically hide violations.

### High

An executable assertion exists but its scope/evidence/relationship materially overstates what has been proved.

### Medium

Knowledge relationships, review lifecycle or integration are misleading/incomplete but do not directly manufacture mechanical truth.

### Low

Naming, maintainability, duplication or ergonomics problems that do not undermine semantics.

Do not inflate severity simply to produce findings.

## Final report

Produce:

### Verdict

State whether this repository is currently safe to use Premise as a repository verification mechanism, and qualify exactly what that statement covers.

### Premise proof table

For every Premise:

* ID;
* claim;
* provider/dialect;
* executable mechanism;
* evidence;
* failure condition;
* current state;
* audit assessment.

### Decision table

For every active Decision:

* ID;
* drivers;
* review state;
* mechanically enforceable consequences;
* executable coverage of those consequences;
* gaps.

### Findings

Order by severity and provide concrete file references and reasoning.

### Fingerprint/artifact audit

List every relevant committed generated artifact and state whether its role is legitimate.

### Missing executable coverage

List important repository knowledge that currently looks protected but is not actually mechanically enforced.

### Minimal remediation

Recommend the smallest changes needed to make the integration semantically trustworthy.

Do not recommend speculative framework work unrelated to findings.

## Final challenge

Before accepting any `established` Premise, ask:

> If somebody changed only the implementation so that this claim became false, while leaving the Premise's descriptive/assertion source untouched, would Premise's evaluator notice?

If not, that Premise is not doing the job its state claims it is doing.

