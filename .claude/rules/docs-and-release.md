---
paths:
  - ["./site/docs/**", 'CODE.md', 'README.md']
---
# Docs And Release Rule

Use this rule when a change affects CLI behavior, generated files, runtime contract, or published package behavior.

## Update docs in the same change

Check these files first:
- `README.md`
- `CODE.md`
- relevant docs under `site/docs/**`

Common examples:
- `nirnex setup` changes
- `nirnex remove` changes
- `nirnex doctor` output/repair flow changes
- hook lifecycle or runtime artifact changes
- report/replay/ledger semantics
- parser/index behavior changes that users can observe

## Site verification

Root lint/tests do not validate `site/`.
If you touch anything under `site/`, run:
- `cd site && npm run typecheck`
- `cd site && npm run build`

## Release behavior

This repo versions all workspaces together through the release workflow.
Do not bump one package version in isolation unless the task explicitly changes release policy.

If you change package publish shape, CLI entrypoints, or build outputs, inspect:
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

## Build order reminder

Because CLI source imports built `dist` files from sibling packages, docs and release changes that depend on runtime structure should be validated after:
- `npm run build`
