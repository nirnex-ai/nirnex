---
id: design-principles
title: Design Principles
sidebar_label: Design Principles
sidebar_position: 2
description: The six immutable design principles that constrain every architecture decision in Nirnex.
---

<span class="u-eyebrow">v9.0 — Introduction</span>

# Design Principles

Six constraints that are **non-negotiable**. Every architecture decision is measured against them.

---

## 1 · Evidence Before Action

No planning step may proceed without a confidence-scored ECO. If the knowledge layer cannot produce sufficient evidence, the system stops and says so explicitly.

## 2 · Determinism Over Magic

Every score, every classification, every gate result must be reproducible from stored inputs. No probabilistic or LLM-gated decisions in the control path.

## 3 · Explicit Limits

The system must communicate what it does not know. Unknown is a valid, first-class answer. Silent failure is not tolerated.

## 4 · Minimal Footprint

Lane A tasks (80% of all commits) produce zero LLM calls. The system's default mode is hooks, not inference.

## 5 · Human Authority Preserved

The system recommends. Humans decide. Below confidence 60 the system is restricted to suggesting human actions only.

## 6 · Reversibility

Every decision is recorded in the Decision Ledger. Any task can be replayed from its stored ECO snapshot to debug or calibrate.
