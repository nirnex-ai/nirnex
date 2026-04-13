# Repo Topology And Safe Edit Boundaries

This repo has hard package boundaries.

## Package ownership

- `packages/cli` owns CLI command UX, hook stdin/stdout transport, session/envelope persistence, and runtime orchestration
- `packages/core` owns deterministic policy, scoring, ledger, reporting, scope logic, and DB helpers
- `packages/parser` owns tree-sitter parsing and compatibility gates
- `packages/hooks` is not where the Claude hook runtime lives; do not move runtime logic there by default
- `site` is a separate Docusaurus app and deploys from its own workflow

## What to avoid

Do not move logic across packages just to "clean things up".
The current split is coupled to package publishing and dist imports.

Do not replace `@nirnex/core/dist/...` imports in CLI source as a drive-by refactor.
That pattern is part of how the local build is expected to work today.

Do not unify root and site toolchains.
Root CI runs on Node 24.
`site/` has its own package and workflow.

## AIDOS/Nirnex mixed naming

Treat these as compatibility surfaces:
- `.aidos.db`
- `.aidos-ledger.db`
- `nirnex` CLI command
- package names under `@nirnex/*`

Do not rename them without updating code, docs, tests, and migration expectations together.

## Self-governance exception

This repo is intentionally not a live Nirnex target repo.
Do not remove `.claude/settings.json` disablement or create `nirnex.config.json` unless the task explicitly requires testing setup behavior in-repo.
