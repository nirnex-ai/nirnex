---
id: retrieval-sources
title: Retrieval Sources
sidebar_label: Retrieval Sources
sidebar_position: 4
description: Four-tier retrieval cascade — structural first, semantic only as fallback.
---

<span class="u-eyebrow">Knowledge Engine · Layer 01</span>

# Retrieval Sources

Evidence is retrieved from four tiers in priority order. **Higher tiers are always preferred.** Lower tiers activate only when higher tiers cannot answer the query.

---

## Tier Table

| Tier | Source | Latency | Confidence impact |
|------|--------|---------|------------------|
| **1 — Structural index** | SQLite symbol + dependency graph | < 5ms | None |
| **2 — LSP** | In-process language server | 10–50ms | −25 if unavailable |
| **3 — Vector search** | Local embeddings (on-demand) | 50–200ms | −10 if dormant |
| **4 — Degraded** | Summary-only metadata | < 1ms | −15 + −30 if multiple |

---

## Tier 1 — Structural Index

The primary source. SQL queries against the indexed module graph. Fast, deterministic, no inference. Covers:
- Symbol lookups (exact + FTS5 fuzzy)
- Dependency traversal (recursive CTE, depth-limited)
- Export/import resolution
- Gate result history

## Tier 2 — LSP

In-process language server (TypeScript language service). Used for:
- Cross-file type resolution
- Go-to-definition for unresolved imports
- Hover information for complex generics

LSP availability is checked at query time. If unavailable, −25 confidence.

## Tier 3 — Vector Search

Local embeddings generated on demand for `NEEDS_EXPLORE` intents. Never used in the critical path. Activates when structural retrieval finds no relevant modules and the intent is exploratory.

## Tier 4 — Degraded

Summary-only metadata when all other tiers fail for a specific file. Reports the degradation explicitly. Does not silently succeed.
