# Contributing

This repository expects documentation updates to ship with behavior changes.

## Pull request checklist

1. Update every affected package README when changing public behavior, defaults, commands, or errors.
2. Keep API reference sections synchronized with runtime option validation (`packages/*/src/config/validate.js`).
3. When adding `LayerError` messages, add remediation blocks under the package Runtime Error Reference.
4. Keep cross-surface behavior consistent in docs when changes affect CLI, REST, and GraphQL parity.

## Documentation quality gates

Use this checklist before opening a PR:

1. Every new example explains what it demonstrates and expected behavior.
2. No undocumented runtime options in adapter/plugin package READMEs.
3. No stale default values (for example guardrail profile drift between packages).
4. All internal README links/anchors resolve.
5. Commands and snippets are copy/paste runnable for the documented context.

## Verification commands

```sh
pnpm -r test
rg -n "TODO|TBD|FIXME" README.md packages/*/README.md
```

If a change touches docs only, still run relevant package tests to ensure examples and referenced behavior remain accurate.
