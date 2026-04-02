# Nirnex CLI Reference

Complete command reference for the `nirnex` CLI.

---

## Table of Contents

- [Installation & Setup](#installation--setup)
- [Commands](#commands)
  - [setup](#nirnex-setup)
  - [remove](#nirnex-remove)
  - [index](#nirnex-index)
  - [plan](#nirnex-plan)
  - [query](#nirnex-query)
  - [status](#nirnex-status)
  - [trace](#nirnex-trace)
  - [report](#nirnex-report)
  - [replay](#nirnex-replay)
  - [hook-log](#nirnex-hook-log)
- [Configuration](#configuration)
- [Directory Structure](#directory-structure)
- [Environment Variables](#environment-variables)
- [Claude Hook Lifecycle](#claude-hook-lifecycle)
- [Database Schema](#database-schema)

---

## Installation & Setup

Run inside a repository root:

```sh
nirnex setup
```

This creates all required files, installs Claude hooks, and optionally runs the initial index.

---

## Commands

---

### `nirnex setup`

Initialize Nirnex in the current repository.

```
nirnex setup [options]
```

**Options**

| Flag | Short | Description |
|------|-------|-------------|
| `--yes` | `-y` | Skip interactive prompts and auto-accept all defaults |

**What it does**

1. Creates the `.ai/` workspace directory tree:
   - `.ai/prompts/analyst.md` — analyst agent persona
   - `.ai/prompts/implementer.md` — implementer agent persona
   - `.ai/specs/` — directory for spec files
   - `.ai/calibration/` — project-specific guidance
2. Creates `nirnex.config.json` in the repo root
3. Creates `.ai-index/` for runtime data
4. Installs a git `post-commit` hook for automatic index refresh
5. Installs 5 Claude hook scripts under `.claude/hooks/`:
   - `nirnex-bootstrap.sh`
   - `nirnex-entry.sh`
   - `nirnex-guard.sh`
   - `nirnex-trace.sh`
   - `nirnex-validate.sh`
6. Patches `.claude/settings.json` with hook bindings
7. Optionally runs the first full index rebuild

**Example**

```sh
nirnex setup --yes
```

---

### `nirnex remove`

Safely detach Nirnex from the current repository.

```
nirnex remove [options]
```

**Options**

| Flag | Description |
|------|-------------|
| `--yes` / `-y` | Auto-confirm all removal actions without interactive prompts |
| `--force` | Force removal without any confirmation |
| `--dry-run` | Print what would be removed without making changes |
| `--keep-data` | Preserve `.aidos.db` and `.ai-index/` |
| `--keep-specs` | Preserve `.ai/specs/` (user-created specification files) |
| `--keep-claude` | Preserve Claude hooks and `.claude/` integration |
| `--purge-data` | Remove the entire `.ai/` directory, including user content |
| `--json` | Emit removal summary as JSON instead of human-readable text |

**Removal targets**

| Target | Condition |
|--------|-----------|
| `nirnex.config.json` | Always (high confidence match) |
| `.aidos.db` | Unless `--keep-data` |
| `.ai-index/` | Unless `--keep-data` |
| `.ai/prompts/analyst.md` | Unless `--keep-specs` or `--purge-data` handles it |
| `.ai/prompts/implementer.md` | Unless `--keep-specs` |
| `.ai/calibration/README.md` | Unless `--keep-specs` |
| `.ai/critical-paths.txt` | Unless `--keep-specs` |
| `.ai/specs/` | Preserved unless `--purge-data` |
| `.git/hooks/post-commit` | Only if it exactly matches the Nirnex template |
| `.claude/hooks/nirnex-*.sh` | All 5 scripts, only if exact match; unless `--keep-claude` |
| `.claude/settings.json` hook bindings | Surgical patch removal; unless `--keep-claude` |

**Examples**

```sh
nirnex remove --dry-run              # Preview what would be removed
nirnex remove --yes --keep-specs     # Remove everything except spec files
nirnex remove --purge-data --force   # Full wipe, no confirmation
nirnex remove --json                 # Machine-readable output
```

---

### `nirnex index`

Parse the codebase and write it into the knowledge graph.

```
nirnex index [options]
```

**Options**

| Flag | Description |
|------|-------------|
| `--rebuild` | Full rebuild — re-parse every TypeScript file regardless of changes |
| `--ignore <pattern>` | Exclude files matching the given glob or regex pattern |
| `--include <pattern>` | Force-include files matching the given pattern |
| `--explain-scope <path>` | Show why a specific file was included or excluded |

**Indexing pipeline**

| Stage | Description |
|-------|-------------|
| 1 | Load scope policy (file classification rules) |
| 2 | Detect repo context (monorepo detection, framework detection) |
| 3 | Discover candidate TypeScript files |
| 4 | Classify files as `FULL` or `EXCLUDED` |
| 5 | Apply incremental filter via `git diff` (skipped when `--rebuild`) |
| 6 | Parse files with the TypeScript AST parser |
| 7 | Resolve imports, compute dependency graph edges, write to `.aidos.db` |

**Output**

- Indexed file count
- Timing per stage
- Parser diagnostics (parse errors, skipped files)
- Scope summary (how many files were included vs excluded)

**Examples**

```sh
nirnex index                          # Incremental update (git diff)
nirnex index --rebuild                # Full re-parse
nirnex index --ignore "**/*.test.ts"  # Skip test files
nirnex index --explain-scope src/auth/guard.ts
```

---

### `nirnex plan`

Generate a structured delivery plan from a spec file or an inline query.

```
nirnex plan <spec_file_or_query>
```

**Arguments**

| Argument | Description |
|----------|-------------|
| `<path>` | Path to a Markdown spec file (e.g., `.ai/specs/my-feature.md`) |
| `<query>` | Inline natural-language query (multiple words joined automatically) |

**Behaviour**

- Accepts either a file path or raw text as input
- Builds an ECO (Execution Context Object) encoding the task graph, dependencies, and uncertainty flags
- Exits with code `1` if the plan is blocked or contains forced unknowns (detected when the spec file name ends with `vague-spec.md`)

**Output**

JSON representation of the plan including task graph, dependency order, and confidence indicators.

**Examples**

```sh
nirnex plan .ai/specs/add-payment.md
nirnex plan "refactor the auth middleware to use JWT"
```

---

### `nirnex query`

Query the knowledge graph with natural language or a file path.

```
nirnex query "<question>"
nirnex query --impact <file>
```

**Options**

| Flag | Description |
|------|-------------|
| `--impact <file>` | Explicitly run impact analysis on the specified file |

**Query classification**

The query is automatically classified into one or more of the following flags:

| Flag | Trigger keywords / patterns |
|------|-----------------------------|
| `STRUCTURE` | "where", "boundary", "module" |
| `IMPACT` | "affect", "depend", "break" |
| `SYMBOL` | camelCase identifiers, `.ts`/`.tsx` file paths |
| `PATTERN` | "pattern", "state", "xstate" |
| `HEALTH` | "test", "fail", "gate", "coverage" |

**Data sources**

- Graph CTE — recursive dependency chain queries
- `ast-grep` — structural code pattern matching
- Index DB — module and symbol lookup from `.aidos.db`

**Output**

- Query results with supporting evidence
- Confidence score with applied penalties
- Suggested next actions based on query type and confidence level

**Examples**

```sh
nirnex query "what depends on the auth module"
nirnex query "where is the payment boundary"
nirnex query --impact src/auth/middleware.ts
```

---

### `nirnex status`

Show the current health of the index and project configuration.

```
nirnex status
```

**No options.**

**Checks performed**

| Check | Description |
|-------|-------------|
| `nirnex.config.json` | Config file exists and is valid |
| `.ai/` workspace | Directory structure is present |
| `.ai/prompts/` | `analyst.md` and `implementer.md` exist |
| `.aidos.db` | SQLite database exists and is readable |
| Module count | Number of indexed modules |
| Edge count | Number of dependency graph edges |
| Schema version | DB schema version |
| Index freshness | Compares stored git commit hash to current `HEAD` |
| Post-commit hook | `.git/hooks/post-commit` is installed |
| Claude settings | `.claude/settings.json` contains hook bindings |
| Claude hook scripts | All 5 `.claude/hooks/nirnex-*.sh` scripts present |
| Runtime sessions | Count of stored sessions |
| Task envelopes | Total and currently active task envelopes |

**Output**

Status table with symbols:

- `✔` — healthy
- `✘` — missing or broken
- `!` — warning (e.g., stale index)

---

### `nirnex trace`

View execution traces recorded during previous analysis runs.

```
nirnex trace [options]
```

**Options**

| Flag | Description |
|------|-------------|
| `--last` | Show the most recent trace in full JSON detail |
| `--list` | List recent traces with a summary table (default when no flags given) |
| `--id <trace_id>` | Show a specific trace by its ID |
| `--limit <n>` | Number of traces to display when listing (default: `20`) |
| `--help` / `-h` | Show help |

**Trace fields**

| Field | Description |
|-------|-------------|
| `trace_id` | Unique trace identifier |
| `date` | ISO 8601 timestamp |
| `intent` | Parsed user intent for this run |
| `confidence_score` | Numeric confidence (0–1) |
| `lane` | Execution lane (e.g., `plan`, `query`) |

**Trace storage location:** `.ai-index/traces/`

**Examples**

```sh
nirnex trace                         # List recent traces
nirnex trace --last                  # Full JSON for most recent
nirnex trace --id abc123             # Specific trace
nirnex trace --list --limit 50       # Show last 50
```

---

### `nirnex report`

Generate a static HTML report from an analysis run.

```
nirnex report [options]
```

**Options**

| Flag | Description |
|------|-------------|
| `--last` | Generate a report for the most recent run |
| `--list` | List available runs (default when no arguments given) |
| `--id <trace_id>` | Generate a report for a specific run |
| `--compare <a> <b>` | Generate a comparison report between run `a` (baseline) and run `b` (current) |
| `--out <dir>` | Custom output directory (default: `.ai-index/reports`) |
| `--help` / `-h` | Show help |

**What it produces**

- `<trace_id>.html` — standalone HTML report
- `<trace_id>.json` — raw evidence bundle alongside the HTML

Both files are written to the output directory. The file paths are printed on completion for easy opening.

**Report contents**

- Evidence bundle assembled from ledger entries
- Optimisation hints
- Hook lifecycle summary
- Confidence metrics and violation counts

**Examples**

```sh
nirnex report --last
nirnex report --id abc123
nirnex report --compare baseline123 current456
nirnex report --last --out ./reports
```

---

### `nirnex replay`

Replay a past analysis run.

```
nirnex replay [options]
```

> **Status: not yet implemented.** This command is a placeholder. Running it prints a development notice and exits.

---

### `nirnex hook-log`

Inspect Claude hook lifecycle events and contract violations.

```
nirnex hook-log [options]
```

**Options**

| Flag | Description |
|------|-------------|
| `--last` | Show the full event timeline for the most recent session (default) |
| `--session <id>` | Show the timeline for a specific session |
| `--list` | List all sessions chronologically with a summary |
| `--violations` | Show only `ContractViolationDetected` events across all sessions |
| `--stage <stage>` | Filter events to a specific hook stage |
| `--help` / `-h` | Show help |

**Valid `--stage` values:** `bootstrap`, `entry`, `guard`, `trace`, `validate`

**Hook event types**

| Event | Key fields |
|-------|------------|
| `HookInvocationStarted` | `pid` |
| `InputEnvelopeCaptured` | `lane`, `mandatory_verification`, `source` |
| `ContractViolationDetected` | `severity` (`blocking`/`advisory`), `reason_code` |
| `StageCompleted` | `blocker_count`, `violation_count` |
| `FinalOutcomeDeclared` | `decision` (`allow`/`block`), `blocking_violation_count`, `advisory_violation_count`, `verification_status` |

**Session summary fields**

| Field | Description |
|-------|-------------|
| `session_id` | Unique session identifier |
| `first_event_ts` | ISO 8601 timestamp of first event |
| `task_count` | Distinct tasks in this session |
| `event_count` | Total events recorded |
| `outcome` | `ALLOW`, `BLOCK`, or `INCOMPLETE` |
| `verification_status` | Final verification state |
| `blocking_violations` | Count of blocking violations |
| `advisory_violations` | Count of advisory violations |
| `reason_codes` | List of violation reason codes |

**Event storage location:** `.ai-index/runtime/events/<session_id>/hook-events.jsonl`

**Timeline output columns:** `TIME`, `STAGE`, `EVENT_TYPE`, `STATUS`, `REASON_CODE`, `SUMMARY`

**Examples**

```sh
nirnex hook-log                          # Timeline for most recent session
nirnex hook-log --list                   # All sessions with summaries
nirnex hook-log --violations             # All contract violations
nirnex hook-log --session abc123         # Specific session
nirnex hook-log --stage guard            # Only guard-stage events
```

---

## Configuration

**File:** `nirnex.config.json` in the repository root.

```jsonc
{
  "projectName": "my-project",       // Display name for reports and logs
  "sourceRoots": ["src"],            // Directories scanned during indexing
  "specDirectory": ".ai/specs",      // Where nirnex plan looks for spec files
  "criticalPathsFile": ".ai/critical-paths.txt",

  "prompts": {
    "analyst": ".ai/prompts/analyst.md",
    "implementer": ".ai/prompts/implementer.md"
  },

  "index": {
    "path": ".ai-index",             // Runtime data directory
    "db": ".aidos.db",               // SQLite knowledge graph
    "autoRefresh": true              // Re-index on git post-commit
  },

  "git": {
    "installPostCommitHook": true    // Install .git/hooks/post-commit
  },

  "llm": {
    "provider": "anthropic"          // LLM provider used for summaries
  },

  "hooks": {
    "enabled": true,                 // Activate Claude hook integration
    "policyMode": "standard"         // Hook enforcement policy
  }
}
```

---

## Directory Structure

```
<repo-root>/
├── nirnex.config.json          # Project configuration
├── .aidos.db                   # SQLite knowledge graph
│
├── .ai/                        # AI workspace
│   ├── prompts/
│   │   ├── analyst.md          # Analyst agent persona
│   │   └── implementer.md      # Implementer agent persona
│   ├── specs/                  # Spec files for `nirnex plan`
│   ├── calibration/
│   │   └── README.md           # Project-specific guidance
│   └── critical-paths.txt      # Architecturally critical file list
│
├── .ai-index/                  # Runtime data
│   ├── runtime/
│   │   ├── sessions/           # Session metadata
│   │   └── events/             # Hook event JSONL logs
│   ├── traces/                 # Execution traces
│   └── reports/                # Generated HTML/JSON reports
│
├── .claude/                    # Claude Code integration
│   ├── hooks/
│   │   ├── nirnex-bootstrap.sh
│   │   ├── nirnex-entry.sh
│   │   ├── nirnex-guard.sh
│   │   ├── nirnex-trace.sh
│   │   └── nirnex-validate.sh
│   └── settings.json           # Hook trigger bindings
│
└── .git/hooks/
    └── post-commit             # Auto-index refresh on commit
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NIRNEX_REPO_ROOT` | Override the repository root (defaults to `cwd`) |
| `NIRNEX_SESSION_ID` | Override the session ID used for hook event logging |
| `CLAUDE_ENV_FILE` | Path to Claude environment data used by the bootstrap hook |

---

## Claude Hook Lifecycle

Hooks are registered in `.claude/settings.json` and fire automatically during a Claude Code session.

| Trigger | Script | Timeout | Purpose |
|---------|--------|---------|---------|
| `SessionStart` | `nirnex-bootstrap.sh` | 30s | Load session context, capture environment |
| `UserPromptSubmit` | `nirnex-entry.sh` | 30s | Parse intent, create task envelope |
| `PreToolUse` (Bash, Edit, Write, MultiEdit) | `nirnex-guard.sh` | 10s | Enforce contract, block disallowed tool use |
| `PostToolUse` | `nirnex-trace.sh` | 10s | Record tool execution trace |
| `Stop` | `nirnex-validate.sh` | 10s | Validate outcome, write final ledger entry |

Use `nirnex hook-log` to inspect the events produced by this lifecycle.

---

## Database Schema

**File:** `.aidos.db` (SQLite)

| Table | Description |
|-------|-------------|
| `modules` | Parsed TypeScript modules with LOC, content hash, and summary |
| `edges` | Directed dependency graph edges with weights |
| `patterns` | Detected code smells and structural patterns |
| `summaries` | LLM-generated module summaries (≤120 tokens) |
| `gate_results` | Quality gate check results per module |
| `_meta` | Metadata: schema version, last indexed git commit hash |
| `ledger_entries` | Hook event ledger entries used by `nirnex report` |
