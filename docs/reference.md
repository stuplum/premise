# Reference

## `premise.yaml`

```yaml
decisions: decisions                 # directory of <ID>.yaml ADRs
reports:                             # globs; each must match at least one file
  - format: junit                    # junit | cucumber-json | dependency-cruiser
    path: reports/*.xml
gherkin: features/**/*.feature       # optional; where tagged scenarios live
dependency_cruiser_config: .dependency-cruiser.json   # optional; must be JSON
signoff:                             # optional; default shown
  default: human
  allowed: [human]                   # human | none | classifier:<name>
classifiers:                         # optional
  jev:
    adapter: jev
    model: jev-1.13.0
    thresholds: { established: 0.8, failed: 0.2 }
  local:
    adapter: command
    command: ["./scripts/judge"]
    model: my-model
    thresholds: { established: 0.9, failed: 0.1 }
```

Schema: `schema/config.schema.json`. Unknown keys are errors. Every `classifier:<name>` in `allowed` needs a matching classifier, and `failed` must be below `established`.

## Decision records

One YAML file per decision, named `<id>.yaml`. Schema: `schema/decision.schema.json`.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Matches `^[A-Za-z][A-Za-z0-9_.-]*$` and the file name |
| `title`, `date`, `context` | yes | `date` is `YYYY-MM-DD` |
| `status` | yes | `proposed`, `accepted` or `superseded` |
| `options` | yes | `name`, optional `pros` and `cons` |
| `decision` | yes | One of the option names |
| `because` | yes | At least one reason |
| `consequences` | yes | May be empty |
| `scope` | no | Globs of files the decision governs; each must match a file |
| `supported_by` | no | Links `{ check, fingerprint }` whose results justify the decision |
| `enforced_by` | no | Links `{ check, fingerprint }` whose results show the code conforms |
| `signoff` | no | Overrides `signoff.default` |
| `supersedes` | no | The ID of a decision with `status: superseded` |

Only `accepted` decisions are evaluated.

## Check IDs in reports

| Format | ID source | Outcome |
|---|---|---|
| `junit` | `@<ID>` tokens in the test case name | `failure`/`error`: failed. `skipped`: skipped. Otherwise passed |
| `cucumber-json` | `@<ID>` scenario tags | Any step failed: failed. All passed: passed. Otherwise skipped |
| `dependency-cruiser` | Rule `name` | Violated: failed. Otherwise passed |

Matching is exact on whole tokens. A check is `failed` if any matched case failed, `unknown` if no report contains it, any matched case was skipped, or a dependency-cruiser report has unresolved imports, uses `includeOnly` or `exclude`, ignores known violations, or the rule's severity is `ignore`. Otherwise it is `passed`. Cucumber hook results, and background steps reported as a separate element, count towards the scenario that runs them.

## Fingerprints and drift

Each link has `check` and, once signed, `fingerprint`: `sha256:` and the hex SHA-256 of the check's normalised text. `premise refresh <ID>` writes them, preserving the rest of the file. A link has drifted when it has no fingerprint, its text cannot be found, or its current fingerprint differs.

| Source, first match wins | Normalised text |
|---|---|
| Gherkin scenarios tagged `@<ID>` | Steps with background and example values, tables and doc strings. Names, comments and formatting are ignored |
| dependency-cruiser rule, from `dependency_cruiser_config` when set, otherwise from the report | `name`, `severity`, `from`, `module`, `to`, key-sorted. `comment` is ignored |
| Test files named by JUnit `file` or `classname` | File contents with trailing whitespace and blank lines removed |

### Recovering the signed text

When a fingerprint has changed, Premise finds the commit that added it to the ADR (`git log -S`), rebuilds the text from that commit's files, and accepts it only if it hashes to the stored fingerprint. `check` shows it beside the current text; `signoff` sends both to the classifier.

Recovery fails, and a human must sign off, when history is shallow or rewritten, a test file has moved, or a rule is not in a JSON `dependency_cruiser_config`. Premise never executes a JavaScript config.

## Decision states

| State | Condition |
|---|---|
| `violated` | An `enforced_by` check failed |
| `reconsider` | A `supported_by` check failed or is unknown, or an `enforced_by` check is unknown |
| `stale` | A link has drifted |
| `holds` | None of the above |

`premise check` exits `0` when every decision holds or is stale with `signoff: none`, `1` otherwise, and `2` on configuration or report errors.

## Sign-off

- `human`: run `premise refresh`; the ADR change in the PR is approved by the decision's owners through CODEOWNERS and branch protection. Route each `decisions/<ID>.yaml` to its owners.
- `none`: a stale decision is a warning.
- `classifier:<name>`: `premise signoff --base <ref>` in PR CI sends the decision's `title`, `context`, `because` and the signed and current text of each changed link to the classifier. A probability at or above `established` passes; at or below `failed` means reconsider; anything else, an unavailable classifier, or signed text that cannot be recovered needs a human. Make the job a required check and check out full history.

`signoff` trusts only the base branch: the decision's sign-off mode, status and reasons, and the classifier's configuration, come from `<ref>`. A pull request that changes any of these, removes or moves a signed link, or adds or deletes a classifier-signed decision needs a human.

### Adapters

- `jev`: needs `TYPESAFE_AI_API_KEY`. The model must be pinned as `jev-N.N.N`.
- `command`: runs `command` with `{ question, decision, changes, model }` as JSON on stdin and expects `{ "model": "<model>", "probability": <0..1> }` on stdout within 10 seconds and 1 MiB. On timeout, the command and every process it started are stopped.

## Commands

| Command | Does | Exits |
|---|---|---|
| `premise check` | Prints every accepted decision's state and links | `0` all hold (or stale with `signoff: none`), `1` otherwise |
| `premise refresh <ID>` | Writes current fingerprints into a decision; refuses while a link fails, is unknown or has no text | `0` written, `1` refused |
| `premise signoff --base <ref>` | Runs classifiers for fingerprints that changed since `<ref>` in classifier-signed decisions | `0` every outcome passed, `1` otherwise |
| `premise context <file>` | Lists accepted decisions whose `scope`, or linked dependency-cruiser rule `from` paths, match the file | `0` |
| `premise render --out <dir>` | Writes `<ID>.md` for every decision | `0` |

Every command exits `2` on usage, configuration or report errors, including a `decisions` directory that does not exist.
