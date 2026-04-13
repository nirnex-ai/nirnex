---
paths:
  - ["packages/cli/src/commands/index.ts", 'packages/parser/src/*', 'packages/core/src/db.ts', 'packages/core/src/schema.sql', 'packages/core/src/scope/*']
---
# Index, Parser, And Scope Rule

Use this rule whenever you touch:
- `packages/cli/src/commands/index.ts`
- `packages/parser/src/*`
- `packages/core/src/db.ts`
- `packages/core/src/schema.sql`
- `packages/core/src/scope/*`

## Non-negotiable invariants

- `.aidos.db` remains the root index database
- schema changes require versioning discipline
- parser failures must stay diagnosable through staged diagnostics
- parser compatibility must fail loudly before indexing if smoke tests fail
- `--explain-scope` must remain trustworthy
- incremental index behavior must not silently degrade into full-reindex semantics

## Schema changes

If you change DB shape:
- update `packages/core/src/schema.sql`
- update version handling in `packages/core/src/db.ts`
- ensure the build still copies `schema.sql` into `packages/core/dist/`
- verify any affected tests or docs

## Parser changes

If you change parsing behavior:
- preserve `ParseStage`-based diagnostics
- preserve `.ts` / `.tsx` language selection behavior unless the task explicitly expands support
- if dependency versions change, update `SUPPORTED_MATRIX` in `packages/parser/src/compatibility.ts`

## ast-grep / state-machine note

`nirnex query` uses `npx sg scan --json`.
If query output, state-machine detection, or XState guidance changes, inspect those rules too.

## Verification

Run:
- `npx vitest run tests/parser-compat.test.ts tests/scope.test.ts`

If schema or export shape changed:
- `npm run build`
- `npm run typecheck`
