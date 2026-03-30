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
| `.ai-index/` | Local structural graph, traces, reports, and runtime session data |
| `.ai-index/runtime/events/{session}/hook-events.jsonl` | Append-only hook lifecycle event stream (audit trail) |
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

---

### `nirnex report`

Generate a static HTML report and JSON evidence bundle from a run. Reports are written to `.ai-index/reports/`.

```sh
# Report for the most recent run
nirnex report --last

# Report for a specific run by trace ID
nirnex report --id tr_abc123

# Comparison report — tr_new relative to tr_old as baseline
nirnex report --compare tr_old tr_new

# List all runs available for reporting
nirnex report --list

# Write to a custom directory
nirnex report --last --out /tmp/reports
```

Each report produces two files:

| File | Purpose |
|---|---|
| `<trace_id>.html` | Self-contained static HTML report (open in any browser) |
| `<trace_id>.json` | Canonical JSON evidence bundle (JSON-first source of truth) |

The comparison report is named `<current_id>-vs-<baseline_id>.html`.

**Output example:**

```
  ✔ Report generated for tr_abc123

  · HTML  .ai-index/reports/tr_abc123.html
  · JSON  .ai-index/reports/tr_abc123.json

  Open: file:///path/to/project/.ai-index/reports/tr_abc123.html
```

**`nirnex report --list` output:**

```
Nirnex Runs

  Trace ID                           Timestamp                  Records
  ────────────────────────────────────────────────────────────────────
  tr_abc123...                       2026-03-29T10:00:00Z       12
  tr_def456...                       2026-03-28T14:30:00Z       9

  Run nirnex report --last or nirnex report --id <trace_id> to generate a report.
```



### `nirnex override`

Bypass restrictions with audit logging.

```sh
nirnex override --reason "Hotfix" plan .ai/specs/file.md
```



### `nirnex report`

Generate a static HTML report from a run. See the [Report System](#report-system-sprint-25) section for full details.

```sh
nirnex report --last
nirnex report --id tr_xxx
nirnex report --compare tr_old tr_new
nirnex report --list
```

---

### `nirnex hook-log`

Inspect the hook lifecycle event stream to diagnose what happened during any run — whether a hook was invoked, what obligations were extracted, what violations were detected, and why the final outcome was allow or block.

```sh
# Show the full event timeline for the most recent session
nirnex hook-log --last

# Show timeline for a specific session
nirnex hook-log --session sess_abc123

# Show only ContractViolationDetected events across all sessions
nirnex hook-log --violations

# Filter timeline to a specific stage
nirnex hook-log --last --stage validate
```

**Output columns:** `TIME | STAGE | EVENT_TYPE | STATUS | REASON_CODE | SUMMARY`

**Example output:**

```
Session: sess_1q2w3e4r  (7 events)
TIME      STAGE       EVENT_TYPE                    STATUS      REASON_CODE                           SUMMARY
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
10:14:22  entry       HookInvocationStarted                                                           pid=82341
10:14:22  entry       InputEnvelopeCaptured                                                           lane=B mandatory_verification=true source=explicit_user_instruction
10:14:22  entry       StageCompleted                pass                                              blockers=0 violations=0
10:14:45  validate    HookInvocationStarted                                                           pid=82398
10:14:45  validate    ContractViolationDetected     [blocking]  VERIFICATION_REQUIRED_NOT_RUN         Verification was declared mandatory but no verification command was executed
10:14:45  validate    FinalOutcomeDeclared          block                                             blocking=1 advisory=0 verify=skipped
10:14:45  validate    StageCompleted                fail        blockers=1 violations=1

⚠ 1 violation(s): 1 blocking, 0 advisory
Final outcome: BLOCK
```

Events are written to `.ai-index/runtime/events/{sessionId}/hook-events.jsonl` as an append-only stream separate from the tool-execution trace.

---

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

