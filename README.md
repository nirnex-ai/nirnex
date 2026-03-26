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

**v5.2.0** — See [releases](https://github.com/nirnex-ai/nirnex/releases) for the full changelog.

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

Nirnex evaluates five dimensions per request:

| Dimension | What it measures |
|---|---|
| Coverage | How completely the dependency graph covers the requested scope |
| Freshness | How current the index is relative to HEAD |
| Mapping Quality | How precisely the request maps to a bounded implementation target |
| **Conflict** | Whether evidence sources make incompatible claims about the same subject |
| Graph Traversal | Depth and completeness of graph-based retrieval |

These directly influence confidence and lane selection. Both Conflict and Freshness scoring are **independent** — they cannot be masked by high coverage or clean mapping.

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