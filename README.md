# Nirnex

Decision Intelligence for Software Delivery

Nirnex is a decision intelligence system for software delivery.
It analyzes your codebase, understands constraints, and determines what should be built, how it should be built, and how confident the system is in that decision.

## Overview

Nirnex transforms software execution from intuition-driven to evidence-backed decision making.

Instead of relying on raw text search or loosely guided AI suggestions, Nirnex operates on a structured understanding of your codebase, including dependencies, symbols, and execution patterns.

At its core, Nirnex builds Execution Context Objects (ECOs) — precise, bounded representations of a task — enabling safe, multi-agent changes with clear reasoning and measurable confidence.

Nirnex is not a code generator. It is a decision system that governs how software changes are planned and executed.


## Prerequisites
Before you start, ensure you have the following installed on your system:
- **Node.js**: >= 20
- **tree-sitter CLI**: Required for generating structural syntax trees securely.
- **ast-grep CLI**: (Optional, but highly recommended) Enhances deep pattern matching routines.
- **git**: Required for tracking code index freshness and implementing post-commit hooks.

## First-time Setup
To get Nirnex running, follow these initial onboarding steps carefully:

1. **Clone the repository:**
   ```sh
   git clone <repository_url>
   cd ai-delivery-os
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Build the internal packages:**
   ```sh
   npm run build --workspaces
   ```
   *Note: If establishing an alias, you can use the built `dev` command anywhere later.*
4. **Initialize the local structure database:**
   ```sh
   npm run dev -- index --rebuild
   ```
   **CRITICAL**: Without completing this step to initialize the `.ai-index` database, any further commands will fail with an "index empty" error! This is the most common first-time setup failure.
5. **Verify the installation:**
   ```sh
   npm run dev -- status
   ```

### .ai/ Directory Configuration
To support ECO construction and execution context generation, ensure that you seed the `.ai/` directory within your codebase containing:

- `.ai/critical-paths.txt`: A newline-delimited list mapping files designated as architecturally critical (e.g., `src/state/paymentMachine.ts`). Hitting a critical path mandates `Lane C` dual-mode retrieval escalation.
- `.ai/analyst.md`: The system prompt explicitly defining guidelines around analyzing complex scopes.
- `.ai/implementer.md`: The system prompt mapping out correct implementation and verification formats.
- `.ai/calibration/`: Directory storing ground truth sampling data utilized during evaluation routines.

### Installing the Post-commit Hook
To ensure your graph database stays fresh automatically as you work, we recommend configuring a git post-commit hook.

Create `.git/hooks/post-commit` (and `chmod +x` it) with the following content:
```sh
#!/usr/bin/env bash
# Runs an incremental rebuild automatically on mapped diffs
npm run dev -- index
```
Failing to install this hook means your repository index will decay rapidly, constantly triggering `-20 Index Stale` penalties on future queries.

### Environment Requirements
**Important**: The `dev plan` command synthesizes operations by communicating with LLM layers. Ensure that you have the required Anthropic API key correctly exported in your environment before generating any delivery plans:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."
```
---

## Commands

Nirnex is driven through **seven** primary operations under the `dev` namespace:

### `dev index`
Builds and reconstructs the SQLite knowledge graph from source.

**Usage:**
```sh
dev index --rebuild    # Full reconstruction parsing all target sources
dev index              # Incremental rebuild across currently modified files
```

### `dev query`
Interrogates the underlying knowledge graph structure using keyword heuristic rules while reporting real-time constraint penalties and tier degradation limits.

**Usage:**
```sh
dev query "What depends on paymentMachine?"
```
**Example Output:**
```text
Result Count: 14
Sources Used: index, graph_cte
Flags Fired: NEEDS_IMPACT, NEEDS_SYMBOL
Confidence Score: 75
Degradation Tier: 2

Penalties:
 -25: LSP is unavailable
```
*Tip: The penalty breakdown reveals why confidence isn't perfect, showing that the system lacks LSP features but successfully queried internal stores.*

### `dev plan`
Synthesizes fully compliant metadata constraints (ECO) to power verifiable LLM-driven development tasks.

**Usage:**
```sh
dev plan docs/specs/add-retry.md    # Target an explicit specification file
dev plan "Fix button padding"       # Inline rapid planning (resolves as 'quick_fix')
```

**Spec File Templates**:
Spec documents explicitly target the intent mappings natively. To map intended delivery correctly, utilize triggers:
- **New Feature**: Provide an `## In Scope`, `## Out of Scope`, and `## Acceptance Criteria` section block. By hitting these keywords, Nirnex assigns a `new_feature` intent confidently.
- **Bug Fix**: Provide `## Reproduction Steps` along with `## Expected vs Actual` output.
- **Refactor**: Provide `## Current Structure` and `## Target Structure` blocks.
- **Dependency Update**: Provide an `## Old Dependency` and `## New Dependency` block.
- **Config & Infra**: Emphasize `## env var` or `## config` definitions directly.

**Composite Intents**:
If a spec lists triggers traversing across constraints (e.g. `## Reproduction Steps` + `## Target Structure`), the system calculates a **composite intent** combining both domains (`bug_fix` + `refactor`).
- Limits max intents to **2** per file; providing 3+ causes the trace to abort execution asserting "please split this spec."
- Triggers `union` retrieval strategies expanding extraction nets.
- **Escalates execution safety** automatically (+1 lane restriction inherited from the secondary target constraints).

