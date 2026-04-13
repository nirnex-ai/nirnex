---
name: nirnex-runtime-hooks
description: Work on the Nirnex Claude hook runtime, zero-trust validation, attestation, and audit flow without breaking cross-store invariants.
license: MIT
---

# Nirnex Runtime Hooks

Use this skill when the task touches:
- `packages/cli/src/runtime/*`
- `packages/cli/src/commands/setup.ts`
- `packages/cli/src/commands/remove.ts`
- `packages/cli/src/commands/doctor.ts`
- `packages/core/src/runtime/*`

## Read first

Read these files before editing:
- `packages/cli/src/runtime/types.ts`
- `packages/cli/src/runtime/session.ts`
- `packages/cli/src/runtime/guard.ts`
- `packages/cli/src/runtime/trace-hook.ts`
- `packages/cli/src/runtime/validate.ts`

Then read whichever of these are relevant:
- `packages/core/src/runtime/store-hierarchy.ts`
- `packages/core/src/runtime/evidence-integrity.ts`
- `packages/cli/src/commands/hook-log.ts`
- `tests/hook-audit.test.ts`
- `tests/evidence-integrity.test.ts`
- `tests/store-hierarchy.test.ts`
- `tests/stop-hook-idempotency.test.ts`
- `tests/stdin-transport.test.ts`

## What to protect

- direct-node-entry hook launcher strategy
- append-only hook event stream
- sidecar write-failure flow
- ledger as canonical store
- idempotent Stop hook behavior
- zero-trust rules around verification and post-verification edits
- shared literal alignment for reason codes

## Typical workflow

1. Identify whether the change is transport, policy, or persistence.
2. Edit the smallest layer that owns the bug.
3. Update shared types first if event shape or reason codes change.
4. Update tests immediately after the code change.
5. Run the minimum runtime verification set.
6. Run root build if sibling-package imports are involved.

## Verification

Run:
- `npx vitest run tests/hook-audit.test.ts tests/evidence-integrity.test.ts tests/store-hierarchy.test.ts tests/stop-hook-idempotency.test.ts tests/stdin-transport.test.ts`

If setup/remove/doctor changed, also run:
- `npx vitest run tests/setup.test.ts tests/remove.test.ts tests/doctor.test.ts`

If exports or dist imports changed:
- `npm run build`
- `npm run typecheck`
