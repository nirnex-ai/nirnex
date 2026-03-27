<div align="center">
<img src="https://nirnex-ai.github.io/nirnex/img/nirnex-logo-navbar.svg?v=2" width="200" height="200"/>

# Nirnex (Pre-Alpha)
#### Decision Intelligence for Software Delivery

> Note: This project is in an experimental stage.

[![CI](https://github.com/nirnex-ai/nirnex/actions/workflows/ci.yml/badge.svg)](https://github.com/nirnex-ai/nirnex/actions/workflows/ci.yml)
[![Release](https://github.com/nirnex-ai/nirnex/actions/workflows/release.yml/badge.svg)](https://github.com/nirnex-ai/nirnex/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@nirnex/cli.svg)](https://www.npmjs.com/package/@nirnex/cli)

</div>

---

Nirnex helps engineering teams plan software changes using codebase structure, constraints, and confidence scoring.

It analyzes your repository, determines what should be built, how it should be built, and how safe that decision is — before code is written.

> Nirnex is not a code generator. It is a decision system that governs how software changes are planned and executed.

<video src="https://github.com/user-attachments/assets/ab7ffbfe-fa29-44b9-be6e-34fbfd810116" controls width="100%">
  Your browser does not support the video tag.
</video>


---

## Why Nirnex

Most AI-assisted development tools rely on text search and loosely scoped prompts. This works for small changes, but breaks down when:

- changes span multiple modules
- architecture matters
- dependencies are unclear
- confidence is unknown

Nirnex introduces structure into this process:

- understands repository relationships
- classifies change intent
- bounds execution scope
- assigns execution strictness (lanes)
- produces traceable, confidence-backed planning decisions

---

## Installation & Quickstart

### 1. Install CLI

```sh
npm install -g @nirnex/cli
```

### 2. Enable Nirnex in your project

```sh
cd your-project
nirnex setup
```

This command:

- creates a `.ai/` workspace
- generates project configuration
- initializes the structural index
- scaffolds prompts and spec folders
- optionally installs a git freshness hook

### 3. Verify setup

```sh
nirnex status
```

### 4. Run your first plan

```sh
nirnex plan "Fix button padding on mobile"
```

Or using a spec file:

```sh
nirnex plan .ai/specs/add-retry.md
```

## What `nirnex setup` Creates (and `nirnex remove` Cleans Up)

```
.ai/
  specs/
  prompts/
    analyst.md
    implementer.md
  critical-paths.txt
  calibration/

.ai-index/
nirnex.config.json
```

| Path | Purpose |
|---|---|
| `.ai/specs/` | Structured specs for reliable planning |
| `.ai/prompts/` | System prompts for analysis and implementation behavior |
| `.ai/critical-paths.txt` | Defines high-risk areas triggering stricter execution |
| `.ai/calibration/` | Stores evaluation data (optional, advanced use) |
| `.ai-index/` | Local structural graph of your repository |
| `nirnex.config.json` | Source of truth for project configuration |

---

## Requirements

- Node.js >= 20
- git
- tree-sitter CLI
- ast-grep CLI (recommended)

For planning, set your API key:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Current Version

**v5.4.0** — See [releases](https://github.com/nirnex-ai/nirnex/releases) for the full changelog.

Check your installed version at any time:

```sh
nirnex version
```

---

## Core Commands

### `nirnex setup`

Initialize Nirnex in a repository.

```sh
nirnex setup
```



### `nirnex remove`

Safely detach Nirnex from a repository without touching source code, build config, or user-authored files.

```sh
nirnex remove
```

By default, `nirnex remove` runs interactively: it scans for Nirnex artifacts, shows a removal plan, and asks for confirmation before making any changes.

**What gets removed**

| Artifact | Behavior |
|---|---|
| `nirnex.config.json` | Deleted if it matches the Nirnex config shape |
| `.aidos.db` | Deleted (SQLite index database) |
| `.ai-index/` | Deleted recursively (runtime index data) |
| `.ai/prompts/analyst.md` | Deleted only if content still matches the setup default |
| `.ai/prompts/implementer.md` | Deleted only if content still matches the setup default |
| `.ai/calibration/README.md` | Deleted only if content still matches the setup default |
| `.ai/critical-paths.txt` | Deleted only if content still matches the setup default |
| `.ai/specs/` | **Never auto-deleted** — preserved and reported for manual review |
| `.claude/hooks/nirnex-*.sh` | Deleted if content exactly matches the Nirnex launcher templates |
| `.claude/settings.json` | Surgically patched — only Nirnex hook bindings removed, all other settings preserved |
| `.git/hooks/post-commit` | Deleted if it contains only `nirnex index`; patched to remove that line if it contains other commands |

Empty parent directories (`.claude/hooks/`, `.claude/`, `.ai/prompts/`, etc.) are removed after their contents are cleared.

**Flags**

| Flag | Behavior |
|---|---|
| `--dry-run` | Show the full removal plan without making any changes |
| `--yes` / `-y` | Auto-approve all safe actions (skips global confirmation prompt) |
| `--force` | Apply safe and medium-confidence actions without per-action prompts |
| `--keep-data` | Preserve `.ai/`, `.ai-index/`, and `.aidos.db` |
| `--keep-specs` | Preserve `.ai/specs/` (also the default behavior) |
| `--keep-claude` | Preserve all Claude integration (hook scripts and settings) |
| `--purge-data` | Delete `.ai/` entirely, including user-authored specs (requires confirmation) |
| `--json` | Machine-readable JSON output |

**Examples**

```sh
# Preview what would be removed — no changes made
nirnex remove --dry-run

# Remove everything without prompts
nirnex remove --yes

# Remove runtime/config but keep .ai/ workspace
nirnex remove --keep-data

# Remove everything including user-authored .ai/ content
nirnex remove --purge-data

# Machine-readable output for scripting
nirnex remove --dry-run --json
```

**Ownership model**

`nirnex remove` only deletes what it can prove Nirnex created. For template files, it compares content against the known setup defaults — if you have edited the file, it is preserved and listed under "manual review." For shared files like `.claude/settings.json`, it patches out only the Nirnex-owned entries rather than deleting the whole file.

Any files listed under "preserved" in the output can be cleaned up manually if needed.

---

### `nirnex status`

Check repository health.

```sh
nirnex status
```



### `nirnex index`

Build or refresh the structural index.

```sh
nirnex index                      # incremental — changed files only (via git diff)
nirnex index --rebuild            # full rebuild — re-parses every .ts / .tsx file

# Scope control
nirnex index --ignore "src/legacy/**,vendor/**"   # exclude patterns from this run
nirnex index --include "vendor/special.ts"        # force-include a specific path

# Explain why a file was indexed or excluded
nirnex index --explain-scope src/api/payments.ts
```

**Scope tiers**

Every file in the repo is assigned a tier before parsing begins:

| Tier | Meaning |
|---|---|
| `FULL` | File is fully parsed and included in the dependency graph |
| `EXCLUDED` | File is recorded but not parsed (presence tracked, no symbols or deps) |

The classifier runs through these rules in order (first match wins):

| Priority | Rule | Tier |
|---|---|---|
| 1 | Binary extension (`.png`, `.mp4`, `.woff`, …) | `EXCLUDED` |
| 2 | Unsupported extension (not `.ts` / `.tsx`) | `EXCLUDED` |
| 3 | File exceeds size limit (default: 1 MB) | `EXCLUDED` |
| 4 | Matched by `--include` or `.nirnexinclude` | `FULL` |
| 5 | Matched by `--ignore` or `.nirnexignore` | `EXCLUDED` |
| 6 | Known build output / noise (`dist/`, `.next/`, `.d.ts`, …) | `EXCLUDED` |
| 7 | Framework-critical file (`page.tsx`, `layout.tsx`, `route.ts`, …) | `FULL` |
| 8 | Execution-critical file (`.service.ts`, `routes/`, `store/`, …) | `FULL` |
| 9 | Everything else | `FULL` |

**Scope summary**

Every run prints a scope summary:

```
────────────────────────────────────────────────
  Nirnex Index — Scope Summary
────────────────────────────────────────────────
  Candidates scanned : 312
  FULL indexed       : 198
  EXCLUDED           : 114

  Top exclusion sources:
    builtin       KNOWN_NOISE                       87 files
    nirnexignore  src/legacy/**                     14 files
    builtin       HARD_SCREEN_UNSUPPORTED_EXT        9 files
    cli           vendor/**                          4 files

  FULL — reasons:
    default full                  121 files
    execution critical             44 files
    framework critical             33 files

  Duration: 412ms
────────────────────────────────────────────────
```

**Explain scope**

To understand why a specific file was included or excluded:

```sh
nirnex index --explain-scope src/services/auth.service.ts
```

```
  Path          : src/services/auth.service.ts
  Tier          : FULL
  Reason code   : EXECUTION_CRITICAL
  Decision from : builtin
  Explanation   : heuristic: path pattern matches runtime-bearing file
```

**Scope control files**

Create `.nirnexignore` or `.nirnexinclude` at your repo root to persist scope rules across runs:

```sh
# .nirnexignore
src/legacy/**
vendor/**
**/__generated__/**
```

```sh
# .nirnexinclude
vendor/special.ts
```

Pattern precedence (highest first): `--include` > `--ignore` > `.nirnexinclude` > `.nirnexignore` > built-in defaults.

**Schema migrations**

When the index schema changes between versions, Nirnex detects this automatically:

```sh
# If you see: "Index schema is out of date. Run: nirnex index --rebuild"
nirnex index --rebuild
```

**Output states**

| State | What it means |
|---|---|
| `Finished: 198 FULL, 114 EXCLUDED` | All FULL-tier files parsed successfully |
| `Finished with degraded coverage: 195/198 indexed, 3 failed` | Some files could not be parsed — index is partial |

When parse failures occur, Nirnex prints each failed file and the stage where it failed:

```
[nirnex index]   suspected cause: parse stage failure (.tsx / tsx grammar)
[nirnex index]   debug details → .ai-index/nirnex-debug.log
[nirnex index]   ✖ apps/frontend/app/ui-showcase/page.tsx
[nirnex index]   ✖ apps/frontend/components/platform-collaboration-components.tsx
[nirnex index] 2 parser failures recorded → .ai-index/nirnex-debug.log
```

The full structured record is written to `.ai-index/nirnex-debug.log` — see [Parser Diagnostics](#parser-diagnostics) below.



### `nirnex query`

Explore codebase structure with confidence signals.

```sh
nirnex query "What depends on paymentMachine?"
```



### `nirnex plan`

Generate a bounded planning decision.

```sh
nirnex plan "Fix button padding"
nirnex plan .ai/specs/add-retry.md
```



### `nirnex trace`

Inspect decision traces.

```sh
nirnex trace --last
nirnex trace --list
nirnex trace --id tr_xxx
```



### `nirnex override`

Bypass restrictions with audit logging.

```sh
nirnex override --reason "Hotfix" plan .ai/specs/file.md
```



### `nirnex replay`

Re-evaluate past decisions.

```sh
nirnex replay --trace tr_xxx
nirnex replay --all --since 7d
```



### `nirnex version`

Print the installed version.

```sh
nirnex version
```



### `nirnex update`

Check npm for a newer version and install it if one is available.

```sh
nirnex update
```

No arguments needed — it fetches the latest `@nirnex/cli` from the npm registry, compares it against your installed version, and runs the upgrade automatically.

---

## Spec Files

Spec files improve planning accuracy.

### Examples

**New Feature**

```md
## In Scope
## Out of Scope
## Acceptance Criteria
```

**Bug Fix**

```md
## Reproduction Steps
## Expected vs Actual
```

**Refactor**

```md
## Current Structure
## Target Structure
```

**Dependency Update**

```md
## Old Dependency
## New Dependency
```

**Config / Infra**

```md
## env var
## config
```

> **Note:** Maximum 2 intents per spec. More than 2 → split the spec. Composite intent increases execution strictness.

---

## Core Concepts

### Execution Context Object (ECO)

A bounded representation of a task. Includes:

- intent
- scope
- constraints
- confidence
- conflict report (typed, not a scalar)

---

### Confidence Score

Indicates how safe the decision is:

| Score | Meaning |
|---|---|
| 80–100 | High (safe to automate) |
| 60–79 | Medium (bounded execution) |
| 40–59 | Low (requires validation) |
| 20–39 | Unreliable |
| 0–19 | Insufficient |

---

### Execution Lanes

Defines how strict execution should be:

- **Lane A** → small, isolated changes
- **Lane B** → structured work with spec; elevated constraints
- **Lane C** → architectural or high-risk changes; critical path involved
- **Lane D** → restricted; requires explicit human sign-off
- **Lane E** → blocked; forced by `forced_unknown` or unresolvable constraints

Lane assignment is determined by the `LaneClassifier` using a four-tier precedence chain (P1–P4). See [Stage Machine](#stage-machine-determinism--enforcement) for details.

---

### Constraint Dimensions

Nirnex evaluates five dimensions per request. Each runs an **independent evaluator** with its own normalized signals, threshold policy, and reason codes — no cross-dimension coupling:

| Dimension | What it measures | Hard block condition |
|---|---|---|
| Coverage | How completely retrieved evidence covers the requested scope and intent | All mandatory evidence classes missing |
| Freshness | How current the index is relative to HEAD (scope-aware) | Stale impact ratio ≥ 0.60, or required scope deleted/renamed |
| Mapping Quality | How precisely the request maps to a bounded implementation target | No scoped candidates, scattered+no primary, all evidence out-of-scope, or scattered+fragmented clusters |
| **Conflict** | Whether evidence sources make incompatible claims about the same subject | Blocking semantic or structural conflict |
| Graph Completeness | Depth and symbol resolution completeness for the required reasoning path | Critical nodes missing from required scope |

These directly influence confidence and lane selection. All five dimensions are **independent** — a block on one cannot be masked or overridden by a high score on another.

---

### Knowledge Layer — ECO Dimension Computation

Each of the five dimensions runs a distinct pure-function evaluator. All evaluators share a single normalized input object (`DimensionSignals`) — preventing architecture leakage and coupling between subsystems.

#### Architecture

```
buildECO()
  │
  ├── detectConflicts()         → eco.conflicts (Sprint 8)
  ├── computeFreshnessImpact()  → eco.freshness (Sprint 9)
  │
  ├── scoreDimensions()         → eco.eco_dimensions (Sprint 11+, v3.0.0)
  │     │
  │     ├── buildDimensionSignals()   — single normalization boundary
  │     ├── getThresholds(intent)     — centralized threshold policy
  │     │
  │     ├── buildRawCausalSignals()  — emit causal signals per dimension (Sprint 16)
  │     ├── clusterCausalSignals()   — group by root cause, assign primary/derived (Sprint 16)
  │     │
  │     ├── computeCoverageDimension()
  │     ├── computeFreshnessDimension()
  │     ├── computeMappingDimension() ──→ scoreMappingQuality() (Sprint 14)
  │     ├── computeConflictDimension()
  │     └── computeGraphCompletenessDimension()
  │           │
  │           ├── attachCausalProvenance()        (annotate DimensionResult.causal)
  │           └── composite_internal_confidence  (suppression-aware weighted, severity-capped)
  │
  └── scoreMappingQuality()     → eco.mapping_quality (Sprint 14)
        │
        ├── computeScopeAlignmentScore()        (weight: 35%)
        ├── computeStructuralCoherenceScore()   (weight: 30%)
        ├── computeEvidenceConcentrationScore() (weight: 20%)
        └── computeIntentAlignmentScore()       (weight: 15%)
```

#### Signal isolation contract

All evaluators read only from `DimensionSignals`. They never read from raw `ConflictRecord[]`, `FreshnessImpact`, or any other subsystem object directly. `buildDimensionSignals()` is the single conversion boundary between raw ECO-builder data and the evaluator layer.

#### Composite confidence

The final `confidence_score` is a weighted sum of each dimension's normalized value (0–100), subject to severity caps:

| Dimension | Weight |
|---|---|
| Coverage | 25% |
| Mapping | 25% |
| Freshness | 20% |
| Conflict | 20% |
| Graph Completeness | 10% |

Severity caps applied after weighting:

| Condition | Cap |
|---|---|
| Any dimension → `block` | ≤ 40 |
| Any dimension → `escalate` (no block) | ≤ 70 |

#### Dimension output shape (`DimensionResult`)

Every evaluator returns the same contract:

```typescript
{
  value:        number;          // 0..1 normalized score
  status:       'pass' | 'warn' | 'escalate' | 'block';
  reason_codes: string[];        // stable machine-readable codes for ledger/replay
  summary:      string;          // short human-safe description
  provenance: {
    signals:    string[];        // which input signals were used
    thresholds: Record<string, number>;  // exact threshold values applied
  };
  metrics:      Record<string, number | string | boolean>;  // raw inputs for calibration
}
```

#### Default thresholds

```typescript
coverage:  { pass: 0.80, warn: 0.60, escalate: 0.30 }
freshness: { pass: 1.00, warn: 0.85, escalate: 0.60 }
mapping:   { pass: 0.80, warn: 0.60, escalate: 0.30 }
conflict:  { pass: 1.00, warn: 0.75, escalate: 0.40 }
graph:     { pass: 0.80, warn: 0.60, escalate: 0.30 }
```

`getThresholds(intent?)` is exported for callers that need intent-specific overrides.

#### Mapping Quality Metric (Sprint 14)

`computeMappingDimension()` now delegates to a **quantitative 4-sub-metric scoring engine** (`scoreMappingQuality`) instead of the previous qualitative pattern-only evaluation.

**Sub-metrics and weights:**

| Sub-metric | Weight | Measures |
|---|---|---|
| `scope_alignment` | 35% | Evidence overlap with the requested execution scope |
| `structural_coherence` | 30% | Whether evidence forms a coherent dependency chain |
| `evidence_concentration` | 20% | Dominance of the primary candidate over alternatives |
| `intent_alignment` | 15% | Evidence type and pattern fit for the declared intent |

**Scoring thresholds (0–100 scale):**

| Score | Level |
|---|---|
| 90–100 | `pass` |
| 75–89 | `warn` |
| 55–74 | `escalate` |
| 0–54 | `block` |

Per-intent threshold overrides are available via `getMappingThresholds(intent?)`.

**Hard-block conditions** (override composite score — always force `block`):
- No mapping candidates retrieved (system is blind)
- Scattered pattern with zero primary candidate score
- All candidates are outside the requested scope
- Scattered pattern with more than 3 disconnected evidence clusters

**ECO output:**

```typescript
eco.mapping_quality: MappingQualityResult  // full typed result
eco.eco_dimensions.mapping.severity        // aligned with mapping_quality.level
eco.eco_dimensions.mapping.detail          // first reason from mapping_quality.reasons[]
```

**Ledger integration:**

```typescript
import { fromMappingQualityScored } from '@nirnex/core/runtime/ledger/mappers';

const entry = fromMappingQualityScored(mqResult, { trace_id, request_id, intent: 'bug_fix' });
// entry.payload.decision_code === 'MAPPING_QUALITY_SCORED'
// entry.stage === 'eco'
```

**Backward compatibility:** `DimensionSignals.allCandidateScores` and `.disconnectedClusterCount` are populated by `buildDimensionSignals()`. When these signals are absent (legacy callers), `buildMappingQualityInput()` derives safe conservative defaults from `mappingRootsRanked` and the mapping pattern.

`CALCULATION_VERSION` was bumped to `2.0.0` to mark this semantic change to the scoring algorithm.

#### Ledger trace

Every scoring session can be captured for replay and calibration via `traceDimensionScoring()`:

```typescript
import { traceDimensionScoring } from '@nirnex/core/knowledge/ledger/traceDimensionScoring';

const trace = traceDimensionScoring(dimOutput);
// trace.coverage.status       — top-level access
// trace.dimensions.coverage   — nested iteration
// trace.signal_snapshot       — full replay input snapshot
// trace.calculation_version   — semver for calibration diff
```

The trace record stores all five dimension entries at **both** top-level (`.coverage`) and nested (`.dimensions.coverage`) for backward-compatible iteration.

#### Module structure

```
packages/core/src/knowledge/dimensions/
  types.ts               — DimensionResult, DimensionSignals, RawDimensionInput, ScoreDimensionsOutput
  reason-codes.ts        — stable machine-readable reason code constants (all 5 dimensions)
  thresholds.ts          — DEFAULT_THRESHOLDS, getThresholds(intent?)
  signals.ts             — buildDimensionSignals() — single normalization boundary
  coverage.ts            — computeCoverageDimension()
  freshness.ts           — computeFreshnessDimension()
  mapping.ts             — computeMappingDimension()
  conflict.ts            — computeConflictDimension()
  graphCompleteness.ts   — computeGraphCompletenessDimension()
  scoreDimensions.ts     — coordinator: scoreDimensions(), CALCULATION_VERSION
  index.ts               — re-exports

packages/core/src/knowledge/ledger/
  traceDimensionScoring.ts — DimensionScoringTrace, traceDimensionScoring()
```

---

### Scope-Aware Freshness

Nirnex does not apply a flat penalty whenever the index is stale. It computes **which changed files intersect the scopes required by the current request**, and only penalises confidence when that intersection is non-empty.

#### The three freshness states

| State | Meaning | Effect |
|---|---|---|
| `fresh` | Index commit matches HEAD | No penalty |
| `stale_unrelated` | Index stale, but no required scope changed | No penalty — staleness is irrelevant to this request |
| `stale_impacted` | Stale scopes overlap required scopes | Graduated penalty based on impact ratio |

#### Severity thresholds (deterministic)

Freshness severity is computed from the **impact ratio** — the fraction of required scopes that are stale:

| Severity | Condition | Confidence deduction |
|---|---|---|
| `none` | No intersection | 0 pts |
| `warn` | Ratio > 0 and < 0.25 | −5 pts |
| `escalate` | Ratio ≥ 0.25 and < 0.60 | −15 pts |
| `block` | Ratio ≥ 0.60 | −25 pts |
| `block` | Any deleted or renamed required scope | −25 pts |

#### What the ECO carries

```json
{
  "freshness": {
    "status": "stale_impacted",
    "indexedCommit": "abc1234",
    "headCommit": "def5678",
    "impactedFiles": ["src/services/payments.ts"],
    "impactedScopeIds": ["src/services/payments.ts"],
    "impactRatio": 0.33,
    "severity": "escalate",
    "provenance": {
      "requiredScopesSource": ["retrieval", "retrieval"],
      "staleScopesSource": ["src/services/payments.ts"]
    }
  }
}
```

#### Reason codes (for trace and replay)

| Code | When emitted |
|---|---|
| `INDEX_FRESH` | Index is current |
| `INDEX_STALE_NO_SCOPE_INTERSECTION` | Stale, but no required scope affected |
| `INDEX_STALE_SCOPE_INTERSECTION_LOW` | Impact ratio < 0.25 (warn) |
| `INDEX_STALE_SCOPE_INTERSECTION_MEDIUM` | Impact ratio ≥ 0.25 (escalate) |
| `INDEX_STALE_SCOPE_INTERSECTION_HIGH` | Impact ratio ≥ 0.60 (block) |
| `INDEX_STALE_REQUIRED_SCOPE_DELETED` | A required file was deleted since last index |
| `INDEX_STALE_REQUIRED_SCOPE_RENAMED` | A required file was renamed since last index |

#### Design constraints

- No global stale penalty. If the changed files are unrelated to the request, confidence is not affected.
- All thresholds are deterministic — no model inference.
- Deleted or renamed required scopes always escalate to `block`, regardless of ratio.
- Freshness penalty is independent of coverage, mapping, and conflict dimensions.
- Failure to compute freshness degrades gracefully — ECO continues with `severity: pass`.

#### Module structure

```
packages/core/src/knowledge/freshness/
  types.ts                    — FreshnessSnapshot, RequiredScopeRef, StaleScopeRef, FreshnessImpact
  freshness-reason-codes.ts   — 7 machine-readable reason code constants
  build-freshness-snapshot.ts — git diff integration (isolated here only)
  extract-stale-scopes.ts     — FreshnessSnapshot → StaleScopeRef[]
  extract-required-scopes.ts  — ECO data → RequiredScopeRef[]
  compute-freshness-impact.ts — deterministic intersection engine
  index.ts                    — re-exports
```

---

### Conflict Detection

Nirnex includes a typed conflict detection subsystem that runs on every planning request and produces a structured `ConflictReport` before any code is written.

#### What conflicts are detected

**Structural conflicts** — derived from the dependency graph:

| Type | What triggers it |
|---|---|
| `circular_dependency` | A dependency cycle touches the requested edit scope |
| `hub_collision` | The scope includes a high-centrality node (>50 inbound edges) |
| `ownership_overlap` | The scope spans incompatible architectural zones (e.g. API layer × UI layer) |
| `entrypoint_mismatch` | A domain-intent query maps only to display-layer paths |

**Semantic conflicts** — derived from retrieved evidence (spec, docs, bug reports, code):

| Type | What triggers it |
|---|---|
| `source_claim_contradiction` | Two sources make opposing factual claims about the same subject |
| `spec_code_divergence` | The spec asserts something exists; the code evidence shows it is absent |
| `multi_source_disagreement` | Non-code sources (spec, docs, bug report) contradict each other |
| `ambiguity_cluster` | Multiple competing implementation targets found with no clear winner |

#### Gate behavior

Conflict severity determines what Nirnex allows next:

| Gate outcome | When |
|---|---|
| **Pass** | No material conflicts, or only low-severity advisory findings |
| **Warn** | Medium-severity conflict — bounded execution is still safe |
| **Ask** | Ambiguous target or multi-source disagreement — clarification required before commit |
| **Explore** | High-severity structural conflict — investigation allowed, commit disabled |
| **Refuse** | Blocking conflict — safe bounded execution is impossible |

#### Conflict output in ECO

Each ECO now carries a typed conflict payload:

```json
{
  "eco_dimensions": {
    "conflict": {
      "severity": "escalate",
      "detail": "2 high-severity conflict(s) require review.",
      "conflict_payload": {
        "score": 0.25,
        "severity": "escalate",
        "conflicts": [ ... ],
        "dominant_conflicts": ["<id>"]
      }
    }
  },
  "gate_decision": {
    "behavior": "explore",
    "reason": "Contradictory evidence detected. Investigation allowed, commit disabled.",
    "dominant_conflict_ids": ["<id>"]
  },
  "tee_conflict": {
    "blocked_paths": [],
    "blocked_symbols": [],
    "clarification_questions": [],
    "proceed_warnings": ["[EXPLORE] Scope touches hub node: src/core/index.ts"]
  }
}
```

#### Design constraints

- Every conflict record includes at least one cited evidence reference.
- Semantic contradictions require claims from at least two **different** sources.
- Semantic detection is rule-based — no LLM inference. Same input always yields the same result.
- Conflict score is independent of coverage and mapping scores inside the ECO.
- A failure in semantic detection degrades gracefully to structural-only mode with a trace note.

#### Extending conflict detection

To add a new detector:

1. Create a file under `packages/core/src/knowledge/conflict/structural/` or `semantic/`.
2. Export a function that returns `ConflictRecord[]`.
3. Register it in `packages/core/src/knowledge/conflict/detect-conflicts.ts`.

The downstream contract (`ConflictRecord`, `ECOConflictDimension`, `TEEConflictSection`) does not change when new detectors are added.

---

### Decision Ledger

Nirnex maintains a **canonical Decision Ledger** — a versioned, validated, append-only audit store that captures every governance-relevant event across the planning pipeline. The ledger is distinct from the existing JSON trace system: traces are observability artifacts; ledger entries are governance records.

#### Why a separate ledger

The existing trace system writes ad-hoc JSON blobs to `.ai-index/traces/`. These are readable but not structured for:
- override accountability (who bypassed what, and why)
- outcome traceability without inspecting raw traces manually
- replay verification (same inputs → same outputs)
- calibration sampling

The Decision Ledger addresses all of these without replacing or modifying the trace system.

#### LedgerEntry — canonical envelope

Every persisted record conforms to:

```typescript
{
  schema_version:    '1.0.0',      // increments on incompatible changes
  ledger_id:         string,       // unique record ID (crypto.randomUUID)
  trace_id:          string,       // execution trace root (per runOrchestrator call)
  request_id:        string,       // user request root (multiple traces may share one request)
  tee_id?:           string,
  parent_ledger_id?: string,       // parent-child chain (see semantics below)
  timestamp:         string,       // ISO 8601 — mapper-supplied, not writer-generated
  stage:             LedgerStage,
  record_type:       LedgerRecordType,  // SQL projection of payload.kind — must match
  actor:             'system' | 'analyst' | 'human',
  payload:           LedgerPayload,
}
```

**`record_type` is the SQL-queryable projection of `payload.kind`.** They must always be equal. The validator enforces this as a hard error — mismatch indicates a mapper bug.

#### Five record families

| Record type | When emitted | Hard fields |
|---|---|---|
| `decision` | Any stage decision (intent, ECO, gate, lane, etc.) | `decision_code`, `result.status`, `rationale` |
| `override` | System protection bypassed | `override_id`, `effect`, `approved_by`, `scope` |
| `outcome` | Terminal state (merged / escalated / refused / abandoned) | `completion_state`, `final_disposition_reason` |
| `refusal` | Hard block issued | `refusal_code`, `refusal_reason`, `blocking_dimension` |
| `deviation` | Drift from expected behavior detected | `detected_at_stage`, `severity`, `disposition` |

`record_type: 'trace'` exists for legacy Sprint 6 import only. New code must use the typed families.

#### Parent semantics

```
1. Stage DecisionRecords — linear pipeline chain:
   parent_ledger_id = previous stage's ledger_id (undefined for first stage)

2. OverrideRecords — point to the overridden record:
   parent_ledger_id = ledger_id of the target record

3. OutcomeRecord — points to last stage:
   parent_ledger_id = last CLASSIFY_LANE record's ledger_id

4. Trace-adapter records (legacy):
   parent_ledger_id = undefined
```

#### Orchestrator integration

The orchestrator emits a ledger entry after each stage and a terminal `OutcomeRecord` at completion. Integration is opt-in via an optional callback:

```typescript
await runOrchestrator(
  {
    specPath: null,
    query: 'fix the timeout',
    onLedgerEntry: (entry) => appendLedgerEntry(db, entry),
  },
  handlers,
);
// Produces: 5 DecisionRecords (one per stage) + 1 OutcomeRecord = 6 entries minimum
// On gate non-pass: also emits 1 RefusalRecord → 7 entries total
```

If `onLedgerEntry` is absent, pipeline behavior is unchanged (backward compatible).

#### Storage

Separate SQLite DB from the index: `.aidos-ledger.db` per project root.

```typescript
import { initLedgerDb, getLedgerDbPath, appendLedgerEntry } from '@nirnex/core/runtime/ledger';

const db    = initLedgerDb(getLedgerDbPath(targetRoot));
const entry = fromBoundTrace(stageResult.trace, { trace_id, request_id, stage: 'knowledge' });
appendLedgerEntry(db, entry);
```

**Write rule**: No component writes raw JSON directly to ledger storage. All writes through `appendLedgerEntry`.

#### Read path

```typescript
import { LedgerReader } from '@nirnex/core/runtime/ledger';

const reader = new LedgerReader(db);

reader.fetchByTraceId(traceId)      // all records for a trace, ASC
reader.buildTimeline(traceId)       // audit timeline (alias for fetchByTraceId)
reader.fetchOutcome(traceId)        // latest OutcomeRecord (multiple allowed — latest wins)
reader.fetchOverrides(requestId)    // all overrides for a request, across traces
reader.fetchRefusals(requestId)     // all refusals for a request
reader.fetchByStage(traceId, stage) // filter by stage
```

**Multiple-outcome policy**: allowed by design — retries create a new trace_id under the same request_id. `fetchOutcome(traceId)` returns latest by timestamp; superseded outcomes remain in the ledger (append-only).

#### Mappers — subsystem → LedgerEntry

```typescript
fromBoundTrace(bt, opts)               // pipeline BoundTrace → DecisionRecord
fromDimensionScoringTrace(dt, opts)    // ECO scoring → DecisionRecord
fromConflictEvents(events, opts)       // ConflictLedgerEvent[] → single DecisionRecord
fromRefusal(stage, code, reason, opts) // gate block → RefusalRecord
fromOrchestratorResult(result, opts)   // OrchestratorResult → OutcomeRecord
fromTraceJson(json, opts)              // LEGACY: Sprint 6 trace → record_type: 'trace'
```

`fromConflictEvents` collapses multiple events into one decision record — preserving event count and stable refs in `rationale.signal_refs` without record explosion.

#### Validation

Every write is validated before persistence. A mismatch between `record_type` and `payload.kind` is a hard error:

```typescript
validateLedgerEntry(entry)   // { valid: boolean, errors: string[] }
// Enforces: payload.kind === record_type (hard invariant — mismatch is invalid)
```

#### Module structure

```
packages/core/src/runtime/ledger/
  types.ts       — LedgerEntry + 5 record families (discriminated union)
  schema.ts      — SQL DDL, getLedgerDbPath()
  validators.ts  — structural + kind↔record_type invariant validators
  writer.ts      — initLedgerDb(), appendLedgerEntry() (insert-only)
  reader.ts      — LedgerReader class
  mappers.ts     — 7 subsystem-to-LedgerEntry mapper functions (incl. fromEvidenceGateDecision)
  index.ts       — re-exports
```

---

### Evidence Sufficiency Gate

The Evidence Sufficiency Gate is the **single runtime authority** on whether the system has enough evidence to proceed for the current intent. It sits at `SUFFICIENCY_GATE` — the third pipeline stage — and is a hard enforcement boundary before TEE construction.

#### Problem it solves

Prior to Sprint 13, `checkEvidence()` was an unconditional-pass stub. The gate stage existed in the pipeline's type system and the orchestrator's stage ordering, but it never actually evaluated anything. This broke the architecture's main safety promise: _refuse if blind_.

#### Three-verdict contract

The gate evaluates ECO output and returns exactly one of:

| Verdict | Pipeline behavior | When |
|---|---|---|
| `pass` | Continue to TEE\_BUILD | Evidence is sufficient for the detected intent |
| `clarify` | Hard stop — emit refusal ledger entry, return `behavior: 'ask'` | Evidence is partial; clarification would unlock execution |
| `refuse` | Hard stop — emit refusal ledger entry, return `behavior: 'block'` | Evidence is insufficient or condition is policy-unsafe |

Both `clarify` and `refuse` halt the pipeline. Advisory continuation is not permitted.

#### Per-intent evidence policies

Rules are not generic. Each intent class has its own `IntentEvidencePolicy` with a distinct set of `RuleCheck` functions:

| Intent | Mandatory evidence | Refuse triggers | Clarify triggers |
|---|---|---|---|
| `bug_fix` | Code path, mapping, coverage | forced\_unknown, conflict=block, coverage=block, mapping=block | Ambiguous mapping, no modules found, escalated coverage |
| `new_feature` | Bounded scope, graph path | forced\_unknown, conflict=block, coverage=block, graph=block | Ambiguous intent, incomplete graph, unclear scope |
| `refactor` | Graph coverage, no ownership overlap | forced\_unknown, conflict=block, graph=block | Incomplete graph, ownership overlap conflict |
| `dep_update` | Target dep + graph coverage | forced\_unknown, conflict=block, coverage=block, graph=block | Same clarify triggers as feature |
| `config_infra` | Target config area | forced\_unknown, conflict=block, coverage=block | High conflict (escalated) |
| `unknown` | (none — always refuses) | always (MISSING\_TARGET\_FILES) | n/a |

#### Evaluation flow

```
extract EvidenceGateFacts → resolve IntentEvidencePolicy → run all rules
→ accumulate worst verdict (refuse > clarify > pass) → build EvidenceGateDecision
```

#### Freshness handling

Freshness is intentionally non-blocking in standard intents. `freshness=block` triggers `clarify` (not `refuse`) — the user can re-index and retry. Only the `unknown` policy treats freshness as a potential refusal trigger.

#### Forced unknown

`eco.forced_unknown = true` is always a `refuse`, regardless of other dimension quality. This verdict is marked `overrideable: false` in the refusal payload — no downstream component may bypass it.

#### Decision provenance

Every `EvidenceGateDecision` includes:
- `perRuleResults[]` — each rule's pass/fail result with detail
- `provenance.dimensionsRead` — which ECO dimension severities were read
- `clarificationQuestions[]` — what is missing and what would satisfy the rule
- `refusalDetail` — why refused, which rules failed, which dimensions blocked, whether overrideable

#### Ledger integration

The gate emits two ledger entries on non-pass verdicts:
1. **RefusalRecord** — `refusal_code: 'EVIDENCE_GATE_REFUSED'` or `'EVIDENCE_GATE_CLARIFY'` at stage `classification`
2. **OutcomeRecord** — `completion_state: 'refused'` at stage `outcome`

A richer `fromEvidenceGateDecision()` mapper is available for detailed audit:

```typescript
import { fromEvidenceGateDecision } from '@nirnex/core/runtime/ledger';

const entry = fromEvidenceGateDecision(decision, { trace_id, request_id });
// Emits decision_code: 'EVIDENCE_GATE_EVALUATED' with per-rule signal_refs
```

#### Using the gate handler

```typescript
import { evidenceGateHandler } from '@nirnex/core/checkpoints';

await runOrchestrator(input, {
  SUFFICIENCY_GATE: evidenceGateHandler,
  // ... other handlers
});
```

#### Module structure

```
packages/core/src/runtime/evidence/
  types.ts        — EvidenceGateVerdict, EvidenceGateReasonCode, EvidenceGateFacts,
                    EvidenceGateDecision, IntentEvidencePolicy, RuleCheck, RuleResult
  rules.ts        — EVIDENCE_RULES_BY_INTENT table + getEvidencePolicy()
  checkpoints.ts  — evaluateEvidenceGate() + extractEvidenceFacts()
  index.ts        — public API + evidenceGateHandler (SUFFICIENCY_GATE stage handler)
```

#### Extension

To add a new intent class: add one `IntentEvidencePolicy` value to `EVIDENCE_RULES_BY_INTENT` in `rules.ts`. No changes to the evaluator, orchestrator, or pipeline types are needed.

---

### Stage Timeout Handling (Sprint 15)

The pipeline enforces a **deterministic per-stage timeout budget** so that a hung or slow stage cannot block the pipeline indefinitely. Each stage has an explicit millisecond deadline; if the deadline is exceeded the stage is either degraded (pipeline continues) or the pipeline is blocked (critical stages only).

#### Problem it solves

Without timeout enforcement, a network call, database lock, or infinite loop inside a stage handler can stall the entire pipeline. There is no bounded failure — the pipeline simply hangs. Sprint 15 adds a deterministic enforcement layer: every stage execution races against a configurable `setTimeout`, and the outcome is fully typed and traceable.

#### Mechanism

```
runStageWithTimeout(stageId, fn, config)
  │
  ├── new AbortController()
  ├── Promise.race([ fn(signal), timeoutPromise ])
  │
  ├── On success:   clearTimeout → StageExecutionResult { status: 'success' }
  ├── On timeout:   controller.abort() → StageExecutionResult { status: 'timed_out' | 'failed' }
  └── On error:     StageExecutionResult { status: 'failed' }
```

`fn` receives the `AbortSignal` for cooperative cancellation. When the timeout fires, the signal is aborted and the timeout promise wins the race. Handlers that respect the signal can clean up promptly; handlers that ignore it are abandoned (not awaited) and their eventual resolution is discarded.

#### Default timeout budgets

| Stage | Budget | Policy | Critical |
|---|---|---|---|
| `INTENT_DETECT` | 15 s | `degrade` | No |
| `ECO_BUILD` | 60 s | `degrade` | No |
| `SUFFICIENCY_GATE` | 10 s | **`fail`** | **Yes** |
| `TEE_BUILD` | 30 s | `degrade` | No |
| `CLASSIFY_LANE` | 5 s | `degrade` | No |

`SUFFICIENCY_GATE` is the only critical stage. A gate verdict cannot be safely approximated by a fallback — the pipeline must halt and report the failure. All other stages fall back to their existing `DEGRADE` outputs (empty TEE, unknown intent, lane C, etc.).

#### Per-stage timeout policies

| Policy | Outcome on timeout |
|---|---|
| `fail` | `StageExecutionResult.status = 'failed'` → pipeline BLOCK |
| `degrade` | `StageExecutionResult.status = 'timed_out'` → pipeline continues with fallback |

#### StageTimeoutEvent

Every execution — success or timeout — emits a `StageTimeoutEvent`:

```typescript
{
  stage_id:        'ECO_BUILD',
  started_at:      '2026-03-27T12:00:00.000Z',  // ISO 8601
  ended_at:        '2026-03-27T12:01:00.001Z',
  elapsed_ms:      60001,
  timeout_ms:      60000,
  timed_out:       true,
  outcome:         'timeout',        // 'success' | 'timeout' | 'failed'
  fallback_applied: true,            // true when onTimeout='degrade'
  failure_class:   'timeout',        // null | 'timeout' | 'error'
  recoverable:     true,             // false for critical stages
}
```

On success, `timed_out = false`, `failure_class = null`, `fallback_applied = false`.

#### OrchestratorResult — new fields

```typescript
const result = await runOrchestrator(input, handlers);

result.stageTimeouts      // StageTimeoutEvent[] — all timeout events emitted this run
result.degradedStages     // StageId[] — stages that timed out and were degraded
result.executionWarnings  // string[] — human-readable per-timeout warning messages
```

These arrays are always present (never `undefined`). On a happy-path run with no timeouts, all three are empty.

#### BoundTrace — timeout annotations

When a stage times out, its `BoundTrace` is annotated:

```json
{
  "stage": "ECO_BUILD",
  "status": "degraded",
  "timedOut": true,
  "timeoutMs": 60000,
  "failureClass": "timeout",
  "fallbackApplied": true
}
```

#### Caller-supplied overrides

Per-stage budgets can be overridden at call time:

```typescript
await runOrchestrator({
  specPath: null,
  query: 'fix the login timeout',
  stageTimeoutOverrides: {
    ECO_BUILD: 120_000,  // give ECO 2 minutes for this large repo
  },
}, handlers);
```

Unspecified stages use `DEFAULT_STAGE_TIMEOUTS`. Override is purely additive — no other behavior changes.

#### Module structure

```
packages/core/src/pipeline/
  timeout.ts           — StageTimeoutConfig, StageTimeoutEvent, StageExecutionResult,
                         runStageWithTimeout()

packages/core/src/config/
  stageTimeouts.ts     — DEFAULT_STAGE_TIMEOUTS, STAGE_TIMEOUT_POLICY,
                         STAGE_IS_CRITICAL, getStageTimeoutConfig()
```

---

### Knowledge Layer — Causal Clustering (Sprint 16)

A single root cause — such as a stale index affecting a required scope — can simultaneously degrade freshness, mapping quality, and graph completeness. Without deduplication, this inflates the composite confidence penalty by 3× even though only one remediation action (reindex) would fix all three signals.

Sprint 16 adds a **causal clustering layer** that sits between raw signal collection and ECO dimension severity finalization. It groups signals by shared probable root cause and marks which signal is the authoritative (primary) contributor. Derived signals remain fully visible in outputs and traces — they are not hidden — but they do not fully compound the composite confidence penalty.

#### Problem it solves

Without causal clustering:
- Stale index → freshness `escalate`, mapping `escalate`, graph `escalate`
- Three full severity weights applied to composite confidence
- User sees a severity far worse than the single remediation required

With causal clustering:
- The shared root cause is identified: `STALE_INDEX_SCOPE_MISMATCH`
- One dimension is selected as primary (freshness, by priority)
- Mapping and graph are derived — their penalty weight is halved
- Composite is softer, accurately reflecting a single reindex as the fix
- All three dimensions remain visible; suppression is explicit in the trace

#### Clustering pipeline

```
DimensionSignals
  │
  ├─ buildRawCausalSignals()     → RawCausalSignal[]
  │   (one signal per condition per dimension)
  │
  ├─ clusterCausalSignals()      → CausalClusterResult
  │   (group by fingerprint → primary + derived)
  │
  ├─ 5 independent evaluators    (unchanged)
  │
  ├─ attachCausalProvenance()    → DimensionResult.causal
  │   (annotate each dimension with cluster membership)
  │
  └─ computeComposite()          (suppression-aware weighted sum)
```

#### Fingerprint families (release)

Only deterministic, structurally observable families ship:

| Family | Trigger |
|---|---|
| `STALE_INDEX_SCOPE_MISMATCH` | Stale index intersects a required scope |
| `MISSING_SYMBOL_GRAPH_FOR_SCOPE` | Symbol graph absent for required scope |
| `MISSING_REQUIRED_EVIDENCE` | Required evidence class absent for intent |
| `UNRESOLVED_MAPPING_CHAIN` | Mapping chain cannot resolve to a primary target |
| `STRUCTURAL_GRAPH_BREAK` | Structural graph node/edge failure (not staleness) |
| `CONFLICTING_EVIDENCE_SET` | Conflicting evidence across sources for same claim |

Fingerprint = `<family>::<sorted_scope_refs>`. Same fingerprint → same cluster.

#### Primary signal selection

When a cluster has multiple signals, the primary is selected by:
1. **Dimension priority**: freshness > graph_completeness > mapping > coverage > conflict
2. **Severity**: highest severity_candidate wins (block > escalate > warn > pass)
3. **Tiebreak**: lexicographic sort of signal_id (deterministic)

#### Suppression behavior

| Signal status | Composite weight | Visible in trace? | Drives dimension status? |
|---|---|---|---|
| `primary` | Full (1.0×) | Yes | Yes |
| `suppressed_by_cluster` | Half (0.5×) | Yes | Yes (unsuppressed) |
| `independent` | Full (1.0×) | Yes | Yes |

Derived dimensions still surface their true computed status in `DimensionResult.status`. Only the composite weight and `effective_severity` field are softened. Independent failures across different root causes are never merged — no over-suppression.

#### DimensionResult — causal provenance fields (Sprint 16)

Each dimension result now carries an optional `causal` block:

```typescript
dim.causal = {
  raw_signal_ids:             ['freshness::stale::src/auth/login.ts'],
  cluster_ids:                ['cluster_1'],
  primary_causes:             ['STALE_INDEX_SCOPE_MISMATCH'],   // if primary
  derived_causes:             [],                               // if derived
  suppressed_signals:         [],
  effective_severity:         'warn',    // softened for derived-only dims
  unsuppressed_severity_basis: 'escalate', // true computed severity
}
```

The `causal` block is undefined for dimensions that emitted no signals (fully passing, no conditions met).

#### ScoreDimensionsOutput — new field

```typescript
result.causal_cluster_result  // CausalClusterResult — always present (v3.0.0+)
result.causal_cluster_result.clusters
result.causal_cluster_result.suppression_index
result.causal_cluster_result.cluster_summary
result.causal_cluster_result.all_signals
```

#### Trace audit — causal_clustering section

Every `DimensionScoringTrace` now includes a `causal_clustering` section:

```
trace.causal_clustering.raw_signals          — all signals emitted before clustering
trace.causal_clustering.clusters             — all clusters formed
trace.causal_clustering.suppression_decisions — per-signal suppression records
trace.causal_clustering.primary_vs_derived_map — signal_id → 'primary'|'derived'|'independent'
trace.causal_clustering.effective_dimension_inputs — per-dimension suppression summary
```

This makes the system fully auditable: users can inspect exactly what was clustered, why, and what was suppressed.

#### What is intentionally NOT in the release

- Probabilistic clustering
- LLM-based cause inference
- Semantic similarity matching
- User-tunable suppression weights
- Cross-run historical clustering

These are future enhancements. The release version stays deterministic and narrow.

#### Policy boundary preserved

Causal clustering is a **signal hygiene layer**, not a new policy layer. It influences how dimension severity contributes to the composite, but the existing precedence model is unchanged:

```
hard constraints (P1) > dimension severity (P2) > warning accumulation (P3) > composite intent (P4)
```

BLOCK on any dimension still caps composite at 40. ESCALATE still caps at 70.

#### Module structure

```
packages/core/src/knowledge/causal-clustering/
  types.ts        — RawCausalSignal, CausalCluster, CausalClusterResult, SuppressionRecord
  fingerprints.ts — buildFingerprint(), assignFingerprints()
  rules.ts        — suppression policy table, DIMENSION_PRIORITY_ORDER, selectPrimarySignalId()
  cluster.ts      — clusterCausalSignals(), buildRawCausalSignals()
  index.ts        — public API

packages/core/src/knowledge/dimensions/
  scoreDimensions.ts  — now runs causal clustering before composite computation (v3.0.0)
  types.ts            — DimensionResult.causal, ScoreDimensionsOutput.causal_cluster_result

packages/core/src/knowledge/ledger/
  traceDimensionScoring.ts — now includes causal_clustering audit section
```

---

### Stage Machine (Determinism + Enforcement)

Nirnex enforces a deterministic **planning pipeline** for every request. The pipeline is not advisory — it validates I/O at every stage boundary and applies typed failure semantics when a stage goes wrong.

#### Why this matters

Adding types alone changes nothing operationally. The stage machine solves a _determinism and enforcement_ problem: the same inputs must always produce the same outputs, and a failure in one stage must produce a predictable, traceable outcome — not silent degradation.

#### Canonical Stages

```
INTENT_DETECT → ECO_BUILD → SUFFICIENCY_GATE → TEE_BUILD → CLASSIFY_LANE
```

The `STAGES` const is frozen and immutable at runtime. No code can reorder or skip stages.

| Stage | Responsibility | Failure mode |
|---|---|---|
| `INTENT_DETECT` | Classify the request intent from spec/query | `DEGRADE` — falls back to `unknown` intent |
| `ECO_BUILD` | Build the Execution Context Object (ECO) | `ESCALATE` — continues with fallback ECO at confidence 0 |
| `SUFFICIENCY_GATE` | Decide pass/block/ask based on ECO quality | `BLOCK` — halts pipeline immediately |
| `TEE_BUILD` | Produce the Task Execution Envelope (TEE) | `DEGRADE` — falls back to empty TEE with warning |
| `CLASSIFY_LANE` | Assign the final execution lane | `ESCALATE` — continues with fallback lane C |

#### Failure Modes

| Mode | Behaviour |
|---|---|
| `BLOCK` | Pipeline halts. No further stages run. `OrchestratorResult.blocked = true`. |
| `ESCALATE` | Pipeline continues. Stage output is replaced with a safe fallback. `OrchestratorResult.escalated = true`. |
| `DEGRADE` | Pipeline continues. Stage output is replaced with a minimal fallback. `OrchestratorResult.degraded = true`. |

#### I/O Validation

Each stage has a typed input validator and a typed output validator. The `StageExecutor` enforces this contract:

```
validate input → call handler (if valid) → validate output → bind trace
```

If input validation fails, the handler is **never called**. If output validation fails, the stage's failure policy is applied. Validators are pure structural functions — no Zod, no external schema dependencies.

#### Trace Binding

Every stage execution — success or failure — produces a `BoundTrace` record:

```json
{
  "stage": "ECO_BUILD",
  "status": "ok",
  "inputHash": "a3f2c1d8",
  "timestamp": "2026-03-26T10:00:01.234Z",
  "durationMs": 42,
  "input": { "intent": { "primary": "bug_fix" } },
  "output": { "confidence_score": 85, "eco_dimensions": { ... } }
}
```

`inputHash` is a deterministic djb2 hash of the stable-stringified input. Same input always produces the same hash — this enables offline replay and diff detection.

#### Lane Classifier (P1 → P4)

The `classifyLane` function is a pure deterministic function that resolves the operational lane using a four-tier precedence chain:

| Tier | Signal | Effect |
|---|---|---|
| **P1** | `forced_unknown=true` | → Lane E (always) |
| **P1** | `critical_path_hit=true` | → minimum Lane C |
| **P1** | `forced_lane_minimum` | → enforces minimum lane from ECO |
| **P2** | ECO dimension severity (`escalate`) | → minimum Lane B |
| **P2** | ECO dimension severity (`block`) | → minimum Lane C |
| **P3** | ≥3 `boundary_warnings` | → minimum Lane B |
| **P4** | `composite=true` intent | → minimum Lane B |

P1 always overrides P2-P4. Within the same tier, the most restrictive lane wins.

```typescript
import { classifyLane } from '@nirnex/core/lane';

const decision = classifyLane(eco);
// { lane: 'C', set_by: 'P1', reason: 'critical_path_hit=true forces minimum lane C' }
```

#### Strategy Selector

`selectStrategy` maps intent to a planning strategy, enforcing never-permitted combinations:

| Intent | Default strategy | Never permitted |
|---|---|---|
| `bug_fix` | `surgical` | — |
| `new_feature` | `additive` | — |
| `refactor` | `structural` | `surgical` |
| `dep_update` | `additive` | `structural`, `full_replacement` |
| `config_infra` | `surgical` | `full_replacement` |

```typescript
import { selectStrategy } from '@nirnex/core/strategy';

selectStrategy('refactor');
// { strategy: 'structural', source: 'default' }

selectStrategy('refactor', 'surgical');
// { strategy: 'structural', source: 'default', rejectedOverride: 'surgical',
//   rejectionReason: "Strategy 'surgical' is never permitted for intent 'refactor'" }
```

#### Design constraints

- `STAGES` const is frozen — runtime mutation throws immediately
- `FAILURE_POLICY` is frozen — stages cannot change their failure mode at runtime
- `classifyLane` and `selectStrategy` are pure functions — no side effects, deterministic
- Handler injection in `runOrchestrator` enables unit testing without touching ECO/DB
- Stage validators have no external dependencies — structural shape checks only

---

## Troubleshooting

**Index empty**

```sh
nirnex index --rebuild
```

---

**Schema out of date**

If you see `Index schema is out of date` after upgrading Nirnex:

```sh
nirnex index --rebuild
```

This rebuilds the index from scratch using the current schema. Your source files are never modified.

---

**Too many files excluded**

Run the scope summary (`nirnex index`) and check "Top exclusion sources". Then use `--explain-scope` to inspect specific files:

```sh
nirnex index --explain-scope src/my-file.ts
```

To override exclusions for the current run:

```sh
nirnex index --include "src/legacy/**"
```

To persist overrides, add the pattern to `.nirnexinclude` at the repo root.

---

**Too many files included (index is slow)**

Add patterns to `.nirnexignore` at the repo root, or use `--ignore` for a one-off run:

```sh
nirnex index --ignore "src/experimental/**,packages/internal/**"
```

---

**Freshness penalties**

Fix by running:

```sh
nirnex index
```

Or enable the git hook during setup.

---

**Freshness escalation — stale scopes in required path**

When `nirnex plan` warns about stale scopes, it means that files changed since the last index are also required by the current request. Fix:

```sh
nirnex index        # incremental — re-indexes only changed files
```

Or for a full rebuild:

```sh
nirnex index --rebuild
```

To understand which files triggered the freshness escalation, check the ECO freshness field:

```sh
cat .ai-index/last-eco.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['freshness'], indent=2))"
```

---

**Pipeline blocked**

Causes:
- vague task
- missing entity
- low coverage
- conflict detected that prevents safe bounded execution
- freshness block: a required file was deleted or renamed since the last index run

Fix:
- narrow scope
- use a spec file
- run `nirnex index` to refresh stale scopes
- resolve the conflict shown in the gate decision output
- run `nirnex query` to inspect which evidence sources are in conflict

---

### Parser Diagnostics

When `nirnex index` cannot parse one or more files it writes a structured debug
record to `.ai-index/nirnex-debug.log` (JSONL — one entry per failed file).

**What triggers a debug record**

Any parse failure: file read error, unsupported extension, grammar binding
problem, tree-sitter parse error, or AST traversal bug.

**What is recorded**

Each record is a single JSON line containing:

| Field group | Fields |
|---|---|
| **Environment** | `node_version`, `platform`, `nirnex_cli_version`, `nirnex_parser_version`, `tree_sitter_version` |
| **File metadata** | `file`, `extension`, `size_bytes`, `content_sha256` (first 16 hex chars), `char_length`, `has_bom`, `has_null_bytes`, `newline_style` |
| **Parser context** | `selected_language` (`typescript` or `tsx`), `grammar_variant`, `language_set`, `input_type` |
| **Failure details** | `stage`, `error_name`, `error_message`, `stack` |
| **Guidance** | `suspected_cause`, `recommended_actions[]` |

No source code is written to the log — only metadata and a content hash.

**Parse stages**

Nirnex tracks which stage failed, making "Invalid argument" errors actionable:

| Stage | What it covers |
|---|---|
| `read_file` | Reading raw bytes from disk |
| `decode_file` | Decoding bytes to UTF-8 string, scanning for BOM / null bytes |
| `select_language` | Choosing `typescript` vs `tsx` grammar from file extension |
| `set_language` | Calling `parser.setLanguage()` on the tree-sitter instance |
| `parse` | Running `parser.parse(content)` — where most failures land |
| `postprocess_ast` | Nirnex's traversal of the parsed syntax tree |

**Suspected causes**

Nirnex classifies each failure heuristically — the cause is labelled
`suspected_cause`, not `root_cause`, because it is derived evidence not proof:

| suspected_cause | What it means | Who is likely responsible |
|---|---|---|
| `grammar_binding_problem` | `setLanguage` threw — ABI / native module mismatch | Environment |
| `wrong_grammar_selected` | `.tsx` file routed to TypeScript grammar | Nirnex bug |
| `invalid_file_encoding` | File contains null bytes or is not valid UTF-8 | Source file |
| `invalid_parse_input_type` | Non-string passed to `parser.parse()` | Nirnex bug |
| `file_access_or_encoding_error` | File unreadable or wrong encoding | Environment / file |
| `unsupported_syntax_or_parser_binding_issue` | `parse` threw for `.tsx` or `.ts` | Grammar version or syntax |
| `nirnex_ast_traversal_bug` | Parse succeeded, traversal threw | Nirnex bug |
| `unknown` | None of the above matched | Check stack trace |

**Reading the log**

```sh
# View all failures
cat .ai-index/nirnex-debug.log

# Pretty-print the most recent failure
tail -1 .ai-index/nirnex-debug.log | python3 -m json.tool

# List all suspected causes across failures
cat .ai-index/nirnex-debug.log | python3 -c \
  "import sys,json; [print(json.loads(l)['suspected_cause']) for l in sys.stdin]"

# Count failures per extension
cat .ai-index/nirnex-debug.log | python3 -c \
  "import sys,json; [print(json.loads(l)['extension']) for l in sys.stdin]"
```

**Example log entry**

```json
{
  "timestamp": "2026-03-25T09:12:31.221Z",
  "level": "error",
  "event": "parser_failure",
  "command": "index --rebuild",
  "node_version": "v22.12.0",
  "platform": "darwin-arm64",
  "nirnex_cli_version": "4.1.3",
  "nirnex_parser_version": "4.1.3",
  "tree_sitter_version": "0.21.1",
  "grammar_package": "tree-sitter-typescript",
  "grammar_variant": "tsx",
  "file": "/Users/you/project/app/page.tsx",
  "extension": ".tsx",
  "size_bytes": 41994,
  "content_sha256": "abc123def456ab12",
  "char_length": 41870,
  "has_bom": false,
  "has_null_bytes": false,
  "newline_style": "LF",
  "selected_language": "tsx",
  "language_set": true,
  "input_type": "string",
  "stage": "parse",
  "error_name": "Error",
  "error_message": "Invalid argument",
  "stack": "Error: Invalid argument\n    at ...",
  "suspected_cause": "unsupported_syntax_or_parser_binding_issue",
  "recommended_actions": [
    "The TSX grammar (tree-sitter-typescript) could not parse this file",
    "Possible causes: very new JSX/TS syntax, very large file, or ABI mismatch in native bindings",
    "Run: npm ls tree-sitter tree-sitter-typescript — look for version mismatches",
    "Try reproducing with a minimal .tsx snippet to isolate the syntax involved",
    "If other .tsx files parse successfully, the issue is specific to this file's syntax",
    "File a bug report with this log entry if the problem persists"
  ]
}
```

**Log management**

- Log is **append-only** — each `nirnex index` run appends new records
- Log **rotates automatically** when it exceeds 10 MB (renamed to `nirnex-debug.log.<timestamp>.old`)
- Add `.ai-index/nirnex-debug.log` to `.gitignore` to avoid committing debug artifacts

**Diagnosing `tree-sitter` version mismatches**

```sh
# Check installed versions
npm ls tree-sitter tree-sitter-typescript

# If there is a mismatch, reinstall
npm install -g @nirnex/cli

# Retry indexing
nirnex index --rebuild
```

---

## Philosophy

Nirnex does not replace engineering judgment.

It makes decisions:

- explicit
- bounded
- traceable
- confidence-aware
- conflict-aware

So teams can move faster without losing control.

Nirnex will never proceed silently when evidence materially disagrees. If two sources say different things about the same subject, Nirnex surfaces that conflict, records it in the decision ledger, and gates execution accordingly — before a single line of code is written.