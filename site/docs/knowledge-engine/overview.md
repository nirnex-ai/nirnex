---
id: overview
title: Knowledge Engine Overview
sidebar_label: Overview
sidebar_position: 1
description: The Knowledge Engine builds reliability-scored structural evidence from the codebase for every task.
---

<span class="u-eyebrow">Knowledge Engine · Layer 01</span>

# Knowledge Engine

The Knowledge Engine produces a **reliability-scored Execution Context Object (ECO)** for every task. It does not understand code — it retrieves structural facts, measures its own reliability, and communicates its limits.

---

## Responsibilities

1. **Parse** every commit into a structured module index (symbols, dependencies, exports)
2. **Detect intent** from the spec file — heuristic, 1–2 intents maximum
3. **Retrieve** evidence biased by detected intent
4. **Score** evidence across five ECO dimensions
5. **Gate** — block the pipeline if evidence is insufficient

---

## What It Is Not

- Not a code understanding engine
- Not an LLM wrapper
- Not a semantic search system (vector search is a Tier 3 fallback only)

Reasoning happens in the consuming LLM. The Knowledge Engine provides the evidence that makes that reasoning grounded.

---

## Components

| Component | Role |
|-----------|------|
| [Parsing Layer](/docs/knowledge-engine/parsing-layer) | Tree-sitter + ctags, atomic post-commit |
| [Storage Layer](/docs/knowledge-engine/storage-layer) | SQLite schema, WAL mode, FTS5 |
| [Retrieval Sources](/docs/knowledge-engine/retrieval-sources) | Four-tier retrieval cascade |
| [Query Router](/docs/knowledge-engine/query-router) | Intent-biased tier selection |
| [Confidence Scoring](/docs/knowledge-engine/confidence-scoring) | Deterministic 0–100 penalty matrix |
