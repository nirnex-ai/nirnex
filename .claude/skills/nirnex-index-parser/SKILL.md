---
name: nirnex-index-parser
description: Safely modify indexing, parsing, scope classification, and parser compatibility checks in the Nirnex monorepo.
license: MIT
---

# Nirnex Index Parser

Use this skill when the task touches:
- `packages/cli/src/commands/index.ts`
- `packages/parser/src/index.ts`
- `packages/parser/src/compatibility.ts`
- `packages/core/src/db.ts`
- `packages/core/src/schema.sql`
- `packages/core/src/scope/*`

## Read first

- `packages/cli/src/commands/index.ts`
- `packages/parser/src/index.ts`
- `packages/parser/src/compatibility.ts`
- `packages/core/src/db.ts`
- `tests/parser-compat.test.ts`
- `tests/scope.test.ts`

If schema or DB behavior changes, also inspect:
- `packages/core/src/schema.sql`
- relevant DB callers in `packages/core`

## What to protect

- `.aidos.db` compatibility
- schema-version upgrade behavior
- parser smoke-test gate before indexing
- parse diagnostics with stage attribution
- incremental indexing semantics
- explainable scope classification

## Extra repo-specific caution

`nirnex query` shells out to `npx sg scan --json`, and the repo ships ast-grep rules in `rules/`.
If the task affects state-machine or pattern query behavior, inspect those rules too.

## Verification

Run:
- `npx vitest run tests/parser-compat.test.ts tests/scope.test.ts`

If schema or export shape changed:
- `npm run build`
- `npm run typecheck`
