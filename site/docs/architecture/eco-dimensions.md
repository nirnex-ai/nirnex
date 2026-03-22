---
id: eco-dimensions
title: ECO Dimensions
sidebar_label: ECO Dimensions
sidebar_position: 3
description: The five reliability dimensions of the Execution Context Object — Coverage, Freshness, Mapping, Conflict, Graph.
---

<span class="u-eyebrow">Architecture · Intent & ECO</span>

# ECO Dimensions

The Execution Context Object (ECO) scores evidence across **five independent dimensions**. Each dimension graduates through three severity levels independently.

---

## The Five Dimensions

<div class="u-grid-3" style={{marginBottom:'2rem'}}>
  <div class="u-cell">
    <span class="u-eyebrow">Dimension 01</span>
    <h3>Coverage</h3>
    <p>What percentage of modules relevant to this task have been indexed and are structurally available?</p>
  </div>
  <div class="u-cell">
    <span class="u-eyebrow">Dimension 02</span>
    <h3>Freshness</h3>
    <p>How many commits behind HEAD is the index? Is the working tree dirty?</p>
  </div>
  <div class="u-cell">
    <span class="u-eyebrow">Dimension 03</span>
    <h3>Mapping</h3>
    <p>Can every spec reference (module name, symbol, file path) be resolved to a real codebase entity?</p>
  </div>
</div>

<div class="u-grid-3" style={{marginBottom:'2rem'}}>
  <div class="u-cell">
    <span class="u-eyebrow">Dimension 04</span>
    <h3>Conflict</h3>
    <p>Do any two retrieval sources return contradictory structural facts about the same entity?</p>
  </div>
  <div class="u-cell">
    <span class="u-eyebrow">Dimension 05</span>
    <h3>Graph</h3>
    <p>Is the dependency traversal complete, or was it truncated at a hub node or depth limit?</p>
  </div>
</div>

---

## Severity Levels per Dimension

| Level | Threshold | Effect |
|-------|-----------|--------|
| **OK** | Dimension passes all checks | No action |
| **warn** | Soft failure — evidence degraded but usable | Logged, reported to consumer |
| **escalate** | Hard soft failure — evidence unreliable | Lane forced up, analyst notified |
| **block** | Critical failure — cannot proceed | Pipeline halts, requires human input |

---

## Dimension Thresholds

| Dimension | warn | escalate | block |
|-----------|------|----------|-------|
| Coverage | < 90% | < 70% | < 50% |
| Freshness | 1 commit behind | 3+ commits behind | dirty tree + 1+ behind |
| Mapping | 1 unresolved ref | 2–3 unresolved | any ref to non-existent module |
| Conflict | 1 soft conflict | 1 hard conflict | unresolvable conflict |
| Graph | truncated at depth | hub node capped | > 40% blast radius unknown |

See [Severity Escalation](/docs/architecture/severity-escalation) for how these combine into lane classification.
