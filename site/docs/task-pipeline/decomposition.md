---
id: decomposition
title: Task Decomposition
sidebar_label: Decomposition
sidebar_position: 3
description: How a spec is decomposed into ordered Task Execution Envelopes (TEEs) with declared scopes and validation gates.
---

<span class="u-eyebrow">Task Pipeline · Layer 02</span>

# Task Decomposition

Decomposition splits the spec into an **ordered list of Task Execution Envelopes**. Each TEE is a bounded unit of work with a declared scope, acceptance criteria, and assigned gate.

---

## Task Execution Envelope Structure

```ts
interface TEE {
  id: string
  task_id: string
  order: number
  strategy: Strategy
  scope: {
    allowed_files: string[]       // glob patterns — writes outside rejected
    allowed_modules: string[]
    max_new_files: number
  }
  intent: IntentClass
  acceptance_criteria: string[]
  gates: Gate[]                   // must all pass before merge
  eco_snapshot_id: string         // ECO that produced this TEE
  status: 'pending' | 'active' | 'passed' | 'failed' | 'escalated'
}
```

---

## Decomposition Rules

1. **Each TEE has exactly one primary intent.** Multi-intent tasks are split at intent boundaries.
2. **Scope is declared before any write.** The implementer agent cannot expand its scope mid-execution.
3. **TEEs are ordered.** A TEE may not begin until all predecessor TEEs have passed their gates.
4. **TEE count is bounded by strategy.** See [Strategy Selection](/docs/task-pipeline/strategy-selection) for limits per strategy.

---

## Gates

Each TEE must pass all assigned gates before the next TEE begins or the task completes:

| Gate | What it checks | Blocking? |
|------|---------------|----------|
| `lint` | ESLint rules | Yes |
| `typecheck` | `tsc --noEmit` | Yes |
| `tests` | Vitest suite | Yes |
| `size` | Bundle/file delta within threshold | Warn only |
| `human` | Manual review (Lane C only) | Yes |

A gate failure triggers escalation — not silent retry.
