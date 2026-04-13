---
name: nirnex-setup-doctor
description: Change setup, remove, doctor, and generated hook/runtime artifacts without breaking upgrade, repair, or uninstall paths.
license: MIT
---

# Nirnex Setup Doctor

Use this skill when the task touches:
- `packages/cli/src/commands/setup.ts`
- `packages/cli/src/commands/remove.ts`
- `packages/cli/src/commands/doctor.ts`
- generated hook script behavior
- runtime-contract generation/repair

## Read first

- `packages/cli/src/commands/setup.ts`
- `packages/cli/src/commands/remove.ts`
- `packages/cli/src/commands/doctor.ts`
- `README.md`
- `CODE.md`
- `tests/setup.test.ts`
- `tests/remove.test.ts`
- `tests/doctor.test.ts`

## What to protect

- setup idempotency
- remove safety and selective cleanup behavior
- doctor's ability to diagnose stale node/entry paths
- direct-node-entry strategy in generated scripts
- runtime-contract contents under `.ai/runtime-contract.json`
- backward compatibility with older generated hook formats during removal

## Verification

Run:
- `npx vitest run tests/setup.test.ts tests/remove.test.ts tests/doctor.test.ts`

If the change touches runtime hooks too, add:
- `npx vitest run tests/hook-audit.test.ts tests/stdin-transport.test.ts`

If exports changed:
- `npm run build`
