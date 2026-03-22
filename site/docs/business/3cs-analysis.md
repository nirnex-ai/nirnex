---
id: 3cs-analysis
title: 3Cs Analysis
sidebar_label: 3Cs Analysis
sidebar_position: 3
description: Company, Customer, Competitor analysis for Nirnex.
---

<span class="u-eyebrow">Business Case · 06</span>

# 3Cs Analysis

---

## Company

**Nirnex** is a developer tooling product built on the insight that AI-assisted coding fails not because LLMs are weak, but because they lack **grounded structural evidence** about the codebase they are modifying.

**Core capabilities:**
- Post-commit codebase indexing at < 200ms latency
- Deterministic confidence scoring across five ECO dimensions
- Three-lane task classification that reduces LLM calls by 80%+ on typical commit volumes
- A Decision Ledger that makes every AI-assisted decision auditable and replayable

**Distribution:** CLI-first, npm-distributed, developer-local. No shared infrastructure required.

---

## Customer

**Primary:** Senior engineers and tech leads at teams shipping production software with AI coding tools.

**Pain being solved:** AI agents make plausible but structurally wrong plans because they do not know the actual codebase — what modules exist, what depends on what, what the blast radius of a change is.

**Behaviour signal:** Teams that already use AI coding tools but have experienced regressions or wrong plans caused by insufficient codebase context.

---

## Competitor

| Competitor | Approach | Gap Nirnex fills |
|------------|---------|-----------------|
| GitHub Copilot | File-level context, no structural index | No dependency graph, no confidence scoring |
| Cursor | Editor-embedded retrieval | No deterministic ECO, no lane classification |
| Cody (Sourcegraph) | Graph-based code search | Cloud dependency, no task pipeline integration |
| aider | Agent loop, no structural gate | No evidence sufficiency gate, no Decision Ledger |
| Manual planning | Human-only | Slow, doesn't scale to AI-assisted velocity |

Nirnex does not compete with AI coding assistants — it makes them more reliable by providing the evidence layer they are missing.
