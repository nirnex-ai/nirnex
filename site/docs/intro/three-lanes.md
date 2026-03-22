---
id: three-lanes
title: Three Lanes
sidebar_label: Three Lanes
sidebar_position: 3
description: The three execution lanes that classify every task by change complexity and blast radius.
---

<span class="u-eyebrow">v9.0 — Introduction</span>

# Three Lanes

Every task is classified into exactly one lane. Classification is **deterministic** — a function of ECO dimensions, not model preference.

---

## Classification Table

| Lane | Trigger | LLM calls | Human gate |
|------|---------|-----------|------------|
| **A — Hook Only** | Coverage ≥ 90%, blast radius ≤ 3, no cross-module write | 0 | None |
| **B — Plan + Implement** | Coverage 60–89%, blast radius 4–10, single module write | 1–2 | Optional review |
| **C — Full + Dual Mode** | Coverage < 60%, blast radius > 10, cross-module write, or analyst override | 2–4 | Required |

---

## Lane A

The default lane for 80% of all commits. Runs deterministic hooks: lint, type-check, test. No LLM involvement. Completes in milliseconds.

## Lane B

Requires a planning pass. A single LLM call produces a bounded Task Execution Envelope (TEE). Implementation is constrained to the TEE's declared scope.

## Lane C

Full evidence collection, dual-mode planning (breadth + depth), required human review gate before any write to the codebase. Used for refactors, cross-module changes, and anything the analyst flags as high-risk.

---

:::info Classification is a floor, not a ceiling
`lane = max(forced_min_from_eco, analyst_override)`. The ECO can force a task up to a higher lane; it can never force it down.
:::
