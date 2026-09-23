# Releasing

Premise is published as the public npm package `@stuplum/premise`. The package
installs the `premise` executable.

## Prerequisites

- Confirm the release version and changelog entry.
- Confirm the `@stuplum` npm scope is controlled by the maintainer.
- Ensure the default branch passes GitHub Actions.
- Configure `@stuplum/premise` with an npm trusted publisher for GitHub Actions:
  - Organization or user: `stuplum`
  - Repository: `premise`
  - Workflow filename: `publish.yml`
  - Environment: leave blank
  - Allowed action: `npm publish`

## Publish

```sh
release_version=$(node --print "require('./package.json').version")
git tag -a "v${release_version}" -m "v${release_version}"
git push origin "v${release_version}"
```

The tag must match the version in `package.json`. Pushing it runs the publish
workflow, which installs locked dependencies, verifies the package, and
publishes it through npm's short-lived OIDC credentials. No npm token is stored
in GitHub.

After npm accepts the package, create a GitHub release from the changelog entry.
