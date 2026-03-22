---
id: dual-inputs
title: Dual Inputs
sidebar_label: Dual Inputs
sidebar_position: 4
description: Every task has two equal-weight inputs — the spec file and the live codebase index.
---

<span class="u-eyebrow">v9.0 — Introduction</span>

# Dual Inputs

Every task enters the system with exactly **two inputs of equal authority**.

---

## The Inputs

| Input | Carrier | Authority |
|-------|---------|-----------|
| **Spec file** | `.nirnex/tasks/<id>.md` | What the developer *intends* |
| **Codebase index** | SQLite + in-process LSP | What *actually exists* |

Neither input outranks the other. A spec that contradicts codebase reality produces a Conflict dimension penalty in the ECO — it does not get silently overridden.

---

## The Collision

The Knowledge Engine's job is to **resolve the spec's intent against the codebase's reality**. The output of this collision is the ECO.

```
spec intent  ──┐
               ├──► Knowledge Engine ──► ECO (5 dimensions, scored)
codebase index ─┘
```

If the spec references a module that does not exist, that is a Mapping failure — reported explicitly, never assumed away.

---

## Why Equal Weight

Most AI coding tools treat the codebase as subordinate to the prompt. Nirnex inverts this: the codebase is a first-class input that can and must contradict the spec when the spec is wrong.
