---
id: replay-calibration
title: Replay & Calibration
sidebar_label: Replay & Calibration
sidebar_position: 4
description: Any task can be replayed from its stored ECO snapshot. Monthly calibration tunes penalty weights from ground truth labels.
---

<span class="u-eyebrow">Decision Ledger · Layer 03</span>

# Replay & Calibration

Two mechanisms ensure the system improves over time without silent drift: **replay** (deterministic re-execution) and **calibration** (weight tuning from ground truth).

---

## Replay

Any completed task can be replayed from its stored ECO snapshot. Replay re-runs the pipeline logic against the same inputs — it does not re-query the codebase.

```bash
nirnex replay --task <id>
# Re-runs classification, strategy selection, and decomposition
# against the stored eco_snapshot. Reports any divergence.

nirnex replay --all --since 30d
# Replays all tasks from the last 30 days.
# Used to verify a system change didn't alter historic behaviour.
```

### What Replay Validates

- Lane classification would produce the same result
- Strategy selection would produce the same result
- TEE scope declarations are unchanged
- Confidence score is identical (deterministic)

Any divergence is flagged as a **replay delta** and stored in the ledger.

---

## Calibration

Monthly calibration uses accumulated ground truth labels to tune penalty weights in the confidence scoring matrix.

```bash
nirnex calibrate --since 30d
# Reads ground_truth_label records from the last 30 days
# Computes penalty weight adjustments
# Outputs proposed changes — does NOT apply automatically
```

### Calibration Rules

1. Calibration **proposes** changes — a human must approve before they are applied
2. Any new penalty rule requires a **30-day observation period** before being added
3. No single calibration cycle may change more than **3 penalty weights**
4. All weight changes are recorded in the Decision Ledger with the ground truth batch that produced them

---

:::info Design intent
Calibration is a slow, deliberate process. The system must not chase noise. The 30-day window and 3-weight limit exist to prevent overfitting to recent data.
:::
