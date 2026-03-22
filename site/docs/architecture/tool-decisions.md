---
id: tool-decisions
title: Tool Decisions
sidebar_label: Tool Decisions
sidebar_position: 7
description: Why each core technology was chosen — and what was explicitly rejected.
---

<span class="u-eyebrow">Reference</span>

# Tool Decisions

Rationale for each major technology choice. Alternatives considered and reasons for rejection are included.

---

## SQLite — Primary Store

**Chosen because:** Zero network dependency, embedded, ACID, WAL mode, FTS5. Runs in the developer's process. `better-sqlite3` provides a synchronous API with no async overhead in the hot path.

**Rejected alternatives:**
- PostgreSQL — requires a running server, network overhead, wrong deployment model
- DuckDB — excellent for analytics, but no FTS, more complex embedding story
- LevelDB / RocksDB — no SQL, no FTS, would require a query layer

---

## Tree-sitter — Parser

**Chosen because:** Error-tolerant (parses partial/broken code), fast incremental parsing, TypeScript/JavaScript support via `tree-sitter-typescript`, Node.js bindings available.

**Rejected alternatives:**
- TypeScript Compiler API — too slow for post-commit hot path, full program compilation required
- Babel AST — JavaScript only, no TypeScript native support
- Regex-based extraction — too fragile, not a real AST

---

## Vitest — Test Runner

**Chosen because:** Native ESM support, TypeScript without transpilation, fast cold start, compatible with the monorepo's module setup.

**Rejected alternatives:**
- Jest — requires transform config for ESM, slower cold start
- Mocha — no built-in TypeScript, extra config overhead

---

## TypeScript Project References — Build System

**Chosen because:** Incremental compilation, correct build ordering across packages, declaration file generation without a bundler.

**Rejected alternatives:**
- Turborepo — additional dependency, more complex cache invalidation
- esbuild / tsup — no declaration file support without `tsc`, dual-tool complexity
- nx — too heavyweight for a focused monorepo

---

## No Vector Database in Critical Path

**Decision:** Vector search is a Tier 3 fallback only — never in the required retrieval path.

**Rationale:** Semantic search is probabilistic and non-deterministic. The confidence scoring system requires deterministic penalty rules. Allowing vector search to gate progress would introduce uncontrollable variance. It is available for exploratory queries where the developer explicitly needs it.
