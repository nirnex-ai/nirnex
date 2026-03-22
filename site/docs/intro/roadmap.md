---
id: roadmap
title: Implementation Roadmap
sidebar_label: Roadmap
sidebar_position: 5
description: What to build first, 20-query benchmark, calibration timeline, and pending items. v9.0 specification.
---

import React from 'react';

<span class="u-eyebrow">Introduction · v9.0</span>

# Implementation Roadmap

The order is deliberate: everything depends on fresh, structured data. Build that first. Everything else is additive.

---

## Build Order

<div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:0}}>

{[
  ['01', 'Atomic commit-index (post-commit hook + SQLite)', 'Everything else depends on fresh, structured data'],
  ['02', 'tree-sitter parsing + entity normalizer', 'Populates modules, dependencies, edges tables'],
  ['03', 'Multi-label router + index queries', 'Enables basic dev plan queries against the index'],
  ['04', 'LSP integration (tsserver for TypeScript)', 'Adds symbol precision for the primary language'],
  ['05', 'Graph CTE with hub handling', 'Enables blast radius analysis'],
  ['06', 'ECO construction with 5 dimensions', 'Produces the contract that drives the pipeline'],
  ['07', 'Lane classification + strategy selection', 'Pipeline can now consume the ECO'],
  ['08', 'Task decomposition + TEE generation', 'Implementer agents have scoped boundaries'],
  ['09', 'Decision trace + replay engine', 'Debugging and calibration infrastructure'],
  ['10', 'Ground truth sampling + calibration file schema', 'Measurement infrastructure for continuous improvement'],
].map(([n, comp, why]) => (
  <React.Fragment key={n}>
    <div style={{padding:'1.25rem 1.5rem 1.25rem 0',borderBottom:'1px solid rgba(0,0,0,0.08)',fontWeight:900,fontSize:'0.85rem',color:'#D63318',letterSpacing:'0.1em',whiteSpace:'nowrap',paddingRight:'2rem'}}>{n}</div>
    <div style={{padding:'1.25rem 0',borderBottom:'1px solid rgba(0,0,0,0.08)'}}>
      <div style={{fontSize:'13px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'3px'}}>{comp}</div>
      <div style={{fontSize:'11px',fontWeight:300,color:'#777'}}>{why}</div>
    </div>
  </React.Fragment>
))}

</div>

---

## 20-Query Benchmark

Before team rollout, run **20 representative queries** against the target codebase to validate:

| Metric | What it proves |
|---|---|
| ECO dimension accuracy | Knowledge layer correctly characterizes codebase state |
| Lane classification correctness | Forced constraints trigger when they should |
| Strategy selection appropriateness | Intent-biased defaults make sense |
| Evidence checkpoint reliability | Binary pass/fail correlates with real evidence |

**Key threshold:** If Lane C rate exceeds **30% of non-trivial tasks**, loosen escalation thresholds.

Measure: `% blocked` · `% escalated to Lane C` · `% reclassified` · `% eventually judged correct`

---

## Calibration Timeline

```
Week 1–4:   System runs with default weights. Traces accumulate.
Week 4:     First calibration review.
            ~50–100 ground truth samples.
            Adjust penalty weights, routing keywords, severity thresholds.
Monthly:    dev replay --all --since 30d
            Verify improvements, detect regressions.
Ongoing:    Ground truth sampling at 5%.
            Calibration file grows.
```

---

## Pending Items (v9 Delta)

The v9 specification is complete. Implementation is pending for all v7–v9 additions:

- [ ] Build the v9 implementation (all specs defined, no code for v7–v9 additions)
- [ ] Run the 20-query benchmark against the target codebase
- [ ] Implement multi-label router with bitmask classification
- [ ] Implement severity-weighted cluster accumulation
- [ ] Implement replay engine (`dev replay` command)
- [ ] Set up ground truth sampling (5% capture + calibration file schema)
- [ ] Create ast-grep rules scoped to XState for `state_transition` edge type
- [ ] Define entity normalization rules between tree-sitter / LSP / ctags output formats
- [ ] First monthly calibration cycle (after 4 weeks of trace data)
