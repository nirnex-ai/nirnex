---
id: adoption-design
title: Adoption Design
sidebar_label: Adoption Design
sidebar_position: 8
description: How Nirnex is designed to be adopted incrementally without disrupting existing workflows.
---

<span class="u-eyebrow">Reference</span>

# Adoption Design

Nirnex is designed to be installed in minutes and adopted incrementally. No workflow changes required for Lane A — the silent majority of commits.

---

## Installation Path

```bash
npm install -g @nirnex/cli
nirnex index          # first-time full index (~10–60s depending on repo size)
```

That is the entire setup. The post-commit hook installs automatically and keeps the index current.

---

## Zero-Disruption Default

Lane A runs **silently on every commit** — no prompts, no blocking, no workflow change. Developers only encounter Nirnex when a task is complex enough to require a spec file (Lane B or C).

The system never blocks a commit unless a validation gate explicitly fails — and gate failures are things that would fail CI anyway (type errors, failing tests).

---

## Incremental Adoption Stages

| Stage | What you get | Effort |
|-------|-------------|--------|
| **Install + index** | Post-commit indexing, `nirnex query` available | 5 minutes |
| **First spec file** | Lane B/C planning for one complex task | 30 minutes |
| **CI integration** | Gate results feed back into confidence scoring | 1 hour |
| **Ground truth reviews** | Monthly calibration begins | Ongoing, ~30 min/month |

---

## Team Adoption

Nirnex is per-developer. There is no shared server or shared state. Each developer has their own `.nirnex/index.db`. This means:

- No deployment required
- No shared infrastructure to maintain
- No single point of failure
- Adoption is opt-in per developer, not mandated by the team

The Decision Ledger is local. Traces do not leave the developer's machine unless they are explicitly exported.
