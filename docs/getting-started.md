# Getting started

## 1. Install

```sh
pnpm add --save-dev @stuplum/premise
```

Requires Node.js 22 or later.

## 2. Produce reports

Premise reads reports your checks already produce. Put the check ID in the test name or tag.

| Tool | Report | Example |
|---|---|---|
| `node:test` | `junit` | `node --test --test-reporter=junit --test-reporter-destination=reports/unit.xml` with tests named `@PAY-001 ...` |
| cucumber-js | `cucumber-json` | `cucumber-js --format json:reports/cucumber.json` with scenarios tagged `@PAY-001` |
| dependency-cruiser | `dependency-cruiser` | `depcruise src --output-type json --output-to reports/depcruise.json` |

Any runner that writes JUnit with `@<ID>` tokens in test names works. `premise check` and `premise signoff` read git history, so CI must check out full history.

## 3. Configure

```yaml
# premise.yaml
decisions: decisions
reports:
  - format: junit
    path: reports/unit.xml
  - format: dependency-cruiser
    path: reports/depcruise.json
dependency_cruiser_config: .dependency-cruiser.json
```

`dependency_cruiser_config` must be a JSON file. With it, Premise can show how a rule changed and a classifier can sign rule changes off. Without it, or with a `.js` config, rule changes still make a decision stale, but only a human can sign them off.

Any import dependency-cruiser cannot resolve makes every rule `unknown`, because a rule cannot see an import it could not resolve. Packages that publish only an `exports` map, such as `tsx`, need these options:

```json
"options": {
  "doNotFollow": { "path": "node_modules" },
  "enhancedResolveOptions": {
    "exportsFields": ["exports"],
    "conditionNames": ["import", "require", "node", "default"],
    "extensions": [".ts", ".js", ".mjs", ".cjs", ".d.ts"]
  }
}
```

## 4. Record a decision

```yaml
# decisions/ADR-001.yaml
id: ADR-001
title: Keep the domain free of database clients
status: accepted
date: 2026-10-25
context: |
  Domain code is tested without infrastructure.
options:
  - name: Domain depends on ports only
decision: Domain depends on ports only
because:
  - Domain tests run without a database.
consequences: []
scope:
  - src/domain/**
enforced_by:
  - check: no-db-in-domain
```

## 5. Sign and check

```sh
npx premise refresh ADR-001
npx premise check
```

`refresh` writes a fingerprint into each link of the ADR. Commit `decisions/`.

## 6. CI

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0          # premise reads git history to show what changed
- run: pnpm test            # writes reports/
- run: npx premise check
```

For classifier sign-off, add a required PR job:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: npx premise signoff --base origin/${{ github.base_ref }}
  env:
    TYPESAFE_AI_API_KEY: ${{ secrets.TYPESAFE_AI_API_KEY }}
```

See the [reference](reference.md) for every field, state and command.
