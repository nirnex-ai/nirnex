---
id: strategy-selection
title: Strategy Selection
sidebar_label: Strategy Selection
sidebar_position: 2
description: How the pipeline selects an implementation strategy biased by lane and ECO dimensions.
---

<span class="u-eyebrow">Task Pipeline · Layer 02</span>

# Strategy Selection

Strategy selection happens at the start of Lanes B and C. It chooses the **implementation approach** the implementer agent will follow, biased by ECO evidence and overridable by the analyst.

---

## Strategies

| Strategy | Use when | TEE shape |
|----------|----------|-----------|
| `SURGICAL` | High coverage, low blast radius, clear mapping | Single-file, narrow scope |
| `LAYERED` | Multi-module change, clear dependency order | Sequential TEEs, ordered |
| `EXPLORATORY` | Low coverage or NEEDS_EXPLORE intent | Staged — explore first, then act |
| `CONSERVATIVE` | Any dimension at escalate/block | Minimal writes, maximum verification |
| `DUAL_MODE` | Lane C only | Breadth pass + depth pass before any write |

---

## Selection Logic

```
if lane == A:       strategy = HOOK_ONLY (no selection needed)
if coverage < 60%:  strategy = EXPLORATORY or CONSERVATIVE
if blast_radius > 10: strategy = LAYERED
if lane == C:       strategy = DUAL_MODE (always)
else:               strategy = SURGICAL (default)
```

The analyst may override the selected strategy before decomposition. The override is recorded in the trace.

---

## Strategy + Lane Matrix

| Lane | Default strategy | Allowed overrides |
|------|-----------------|------------------|
| A | HOOK_ONLY | None |
| B | SURGICAL | LAYERED, CONSERVATIVE |
| C | DUAL_MODE | LAYERED, CONSERVATIVE (no downgrade to SURGICAL) |

---

## Effect on TEE Count

| Strategy | Typical TEE count |
|----------|-----------------|
| HOOK_ONLY | 0 (hooks run directly) |
| SURGICAL | 1 |
| LAYERED | 2–4 |
| EXPLORATORY | 2 (explore + act) |
| CONSERVATIVE | 1–2 |
| DUAL_MODE | 3–5 (breadth + depth + writes) |
