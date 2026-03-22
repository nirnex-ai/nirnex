---
id: confidence-scoring
title: Confidence Scoring
sidebar_label: Confidence Scoring
sidebar_position: 6
description: Deterministic 0–100 confidence score. Ten deduction rules, fully transparent, severity-weighted.
---

<span class="u-eyebrow">Knowledge Engine · Layer 01</span>

# Confidence Scoring

Every query result carries a **deterministic confidence score**. Base 100, with ten specific deduction rules. No silent aggregation — every penalty appears individually in `penalties[]`.

:::info Design rule
Below confidence 60, `suggested_next` only recommends **human actions** — never automated steps. Below 20, the system refuses to proceed entirely.
:::

---

## Penalty Matrix

| Condition | Deduction | Rationale |
|---|---|---|
| LSP unavailable for queried language | **−25** | Symbol resolution unreliable |
| Index 1+ commits behind HEAD | **−20** | Structural data may be stale |
| Unresolved cross-layer conflict | **−20** | Two sources disagree on verifiable facts |
| Recursive CTE hit hub_node cap | **−15** | Blast radius truncated |
| Summary-only evidence (no structural backing) | **−15** | Evidence is lossy, not authoritative |
| ctags fallback active | **−10** | Reduced parsing precision |
| Vector dormant but `NEEDS_EXPLORE` triggered | **−10** | Semantic search unavailable |
| Graph truncated at depth limit | **−10** | Deeper dependencies unexplored |
| Dirty working tree | **−10** | Index reflects last commit, not current edits |
| Tier 3/4 degradation | **−30** | Multiple sources materially degraded |

`score = 100 − sum(deductions)`

---

## Confidence Labels

<div class="u-grid-3" style={{marginBottom:'2rem'}}>
  <div style={{padding:'2rem',background:'#0D0D0D',color:'#fff',borderRight:'1px solid rgba(255,255,255,0.08)'}}>
    <div class="u-stat" style={{fontSize:'3rem'}}>80–100</div>
    <span class="u-tag u-tag--vermilion" style={{marginTop:'1rem'}}>HIGH</span>
    <p style={{color:'#888',marginTop:'0.75rem',fontSize:'12px'}}>May suggest automated next step.</p>
  </div>
  <div style={{padding:'2rem',background:'#1A1A1A',color:'#fff',borderRight:'1px solid rgba(255,255,255,0.08)'}}>
    <div class="u-stat" style={{fontSize:'3rem'}}>60–79</div>
    <span class="u-tag" style={{marginTop:'1rem',background:'#333',color:'#ccc',border:'none'}}>MEDIUM</span>
    <p style={{color:'#666',marginTop:'0.75rem',fontSize:'12px'}}>Suggest narrower query or reindex.</p>
  </div>
  <div style={{padding:'2rem',background:'#222',color:'#fff'}}>
    <div class="u-stat" style={{fontSize:'3rem'}}>40–59</div>
    <span class="u-tag u-tag--muted" style={{marginTop:'1rem'}}>LOW</span>
    <p style={{color:'#555',marginTop:'0.75rem',fontSize:'12px'}}>Suggest human verification only.</p>
  </div>
</div>

| Score | Label | Behavior |
|---|---|---|
| 80–100 | **High** | May suggest automated next step |
| 60–79 | Medium | Suggest narrower query or reindex |
| 40–59 | Low | Human verification only |
| 20–39 | Unreliable | Suggest stopping automated work |
| 0–19 | Insufficient evidence | Cannot answer. Manual investigation required |
| N/A | Unknown | Cannot classify this query. Please rephrase |

---

## Governance Rules

- Every penalty fires individually — zero silent aggregation
- `penalties[]` array contains each: `{rule, deduction, detail}`
- New penalties require a **30-day trace review** before being added
- Monthly calibration via `dev replay --all --since 30d` tunes penalty weights
