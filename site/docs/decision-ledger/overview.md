---
id: overview
title: Decision Ledger
sidebar_label: Overview
sidebar_position: 1
description: Unified trace schema spanning all pipeline stages. Ground truth sampling, replay capability, monthly calibration cycles.
---

<span class="u-eyebrow">Decision Ledger · Layer 03</span>

# Decision Ledger

One unified trace schema spans the entire system. A single `trace_id` connects every stage from request through completion. Five operational contracts ship with v1.

:::info Guiding principle
"When something goes wrong, you read the trace chain backwards." Every decision is auditable. Nothing is silent.
:::

---

## Unified Trace Stages

| Order | Stage | Owner | What it records |
|---|---|---|---|
| 1 | `request_received` | CLI | Raw input: feature description, spec file path, command |
| 2 | `knowledge_query` | Knowledge layer | Router flags, sources dispatched/responded/failed, health matrix |
| 3 | `evidence_assessment` | Knowledge layer | ECO emitted: dimensions, checkpoints, constraints |
| 3a | `reclassification` | Pipeline | If triggered: original intent, new intent, reason, old ECO archived |
| 4 | `classification` | Pipeline | Lane selected, constraint sources, overrides with reason |
| 5 | `strategy_selection` | Pipeline | Strategy chosen, justification, retrieval_mode confirmed |
| 6 | `task_decomposition` | Pipeline | Slice count, boundaries, dependency validation |
| 7 | `implementation` | Implementer | Files created/modified, lines changed, escalations, tokens used |
| 8 | `validation` | Gates / CI | Test pass/fail, coverage delta, lint, type errors, size check |
| 9 | `completion` | Pipeline | `merged \| escalated \| abandoned`. If escalated: reason |

---

## Per-Stage Record Schema

Every stage records:
- `inputs` — what it received from the previous stage
- `decision` — what it chose
- `constraints_applied` — what limited its choice
- `confidence` — score at this point
- `uncertainty` — what it doesn't know
- `human_override` — if any
- `duration_ms`
- `next_stage`

---

## Trace Chain Integrity Rules

```
Every stage references the same trace_id (set at request_received)
Each stage records its inputs from the previous stage explicitly
Stages cannot be skipped — classification without evidence_assessment blocks
Overrides are always logged: who · what · why
Replay works per-stage: dev replay --trace {id} --stage classification
```

---

## Five Operational Contracts

### 01 — Decision Trace

Every LLM-assisted query logs the full chain to `.ai-index/traces/YYYY-MM-DD/`. One JSON file per query. 30-day rotation, 90-day deletion. **Lane A commits do not generate traces** — zero footprint for ~80% of work.

### 02 — Ground Truth Sampling

5% of LLM-assisted queries prompt the developer: *"Was this answer helpful? [y/n/partial]."* One keystroke. If `n` or `partial`, optional one-line note. After 4 weeks: ~50–100 calibration samples. Monthly review tunes penalties, routing keywords, and severity thresholds.

### 03 — Penalty Breakdown

Fully explicit. Every penalty appears individually in `penalties[]`. Total score = `100 − sum(deductions)`. Zero penalties = 100. No silent aggregation. New penalties require a trace review first.

### 04 — Unknown / Insufficient Evidence State

The system can refuse to answer. `Unknown` = cannot classify the query. `Insufficient evidence` = searched but found nothing or score < 20. **Below confidence 60, the system never suggests automated next steps.**

### 05 — Replay Capability

```bash
# Re-run a past query with current rules — side-by-side delta
dev replay --trace {id}

# Batch: replay all traces from last 30 days
dev replay --all --since 30d
# Output: how many improved · degraded · stayed the same
```

Batch replay is the primary mechanism for calibrating penalty weights and routing keywords. Replaces weekly meetings with a 2-minute monthly concrete report.

---

## Storage Spec

```
Location:    .ai-index/traces/YYYY-MM-DD/{trace_id}.json
Format:      One JSON file per query
Rotation:    30 days (active)
Deletion:    90 days
Lane A:      No trace files generated
Sampling:    5% of Lane B/C queries only
```
