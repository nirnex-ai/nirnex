---
id: query-router
title: Query Router
sidebar_label: Query Router
sidebar_position: 5
description: Intent-biased routing that selects retrieval tiers and query shapes based on detected task intent.
---

<span class="u-eyebrow">Knowledge Engine · Layer 01</span>

# Query Router

The Query Router translates detected intent into **retrieval strategy**. It decides which tiers to activate, in what order, with what query shape.

---

## Intent → Strategy Map

| Detected Intent | Primary tier | Secondary | Vector? |
|----------------|--------------|-----------|---------|
| `REFACTOR` | Tier 1 — dependency graph | Tier 2 — LSP types | No |
| `BUG_FIX` | Tier 1 — symbol + gate history | Tier 2 — LSP | No |
| `FEATURE_ADD` | Tier 1 — module exports | Tier 2 — LSP | Sometimes |
| `NEEDS_EXPLORE` | Tier 3 — vector | Tier 1 fallback | Yes |
| `CONFIG_CHANGE` | Tier 1 — file metadata | None | No |
| `UNKNOWN` | Tier 1 broad | All tiers | No |

---

## Routing Logic

```
1. parse_intent(spec) → intent_class (max 2)
2. select_tiers(intent_class) → ordered tier list
3. for each tier:
     result = query(tier, spec, index)
     if result.sufficient: break
     else: accumulate + continue
4. assemble_eco(accumulated_results) → ECO
```

---

## Sufficiency Gates

Each intent class has a **binary sufficiency gate** — a set of conditions that must be true before the ECO is considered complete enough to pass to the Task Orchestrator.

If the gate fails after all tiers are exhausted, the system halts with `ECO_INSUFFICIENT` and requires human input before proceeding.
