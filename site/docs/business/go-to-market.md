---
id: go-to-market
title: Go-to-Market
sidebar_label: Go-to-Market
sidebar_position: 6
description: Distribution strategy and growth model for Nirnex.
---

<span class="u-eyebrow">Business Case · 06</span>

# Go-to-Market

---

## Distribution Model

**npm-first, developer-viral.** Nirnex installs in one command. There is no signup, no account required, no data leaving the machine. The zero-friction install is the top of the funnel.

```bash
npm install -g @nirnex/cli
```

---

## Growth Loops

### Loop 1 — Individual → Team

1. Developer installs Nirnex individually
2. Uses it on a complex task, avoids a regression
3. Shows the Decision Ledger trace to their tech lead
4. Tech lead installs Nirnex for the whole team

**Accelerant:** The trace output is shareable. Developers naturally share it when debugging or in code review.

### Loop 2 — Team → Org

1. Team uses Nirnex for 60+ days, accumulates ground truth data
2. Calibration cycle produces measurable improvement in lane classification accuracy
3. Platform/DevEx team sees the data and wants it org-wide

**Accelerant:** Calibration metrics are exportable as a report. Platform teams love data.

---

## Launch Sequence

| Phase | Target | Goal |
|-------|--------|------|
| **Alpha** (now) | 50 individual developers | Product-market fit signal |
| **Beta** | 5 teams, 3–10 devs each | Team workflow validation |
| **Public launch** | HN, r/programming, dev Twitter | npm install count, Pro conversions |
| **Team push** | Direct outreach to tech leads at AI-heavy teams | First 20 team licenses |

---

## Key Metric

**Weekly active indexers** — the number of developers whose post-commit hook ran in the last 7 days. This is the truest proxy for daily value delivery.
