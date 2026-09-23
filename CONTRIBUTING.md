# Contributing

Premise is experimental. Open an issue before starting a substantial change so
the problem and expected behaviour can be agreed first.

## Development workflow

Use Node.js 20 or newer and pnpm 10.27.0.

```sh
pnpm install
pnpm verify
```

Describe user-visible behaviour in Gherkin before implementing it. Keep the
feature scenarios and their step definitions in the same change as the code.

Before opening a pull request, run:

```sh
pnpm verify
npm pack --dry-run
```

By contributing, you agree that your contribution is provided for inclusion in
this currently unlicensed project. A project licence will be chosen separately.
