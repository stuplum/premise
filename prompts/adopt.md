# Adopt Premise into an existing repository

Integrate Premise into this repository using the human-approved adoption scope supplied with this task.

Do not expand that scope merely because additional candidates are visible.

If no approved discovery/adoption scope has been supplied, do not invent one and do not modify the repository.

## Objective

Create the smallest correct Premise integration that makes the approved repository knowledge mechanically useful.

The goal is not to maximise the number of Premise artifacts. The goal is to ensure that every adopted Premise has a genuine executable assertion and every adopted Decision records real human-authored architectural knowledge.

Preserve the repository's existing tools and conventions wherever possible.

## Non-negotiable semantics

### Premises must be executable

For every Premise you introduce, there must be a real evaluation path:

```text
repository claim
      ↓
native assertion
      ↓
provider/evaluator
      ↓
repository evidence
      ↓
established / failed / unknown
```

Do not substitute any of the following for executable validation:

* content fingerprints;
* timestamps;
* acknowledgement records;
* generated metadata;
* parsing success;
* existence of an ID;
* existence of an assertion file;
* a generated index describing what ought to be true.

A changed assertion that still evaluates successfully remains established.

A repository violation must be capable of making the assertion fail.

### Decisions remain human judgement

Do not turn a Decision itself into a synthetic executable test.

A Decision can record:

* a choice;
* rationale;
* accepted cost;
* drivers;
* supersession history.

Mechanically enforceable consequences should be separate executable Premises.

Do not fabricate rationale from the current implementation.

Only create or migrate a Decision when the approved adoption scope identifies authoritative evidence for it.

### Review receipts mean actual review

`.premise/reviews/` contains receipts proving that a particular Decision was explicitly reviewed against particular versions of its drivers.

Those fingerprints are legitimate because they establish the identity of material reviewed by a human.

They do **not** establish repository truth.

Do not run `premise review <decision-id>` merely to make `premise check` green.

Unless this task explicitly says the human has reviewed a particular Decision and asks you to record that review, leave it requiring review and report the exact review command to the user.

## Integrate with the repository, not against it

Use the repository's existing package manager, module system, test runner, TypeScript configuration and verification conventions.

Install `@stuplum/premise` as a development dependency if it is not already present.

Check the installed Premise version and its documentation rather than assuming capabilities beyond that version.

Premise currently requires Node.js 20 or newer. If the repository cannot satisfy that requirement, report the incompatibility rather than altering unrelated runtime requirements without approval.

Use `premise.json` only when the repository layout requires configuration. Prefer defaults when they fit.

Do not create generated artifact-to-Premise indexes or committed context caches.

## Gherkin / Cucumber adoption

Use Gherkin only where it is an appropriate executable expression of behaviour.

Do not rewrite arbitrary unit tests into Gherkin merely so they can become Premises.

For an approved Gherkin Premise:

* use a stable Premise ID;
* ensure its scenarios execute real behaviour;
* ensure step definitions are actual executable bindings rather than placeholders;
* preserve meaningful existing Cucumber conventions;
* use the Premise-provided Cucumber integration where required by the installed version.

Respect the current Gherkin granularity supported by the installed Premise version. If it currently supports only one Premise ID per feature file, do not work around that limitation with misleading attribution.

A successful parse is not an established behavioural Premise. The scenarios must execute successfully.

## dependency-cruiser adoption

For an approved architecture dependency Premise:

* prefer an existing dependency-cruiser configuration if present;
* create the smallest precise forbidden rule representing the approved claim;
* use the stable Premise ID as the rule name;
* give the rule a comment that states the architecture constraint;
* ensure the `from`, `to` and analysis scope match the actual claim;
* avoid rules so broad that passing them does not meaningfully establish the stated constraint.

Verify that a genuine prohibited dependency would be reported by dependency-cruiser.

Do not describe architecture as established merely because the configuration file parses.

## Decisions

For each approved Decision:

* preserve or accurately transcribe the authoritative choice;
* preserve documented rationale rather than generating plausible rationale;
* preserve documented trade-offs;
* connect only genuine known drivers;
* use `Driven by premise`, `Driven by decision` or `Driven by source` according to the actual relationship;
* preserve existing history and supersession rather than rewriting it.

If a Decision has an important mechanically enforceable consequence that is not represented by an approved executable Premise, report that as an enforcement gap. Do not silently invent additional scope.

## Verification

After making the approved changes:

1. run the repository's existing relevant verification;
2. run `premise test` where appropriate;
3. run `premise check`;
4. exercise `premise context <relevant-artifact>` for representative adopted Premises;
5. confirm failures are attributable to genuine assertion evaluation rather than stale generated metadata.

Where practical, verify that each introduced assertion is capable of detecting the violation it claims to detect. Do this without leaving intentional breakage in the repository.

Integrate `premise check` into the repository's normal verification/CI path only if that is part of the approved adoption scope. Keep the change minimal and consistent with existing conventions.

## Repository hygiene

Expected committed Premise-related artifacts may include:

* `**/*.decision`;
* native executable assertion sources such as `.feature` files or dependency-cruiser rules;
* `premise.json` when configuration is required;
* `.premise/reviews/` after explicit human Decision review.

Do not commit:

* generated Premise state;
* artifact-to-Premise indexes;
* premise fingerprints used as validity;
* generated explanations of source files;
* caches masquerading as authoritative knowledge.

## Final audit before finishing

For every adopted Premise, write down:

* claim;
* Premise ID;
* type;
* dialect;
* provider;
* assertion source;
* repository evidence evaluated;
* exact condition that causes failure.

If you cannot provide all of those, the integration is incomplete.

For every adopted Decision, write down:

* choice;
* authoritative source/rationale;
* drivers;
* current review state;
* executable Premises, if any, that enforce consequences of the choice.

Do not describe a reviewed Decision as mechanically proved.

## Final response

Report:

1. files changed;
2. Premises adopted and exactly how each is established;
3. Decisions adopted and their drivers;
4. verification commands and results;
5. Decisions still requiring explicit human review;
6. enforcement/provider gaps deliberately left unresolved;
7. any behaviour you intentionally did not model and why.

Be concise but precise. Do not hide conceptual gaps behind a green test suite.

