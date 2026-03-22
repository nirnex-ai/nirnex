---
id: ground-truth-sampling
title: Ground Truth Sampling
sidebar_label: Ground Truth Sampling
sidebar_position: 3
description: 5% of completed tasks are sampled for human ground-truth labelling to calibrate the system over time.
---

<span class="u-eyebrow">Decision Ledger · Layer 03</span>

# Ground Truth Sampling

**5% of completed tasks** are flagged for human ground-truth review. Reviewed tasks feed the monthly calibration cycle.

---

## Why 5%

Enough signal to detect systematic bias without creating review fatigue. The sample is stratified — not random — to ensure coverage across all lane types and intent classes.

---

## Sampling Strategy

| Stratum | Sample rate | Reason |
|---------|------------|--------|
| Lane C completions | 20% | Highest complexity, most calibration value |
| Gate failures that recovered | 15% | Edge cases reveal system gaps |
| Lane A tasks | 2% | High volume, low complexity |
| Lane B tasks | 5% | Balanced |
| First task of each new intent class | 100% | Bootstrapping signal |

---

## Reviewer Interface

Sampled tasks surface in `nirnex status --review-queue`. For each sampled task the reviewer sees:

1. The original spec
2. The ECO that was produced (all five dimensions)
3. The lane classification and strategy selected
4. The TEEs executed and their gate results
5. Three questions:
   - Was the lane classification correct?
   - Was the strategy appropriate?
   - Was the ECO confidence score accurate?

---

## Output

Each review produces a `ground_truth_label` record stored in the Decision Ledger. Labels are used exclusively for [Replay Calibration](/docs/decision-ledger/replay-calibration) — they do not affect live system behaviour.
