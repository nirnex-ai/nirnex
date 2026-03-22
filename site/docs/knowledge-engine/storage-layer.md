---
id: storage-layer
title: Storage Layer
sidebar_label: Storage Layer
sidebar_position: 3
description: SQLite with WAL mode and FTS5 full-text search. Zero network dependencies, atomic writes.
---

<span class="u-eyebrow">Knowledge Engine · Layer 01</span>

# Storage Layer

A single **SQLite database** per repository. Zero network dependencies. WAL mode for concurrent read/write. FTS5 for full-text symbol search.

---

## Database Location

```
.nirnex/index.db
```

Committed to `.gitignore`. Never leaves the developer's machine.

---

## Core Tables

| Table | Purpose |
|-------|---------|
| `modules` | One row per source file. Exports, imports, parse method, last SHA |
| `symbols` | All named symbols with kind, file, line, signature |
| `dependencies` | Directed graph edges: `from_module → to_module` |
| `gate_results` | Historical CI/lint/test results per commit |
| `eco_snapshots` | Full ECO JSON stored for every task (Decision Ledger) |
| `trace_events` | Every pipeline decision event with timestamp and rationale |

---

## Design Decisions

**WAL mode** — allows reads during writes. The indexer writes atomically while queries continue unblocked.

**FTS5** — symbol lookup is full-text, not exact-match. Partial names and fuzzy prefixes work without additional infrastructure.

**No ORM** — raw SQL via `better-sqlite3`. Synchronous API. Predictable performance, no async overhead in the hot path.

**No vector store in the critical path** — embeddings are a Tier 3 fallback. The primary retrieval path is structural, not semantic.
