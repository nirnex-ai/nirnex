---
id: dynamic-reclassification
title: Dynamic Reclassification
sidebar_label: Dynamic Reclassification
sidebar_position: 5
description: How the analyst agent can reclassify an ECO mid-pipeline, and the rules that constrain it.
---

<span class="u-eyebrow">Architecture · Intent & ECO</span>

# Dynamic Reclassification

After the initial ECO is produced, an **analyst agent** may reclassify the ECO dimensions once (maximum twice for Lane C tasks). This is the only LLM-gated step before the Task Orchestrator.

---

## Why Reclassification Exists

Heuristic intent detection and structural retrieval can produce a technically valid ECO that is contextually wrong. The analyst provides a lightweight reasoning pass without replacing the structural evidence.

:::warning Hard limit
The analyst may reclassify **at most twice** per task. A third reclassification attempt is rejected — the task is either escalated to Lane C with the current ECO or halted for human review.
:::

---

## What the Analyst Can Change

| Field | Can reclassify? | Notes |
|-------|----------------|-------|
| `intents[]` | ✅ Yes | Replace or add a second intent |
| Dimension severity | ✅ Yes (escalate only) | Can raise severity, never lower |
| `lane_forced_min` | ✅ Yes | Can raise, never lower |
| `confidence_score` | ❌ No | Deterministic — not overridable |
| `eco_snapshot` raw data | ❌ No | Immutable once written |

---

## Reclassification Trace

Every reclassification is recorded in the Decision Ledger:

```json
{
  "event": "eco_reclassification",
  "attempt": 1,
  "analyst": "agent:v2.1",
  "changes": {
    "intents": { "from": ["FEATURE_ADD"], "to": ["FEATURE_ADD", "REFACTOR"] },
    "lane_forced_min": { "from": "A", "to": "B" }
  },
  "rationale": "Spec references restructuring of auth module boundary",
  "timestamp": "2026-03-22T10:14:22Z"
}
```