**Example ECO JSON Output:**
```json
{
  "query": "",
  "intent": { "primary": "bug_fix", "composite": false },
  "forced_lane_minimum": "C",
  "confidence_score": 75,
  "eco_dimensions": {
    "coverage": { "severity": "pass" },
    "graph": { "severity": "warn", "detail": "1 hub node capped" }
  }
}
```

**Post-Plan Workflow**:
Generating the plan is just the orchestrator mapping the bounds; the execution sequence continues recursively:
1. The **ECO** output synthesizes into Targeted Execution Environments (**TEEs**).
2. Each TEE securely scopes an architectural implementation slice bounded by `dev plan` dimensions.
3. The **implementer agent** operates directly spanning those TEE boundaries securely decoupled.
4. Final changes push back out into a generalized **staging file** allowing local developers to peer review structural patches sequentially.

### `dev status`
Reports repository-wide indexing health.

**Usage:**
```sh
dev status
```

**Example Output:**
```text
Index Status: healthy
Schema Version: 1
Modules Tracked: 45
Dependencies Mapped: 132
Edges Traversed: 1489
Hub Nodes Detected: 2
Freshness: synchronized (No staleness)
```

### `dev trace`
Queries and visualizes specific execution decisions mapped continuously on each `dev query` and `dev plan` execution to `.ai-index/traces`. 
*Traces are automatically rotated: archived after 30 days, deleted after 90.*

**Usage:**
```sh
dev trace --last          # Retrieves staging decisions for previous command
dev trace --id {tr_xxx}   # Targets detailed views of a specific trace execution
dev trace --list          # Summarizes active traces available within the root
```

### `dev override`
A standalone execution mechanism designed to bypass strict pipeline blocking capabilities when explicitly required.

**Usage:**
```sh
dev override --reason "Bypassing freshness penalty for hotfix" plan docs/specs/file.md
```
*Note: Overrides bypass forced constraints generated by ANY ECO-producing operation (it is not a flag on `dev plan`). Whenever an override is invoked, the command, target execution, and explicit `--reason` are permanently logged directly to the trace using the developer's identity to generate an audit trail.*

### `dev replay`
Allows recalibration operations to re-evaluate structural queries against updated penalty matrices or graph heuristic changes in a sandbox context.

**Usage:**
```sh
dev replay --trace {tr_xxx}           # Side-by-side replay evaluation
dev replay --all --since 7d           # Batch evaluation highlighting degradation loops
```
**Why use this?** After tuning your penalty heuristics or injecting new query keywords, you can verify how previously recorded delivery traces react to prevent regression. Running `dev replay --all --since 30d` enables a monthly calibration checkout confirming your rule impacts directly.

---

## Core Abstractions

### 5-Dimensional Constraints
Employs heuristic-based dimension scoring covering:
- **Coverage**: How much of the targeted scope is readily observable versus hidden behind configs or external boundaries.
- **Freshness**: Evaluates indexing latency against git `HEAD` scoping to avoid stale contexts.
- **Mapping Quality**: Defines entity matches against explicit paths determining confidence limits:
  - `1:1`: Direct, perfect mapping.
  - `1:chain`: Resolves effectively within deep isolated dependency paths.
  - `1:cluster`: **Escalates** severity; multiple scattered paths resolve through distant parent dependencies.
  - `1:scattered`: Disjointed elements.
  - `1:0`: **Blocks** severity completely; the explicit node does not exist on disk.
- **Conflicts**: Isolates conflicting knowledge signals forcing stricter constraints.
- **Graph Traversal**: Traces upstream/downstream depths restricting blast radius automatically.

### Score Interpretation Guide
The `confidence_score` reflects graph safety explicitly restricting LLM workflow orchestration dynamically.
- `80 - 100` **High**: Safely automatable; zero substantial limits traversed.
- `60 - 79`  **Medium**: Generally valid; demands localized / narrow query bounds scaling down traversal vectors.
- `40 - 59`  **Low**: Requires direct human verification verifying exact resolution roots prior to code writes.
- `20 - 39`  **Unreliable**: Context severely decayed; triggers full trace stoppers.
- `0 - 19`   **Insufficient**: Evidence completely lacks signal. Demands active manual intervention.

### Execution Lanes
From low-risk trivial fixes to severe architectural refactors requiring dual-retrieval verification, Nirnex isolates delivery workflows securely:
- **Lane A**: Basic, minor additions isolated nicely on disk. Just commit and push directly; CI pipelines will handle validation gracefully.
- **Lane B**: Requires a formalized spec output alongside planning approvals prior to implementation constraints being executed.
- **Lane C**: Re-architecture paths, crossing module hubs or hitting `critical-paths.txt`. Requires explicit full dual-mode graph checking, rigorous execution planning, and explicit specialist/team review before touching code.

---

## Troubleshooting

- **`"index empty"` error**: You skipped running `dev index --rebuild` securely initializing your SQLite database graphs. Run it!
- **`"Freshness penalty"` keeps firing**: You haven't installed the `post-commit` script hook triggering the incremental compilation of git diffs.
- **`Pipeline blocked` / `forced_unknown: true` logs**: A critical dimension (e.g., `1:0` Entity mapping match, vague target intent, or a `<40% coverage`) has actively stopped the runner. Redesign your LLM Spec to isolate the execution scope gracefully. *Note: Pipeline blockers can theoretically be bypassed actively passing `dev override --reason "..."` flags bypassing internal checks securely tracked in audit history.*
