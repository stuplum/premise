# Premise repository discovery

Analyse this existing repository for potential adoption of Premise.

Do not modify any repository files.

Your job is to discover repository knowledge worth preserving and determine which parts can already be established mechanically. Do not try to maximise the number of Premises or Decisions you find.

## Core model

Use these definitions strictly.

### Premise

A Premise is a repository claim whose truth can be attempted mechanically through an executable assertion.

A Premise is not merely:

* a statement with an ID;
* a successfully parsed file;
* a convention inferred from directory layout;
* documentation that says something should be true;
* a fingerprint proving that some text has not changed;
* a test file merely because tests are executable.

For every candidate Premise, you must be able to answer:

> What executable mechanism evaluates this specific claim, and what repository condition would cause that mechanism to fail?

If you cannot answer that, it is not yet an executable Premise.

Premise provider results have three meanings:

* `established`: the assertion was evaluated and the claim held;
* `failed`: the assertion was evaluated and the claim did not hold;
* `unknown`: the provider could not obtain a trustworthy result.

Parsing or locating the assertion does not establish its truth.

### Decision

A Decision records a human architectural choice, its rationale, accepted costs and relationships to the knowledge that motivated it.

A Decision is not itself a mechanically evaluated Premise.

Do not infer a Decision merely because the repository currently uses a particular library, directory structure, database, framework or pattern. Current implementation is not automatically evidence that somebody deliberately chose it for a particular reason.

Prefer existing ADRs, design documents, comments, commit-visible documentation or other explicit rationale.

### Relationship between them

A Decision may be driven by Premises, other Decisions or repository sources.

Mechanically enforceable consequences of a Decision should be represented by executable Premises rather than pretending that the human judgement itself can be tested.

Do not invent a new Premise-specific assertion language when an established tool can express the assertion.

## Current Premise capabilities

Treat the installed/current Premise version as authoritative if its documentation differs from this prompt.

At the current implementation boundary, the built-in executable providers are:

* Gherkin evaluated through Cucumber;
* forbidden dependency rules evaluated through dependency-cruiser.

Architecture Decisions use `.decision` files and explicit review receipts.

Other useful assertion mechanisms such as OpenAPI, JSON Schema, Semgrep, Rego, ArchUnit or project-specific validators may be identified as future/provider candidates, but do not claim they are currently supported unless this repository's installed Premise version actually supports them.

## Investigation

First understand how this repository already verifies itself.

Inspect, where relevant:

* package/build configuration;
* normal verification scripts;
* CI workflows;
* unit, integration, acceptance and end-to-end tests;
* Gherkin features and Cucumber configuration;
* dependency-cruiser or equivalent architecture rules;
* API/schema definitions;
* lint/static-analysis rules;
* ADRs and architecture documentation;
* design documents;
* important code comments explaining *why*;
* module/package boundaries;
* public interfaces and integration boundaries.

You may run safe, non-mutating repository commands when useful to establish how existing checks behave.

Do not change files simply to test a theory during this discovery pass.

## Candidate classification

Classify useful knowledge into one of these categories.

### A. Existing executable Premise

The repository already contains an executable mechanism that genuinely evaluates the claim.

For each one identify:

* candidate stable ID;
* concise claim;
* Premise type;
* assertion dialect;
* evaluator/provider;
* exact existing assertion source;
* repository evidence it evaluates;
* what concrete violation would make it fail.

Do not classify something as executable merely because a generic test suite would happen to fail after some unrelated change. There must be a defensible relationship between the claim and the assertion.

### B. Potential executable Premise

The claim appears important and mechanically testable, but a suitable assertion does not currently exist or Premise does not currently have a provider for its native mechanism.

Identify:

* the claim;
* why it appears intentional;
* the most appropriate established assertion mechanism;
* whether that mechanism already exists in the repository;
* what work would be required to make it executable through Premise.

Prefer native tools over inventing a DSL.

### C. Decision

There is actual evidence of a human architectural choice and rationale.

Identify:

* the choice;
* rationale;
* accepted cost/trade-off if documented;
* source;
* likely drivers;
* any consequences that appear mechanically enforceable.

Do not manufacture rationale that is not present in the repository.

### D. Documentation/context only

Useful information exists, but it is neither an executable claim nor a clearly evidenced architectural decision.

Keep it as documentation unless there is a concrete reason to model it differently.

### E. Uncertain

There is insufficient evidence to determine intent or appropriate classification.

Say what is missing rather than guessing.

## Avoid false knowledge

Be particularly suspicious of claims derived solely from:

* current folder structure;
* one implementation instance;
* naming conventions;
* framework defaults;
* generated files;
* package presence;
* old documentation contradicted by current code;
* tests whose purpose is unrelated to the proposed claim.

Do not convert every invariant you can imagine into a Premise.

Premise should preserve consequential repository knowledge, not describe the entire program.

## Adoption scope

After discovery, propose the smallest useful first adoption.

Prefer approximately 3–8 high-value executable Premises and only clearly evidenced Decisions rather than attempting complete repository coverage.

The first slice should exercise real knowledge relationships and produce useful failure behaviour with minimal new machinery.

If there is no good candidate for a particular Premise type, say so.

## Output

Produce these sections:

### 1. Repository verification model

Briefly explain how this repository currently establishes correctness.

### 2. Existing executable Premise candidates

For each candidate show:

* proposed ID;
* claim;
* type;
* dialect;
* existing evaluator;
* assertion source;
* failure condition;
* confidence and evidence for intentionality.

### 3. Potential executable Premises

Show the same information, plus what is currently missing.

### 4. Decision candidates

For each Decision show:

* proposed ID;
* choice;
* documented rationale;
* documented trade-off if any;
* source;
* likely drivers;
* potentially enforceable consequences.

Clearly mark anything inferred rather than documented.

### 5. Things that should NOT become Premises or Decisions

Call out tempting but unjustified candidates and explain why.

### 6. Minimal adoption proposal

Propose the smallest useful set to adopt first and explain why those items provide meaningful coverage.

### 7. Unsupported/provider opportunities

List valuable mechanically testable knowledge for which the current Premise installation has no suitable provider.

Do not implement those providers.

## Final rule

For every proposed executable Premise, challenge yourself with:

> If the repository violated this claim tomorrow without modifying the assertion text, would the proposed evaluator detect it?

If the answer is no, do not call it an executable Premise.

