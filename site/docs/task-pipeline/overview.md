---
id: overview
title: Task Pipeline Overview
sidebar_label: Overview
sidebar_position: 1
description: The Task Orchestrator turns a spec and an ECO into bounded execution slices assigned to implementer agents.
---

<span class="u-eyebrow">Task Pipeline · Layer 02</span>

# Task Pipeline

The Task Orchestrator takes two inputs — a **spec** and a **scored ECO** — and produces bounded **Task Execution Envelopes (TEEs)** assigned to implementer agents. Every decision is constrained by the ECO.

---

## Stages

```
ECO (scored) + Spec
  │
  ├─ 1. Lane Classification
  │       └─ A · B · C
  │
  ├─ 2. Strategy Selection
  │       └─ biased by lane + ECO dimensions
  │
  ├─ 3. Decomposition
  │       └─ spec → ordered TEEs
  │
  ├─ 4. Implementation
  │       └─ staging area → human gate (Lane C) → codebase
  │
  ├─ 5. Validation Gates
  │       └─ tests · lint · types · size
  │
  └─ 6. Completion
          └─ merged | escalated | abandoned
```

---

## Lane Behaviour Summary

| Stage | Lane A | Lane B | Lane C |
|-------|--------|--------|--------|
| Strategy selection | None (hooks only) | Biased selection | Full selection |
| Decomposition | None | Single TEE | Multi-TEE |
| Implementation | Hook execution | Scoped agent | Scoped agent, dual mode |
| Human gate | None | Optional | Required |
| LLM calls | **0** | 1–2 | 2–4 |

---

## Key Invariants

1. **No TEE may exceed its declared scope.** Writes outside the TEE boundary are rejected.
2. **Validation gates are non-negotiable.** A TEE that fails a gate cannot be merged — it must escalate or be abandoned.
3. **Every stage emits a trace event** to the Decision Ledger, regardless of outcome.
