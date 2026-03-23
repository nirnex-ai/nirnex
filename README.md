<div align="center">
<img src="https://nirnex-ai.github.io/nirnex/img/nirnex-logo-navbar.svg?v=2" width="200" height="200"/>

# Nirnex
#### Decision Intelligence for Software Delivery

[![CI](https://github.com/nirnex-ai/nirnex/actions/workflows/ci.yml/badge.svg)](https://github.com/nirnex-ai/nirnex/actions/workflows/ci.yml)
[![Release](https://github.com/nirnex-ai/nirnex/actions/workflows/release.yml/badge.svg)](https://github.com/nirnex-ai/nirnex/actions/workflows/release.yml)

</div>

---

Nirnex helps engineering teams plan software changes using codebase structure, constraints, and confidence scoring.

It analyzes your repository, determines what should be built, how it should be built, and how safe that decision is — before code is written.

> Nirnex is not a code generator. It is a decision system that governs how software changes are planned and executed.

[![Watch the video](https://img.shields.io/badge/▶_Watch_Demo-Nirnex_Architecture-blue?style=for-the-badge&logo=youtube&logoColor=white)](https://nirnex-ai.github.io/nirnex/Nirnex__The_Architecture_of_Controlled_Execution.mp4)


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
npm install -g nirnex
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

## What `nirnex setup` Creates

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

## Core Commands

### `nirnex setup`

Initialize Nirnex in a repository.

```sh
nirnex setup
```



### `nirnex status`

Check repository health.

```sh
nirnex status
```



### `nirnex index`

Build or refresh the structural index.

```sh
nirnex index
nirnex index --rebuild
```



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
- **Lane B** → structured work with spec
- **Lane C** → architectural or high-risk changes

---

### Constraint Dimensions

Nirnex evaluates:

- Coverage
- Freshness
- Mapping Quality
- Conflicts
- Graph Traversal

These directly influence confidence and lane selection.

---

## Troubleshooting

**Index empty**

```sh
nirnex index --rebuild
```

---

**Freshness penalties**

Fix by running:

```sh
nirnex index
```

Or enable the git hook during setup.

---

**Pipeline blocked**

Causes:
- vague task
- missing entity
- low coverage

Fix:
- narrow scope
- use spec file

---

## Philosophy

Nirnex does not replace engineering judgment.

It makes decisions:

- explicit
- bounded
- traceable
- confidence-aware

So teams can move faster without losing control.