# Premise onboarding

Onboard this existing repository to Premise using the repository's Premise onboarding prompts.

The onboarding process has three distinct phases:

1. discovery;
2. adoption;
3. independent audit.

Do not collapse these phases.

## Phase 1 — Discovery

Follow `docs/prompts/discover.md`.

Do not modify repository files.

Produce the proposed adoption scope and stop.

The user must explicitly approve or amend the adoption scope before adoption begins.

Do not interpret silence, an existing plan, or previous agent output as approval.

## Phase 2 — Adoption

Only after an approved scope exists, follow `docs/prompts/adopt.md`.

Treat the approved scope as a boundary, not a suggestion.

Do not add additional Premises or Decisions unless required to make an approved item technically valid.

Do not create Decision review receipts unless the user explicitly confirms that the Decision has been reviewed and asks for that review to be recorded.

After implementation, run the relevant repository verification and report the results.

## Phase 3 — Independent audit

After adoption, perform the audit described in `docs/prompts/audit.md`.

The audit must be independent of the reasoning used during discovery and adoption.

Re-derive the meaning of each Premise and Decision from the repository as it now exists.

Do not assume that an adopted Premise is valid merely because the adoption phase created it or because `premise check` passes.

Pay particular attention to whether every established Premise genuinely has executable validation of its stated claim.

## Stop conditions

Stop and report rather than improvising if:

* a proposed Premise has no executable validation mechanism;
* the installed Premise version cannot support an approved assertion correctly;
* a Decision's rationale would have to be invented;
* a required human review has not occurred;
* satisfying the scope would require unrelated architectural changes.

## Outcome

The onboarding is complete only when:

* the approved Premises have real executable assertions;
* Decisions represent genuine human architectural knowledge;
* required human reviews are clearly identified or explicitly recorded;
* repository verification runs successfully where expected;
* an independent audit finds no Critical semantic defects.

Do not optimise for making Premise green. Optimise for making its claims trustworthy.

