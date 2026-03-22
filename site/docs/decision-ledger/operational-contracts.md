---
id: operational-contracts
title: Operational Contracts
sidebar_label: Operational Contracts
sidebar_position: 5
description: The immutable behavioural contracts the Decision Ledger enforces across the entire system.
---

<span class="u-eyebrow">Decision Ledger · Layer 03</span>

# Operational Contracts

Operational contracts are **system-level invariants** enforced by the Decision Ledger. Violations are pipeline errors, not warnings.

---

## The Contracts

### 1 · Every Decision Is Recorded

No pipeline stage may complete without emitting at least one trace event. A stage that terminates without a trace event is treated as a crash, not a success.

### 2 · ECO Snapshots Are Immutable

Once an ECO snapshot is written to the ledger, it cannot be modified. Reclassifications create new snapshot versions — they do not overwrite.

### 3 · Confidence Is Deterministic

Given the same inputs, the confidence score must always produce the same output. Any non-determinism in scoring is a bug.

### 4 · Unknown Over False Confidence

If the system cannot determine a value with sufficient evidence, it must return `UNKNOWN` rather than a low-confidence guess. Guessing below confidence 20 is prohibited.

### 5 · Scope Violations Are Rejections

A TEE that attempts to write outside its declared scope is **rejected immediately** — not warned. The violation is logged and escalated.

### 6 · Calibration Requires Human Approval

No automated process may apply calibration weight changes. The approval step cannot be bypassed.

---

## Contract Violations

All contract violations are stored as `contract_violation` trace events. They surface in `nirnex status --violations` and are included in the monthly calibration review.
