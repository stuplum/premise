# dependency-cruiser provider

Premise includes a dependency-cruiser provider for executable architecture constraints.

A named forbidden dependency rule can become an architecture Premise.

## Configuration discovery

Premise looks for the first available file in this order:

```text
.dependency-cruiser.js
.dependency-cruiser.cjs
.dependency-cruiser.mjs
.dependency-cruiser.json
```

If none exists, the provider discovers no architecture Premises.

## Define an architecture Premise

For example:

```json
{
  "forbidden": [
    {
      "name": "ARCH-003",
      "comment": "Domain code must not depend on HTTP infrastructure",
      "severity": "error",
      "from": {
        "path": "^src/domain"
      },
      "to": {
        "path": "^src/http"
      }
    }
  ]
}
```

Premise discovers:

```text
ID: ARCH-003
type: architecture
dialect: dependency-cruiser
provider: dependency-cruiser
description: Domain code must not depend on HTTP infrastructure
```

## Rule requirements

A dependency-cruiser rule becomes a Premise only when:

* it is a forbidden dependency rule;
* its `name` is a valid Premise ID;
* it contains a non-empty `comment`;
* it has dependency `from` and `to` constraints.

The current ID pattern is:

```text
^[A-Z][A-Z0-9]*-\d+$
```

Examples:

```text
ARCH-001
API-12
ORDER2-003
```

Rules without a matching ID remain normal dependency-cruiser rules but are not discovered as Premises.

The rule's `comment` becomes the Premise description, so it should state the actual repository constraint.

## Evaluation

Run:

```sh
premise check
```

or:

```sh
premise test
```

Premise runs dependency-cruiser against the repository and isolates violations belonging to each discovered Premise rule.

If no violation exists for the rule:

```text
established
```

If the rule is violated:

```text
failed
```

with diagnostics describing the forbidden dependency.

If dependency-cruiser cannot perform a trustworthy analysis:

```text
unknown
```

## Analysis scope

The bundled CLI currently analyses:

```text
src
```

The public provider factory allows alternative source paths to be supplied programmatically, but `premise.json` does not currently configure dependency-cruiser source paths.

The dependency-cruiser configuration itself can further constrain analysis with its normal options.

For example:

```json
{
  "options": {
    "includeOnly": "^src"
  }
}
```

## Evidence

Provider evidence includes:

```text
assertion  → dependency-cruiser configuration
subject    → modules matching the rule's `from` scope
dependency → violating target modules when a violation exists
```

This enables artifact context.

For example:

```sh
premise context src/domain/order.ts
```

can return `ARCH-003` when `src/domain/order.ts` is part of the rule's subject scope.

## Example failure

Given:

```json
{
  "name": "ARCH-003",
  "comment": "Domain code must not depend on HTTP infrastructure",
  "severity": "error",
  "from": {
    "path": "^src/domain"
  },
  "to": {
    "path": "^src/http"
  }
}
```

this dependency:

```ts
// src/domain/order.ts
import { requestContext } from "../http/request-context.js";
```

should cause `ARCH-003` to fail.

That failure sensitivity is what makes the rule an executable Premise.

The existence or successful parsing of `.dependency-cruiser.*` is not sufficient.

## Writing useful rules

A Premise should describe what the rule actually establishes.

Good:

```text
Domain code must not depend on HTTP infrastructure
```

with a rule covering all relevant domain and HTTP paths.

Weak:

```text
Domain is isolated
```

when the actual rule checks only one small import path.

The description, `from` scope, `to` scope and analysed source set should agree about what has mechanically been established.

## Existing dependency-cruiser configurations

Premise uses standard dependency-cruiser configuration.

You do not need a separate Premise-specific architecture rule format.

Existing forbidden rules can become Premises by giving consequential rules:

* a stable Premise ID as their name;
* a comment describing the constraint.

This is intentional: Premise orchestrates executable repository knowledge rather than replacing the native assertion language.

