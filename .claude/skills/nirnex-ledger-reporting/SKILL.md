---
name: nirnex-ledger-reporting
description: Modify ledger, reporting, replay, and runtime evidence/report assembly while preserving append-only semantics and reportability.
license: MIT
---

# Nirnex Ledger Reporting

Use this skill when the task touches:
- `packages/core/src/ledger.ts`
- `packages/core/src/runtime/ledger/*`
- `packages/core/src/runtime/reporting/*`
- `packages/cli/src/commands/report.ts`
- `packages/cli/src/commands/replay.ts`
- `packages/cli/src/runtime/validate.ts`

## Read first

- `packages/cli/src/commands/report.ts`
- `packages/cli/src/runtime/validate.ts`
- the relevant files under `packages/core/src/runtime/ledger/`
- the relevant files under `packages/core/src/runtime/reporting/`

Also inspect tests that mention:
- evidence integrity
- store hierarchy
- report generation
- replay behavior

## What to protect

- append-only ledger semantics
- canonical-store rule: ledger wins
- run outcome summaries must remain deduplicated by task/trace semantics
- report assembly must tolerate advisory data gaps without inventing evidence
- report HTML/JSON outputs must remain file-based and deterministic

## Verification

Run the tests covering the touched area.
At minimum for validate-adjacent ledger/reporting changes, run:
- `npx vitest run tests/evidence-integrity.test.ts tests/store-hierarchy.test.ts`

Finish with:
- `npm run build`
- `npm run typecheck`
