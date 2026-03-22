---
id: trace-schema
title: Trace Schema
sidebar_label: Trace Schema
sidebar_position: 2
description: The unified trace schema that spans all pipeline stages — every decision recorded with rationale and inputs.
---

<span class="u-eyebrow">Decision Ledger · Layer 03</span>

# Trace Schema

Every pipeline decision emits a **trace event** to the Decision Ledger. The schema is unified across all stages — Knowledge Engine, Task Orchestrator, and completion.

---

## Base Event Shape

```ts
interface TraceEvent {
  id: string                    // uuid
  task_id: string
  tee_id?: string               // null for pre-TEE events
  stage: PipelineStage
  event: EventType
  timestamp: string             // ISO 8601
  inputs: Record<string, unknown>   // what the decision consumed
  output: Record<string, unknown>   // what was produced
  rationale?: string            // human-readable explanation
  confidence?: number           // 0–100 if applicable
  eco_snapshot_id?: string      // ECO in effect at decision time
}
```

---

## Stage Values

| Stage | Events emitted |
|-------|---------------|
| `intent_detection` | intent classified, flagged for decomposition |
| `retrieval` | tier activated, tier result, sufficiency gate |
| `eco_assembly` | dimension scored, reclassification, ECO finalised |
| `lane_classification` | lane assigned, escalation applied |
| `strategy_selection` | strategy selected, analyst override |
| `decomposition` | TEE created, scope declared |
| `implementation` | write attempted, write rejected (out of scope) |
| `gate` | gate started, gate passed, gate failed |
| `completion` | task merged, escalated, or abandoned |

---

## Immutability

Trace events are **append-only**. No event may be modified after insertion. Corrections are new events with `event: "correction"` referencing the original event id.

---

## Querying Traces

```bash
nirnex trace --task <id>          # full event log for a task
nirnex trace --stage eco_assembly # all ECO assembly events
nirnex trace --since 7d --failed  # failed gates in last 7 days
```
