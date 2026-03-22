---
id: overview
title: System Overview
sidebar_label: System Overview
sidebar_position: 1
description: AI Delivery OS is a three-layer operating system for AI-assisted software delivery. Complete technical overview, v9.0.
---

<span class="u-eyebrow">v9.0 — Final Architecture · March 2026</span>

# System Overview

AI Delivery OS is a **three-layer operating system** for AI-assisted software delivery. It governs how AI agents plan, implement, and validate code changes by providing structured evidence from the codebase, constraining agent decisions based on that evidence, and recording every decision for debugging and calibration.

:::info The Central Principle
The system is **not an autonomous agent**. It is a decision-support tool that reduces the probability of wrong plans by giving AI agents grounded, reliability-scored context — and constraining them to operate within evidence-backed boundaries.
:::

---

## Three Layers

<div class="u-grid-3" style={{marginBottom:'3rem'}}>
  <div class="u-cell">
    <span class="u-eyebrow">Layer 01</span>
    <h3 style={{textTransform:'uppercase',fontWeight:900,fontSize:'1.2rem',margin:'0 0 0.75rem'}}>Knowledge Engine</h3>
    <p>Builds structured evidence from the codebase. Parses code, indexes modules, traces dependencies, detects patterns, and produces a reliability-scored <strong>Execution Context Object (ECO)</strong> for every task.</p>
  </div>
  <div class="u-cell">
    <span class="u-eyebrow">Layer 02</span>
    <h3 style={{textTransform:'uppercase',fontWeight:900,fontSize:'1.2rem',margin:'0 0 0.75rem'}}>Task Orchestrator</h3>
    <p>Turns requirements into bounded execution slices. Classifies work into lanes, selects strategies, decomposes tasks, and assigns scoped boundaries to each implementer agent. Constrained by the ECO.</p>
  </div>
  <div class="u-cell">
    <span class="u-eyebrow">Layer 03</span>
    <h3 style={{textTransform:'uppercase',fontWeight:900,fontSize:'1.2rem',margin:'0 0 0.75rem'}}>Decision Ledger</h3>
    <p>Records why the system believed something, chose something, and did something. A unified trace schema spans all stages. Operational contracts enable continuous improvement.</p>
  </div>
</div>

---

## Dual Inputs

Every task has two inputs of **equal weight**:

| Input | What it provides | Authority |
|---|---|---|
| **Spec file** | Intent · scope · acceptance criteria · risk notes | What the developer *wants* |
| **Codebase** | Modules · dependencies · graph edges · patterns · gate results | What actually *exists* |

The knowledge layer's job is to **resolve the spec's intent against the codebase's reality**. The Execution Context Object (ECO) is the output of that collision.

---

## End-to-End Flow

```mermaid
flowchart TD
    classDef knowledge fill:#0D0D0D,stroke:#0D0D0D,color:#FFFFFF
    classDef pipeline  fill:#2A2A2A,stroke:#2A2A2A,color:#FFFFFF
    classDef eco       fill:#D63318,stroke:#D63318,color:#FFFFFF
    classDef ledger    fill:#444444,stroke:#444444,color:#AAAAAA

    SPEC["Spec / Bug Report\nIntent + scope"] --> KE
    CB["Codebase (indexed)\nIndex + LSP + graph + gates"] --> KE

    subgraph KE["Knowledge Engine"]
        direction TB
        K1["1. Detect intent\nheuristic, 1–2 max"]:::knowledge
        K2["2. Intent-biased retrieval\nspec/code collision"]:::knowledge
        K3["3. ECO — 5 dimensions\nCoverage · Freshness · Mapping\nConflict · Graph"]:::eco
        K4["3a. Analyst review\nreclassify? 1–2x max"]:::pipeline
        K5["Evidence sufficiency gate\nbinary checkpoints per intent"]:::knowledge
        K1 --> K2 --> K3 --> K4 --> K5
    end

    subgraph TP["Task Orchestrator — constrained by ECO"]
        direction TB
        T1["4. Classification\nlane = max(forced_min, analyst)"]:::pipeline
        T2A["Lane A\nhooks only"]:::pipeline
        T2B["Lane B\nplan + impl"]:::pipeline
        T2C["Lane C\nfull + dual mode"]:::pipeline
        T3["5. Strategy selection\nbiased, overridable"]:::pipeline
        T4["6. Decompose\nrules + TEEs"]:::pipeline
        T5["7. Implement\nstaging → human → codebase"]:::pipeline
        T6["8. Validate gates\ntests + lint + types + size"]:::pipeline
        T7["9. Complete\nmerged | escalated | abandoned"]:::pipeline
        T1 --> T2A & T2B & T2C --> T3 --> T4 --> T5 --> T6 --> T7
    end

    subgraph DL["Decision Ledger — unified trace schema"]
        direction LR
        D1["Trace\nevery decision"]:::ledger
        D2["Ground truth\n5% sampled"]:::ledger
        D3["Replay\nverify changes"]:::ledger
        D4["Calibrate\nmonthly"]:::ledger
        D5["Unknown\nrefuse if blind"]:::ledger
    end

    K5 --> T1
    T6 -. "gate_results feed back" .-> CB
    T1 & T3 & T4 & T5 & T6 & T7 --> DL
```

---

## Key Numbers

<div class="u-grid-3" style={{margin:'2rem 0'}}>
  <div style={{padding:'2.5rem',borderRight:'1px solid rgba(0,0,0,0.12)',borderBottom:'1px solid rgba(0,0,0,0.12)'}}>
    <div class="u-stat">0</div>
    <span class="u-stat-label">LLM calls for Lane A — 80% of all commits. Truly invisible.</span>
  </div>
  <div style={{padding:'2.5rem',borderRight:'1px solid rgba(0,0,0,0.12)',borderBottom:'1px solid rgba(0,0,0,0.12)'}}>
    <div class="u-stat">5</div>
    <span class="u-stat-label">ECO reliability dimensions. Each graduates to warn · escalate · block.</span>
  </div>
  <div style={{padding:'2.5rem',borderBottom:'1px solid rgba(0,0,0,0.12)'}}>
    <div class="u-stat">~200ms</div>
    <span class="u-stat-label">Post-commit index latency. Atomic. Silent. Every commit.</span>
  </div>
</div>

---

## What the System Does Not Do

The knowledge layer **does not understand code**. It retrieves structural facts, measures its own reliability, and communicates its limits. The reasoning happens in the LLM that consumes the ECO — the knowledge layer provides the evidence.

See [Design Boundaries](/docs/architecture/design-boundaries) for the full list of known limitations and gaps.
