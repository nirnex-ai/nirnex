---
id: design-boundaries
title: Design Boundaries
sidebar_label: Design Boundaries
sidebar_position: 6
description: Known limitations and explicit non-goals of the Nirnex system.
---

<span class="u-eyebrow">Reference</span>

# Design Boundaries

Explicit limitations and non-goals. These are not bugs — they are deliberate scope decisions.

---

## The System Does Not Understand Code

The Knowledge Engine retrieves **structural facts**. It does not:
- Understand semantics or intent within a function body
- Reason about algorithmic correctness
- Detect business logic errors
- Understand comments or documentation prose

Reasoning happens in the LLM consuming the ECO. The knowledge layer provides the evidence that constrains that reasoning.

---

## Known Gaps

| Gap | Impact | Mitigation |
|-----|--------|-----------|
| Dynamic imports not tracked | Some dependency edges missing | Graph confidence penalty |
| Monorepo cross-package types without LSP | Symbol resolution incomplete | −25 confidence, escalate |
| Generated files (gql, proto) indexed as-is | Schema drift not detected | Freshness penalty covers this |
| Test files excluded from module graph | Test coverage not structural | Gate results used instead |
| Binary and asset files not indexed | No structural data for non-TS files | Summary-only metadata |

---

## Explicit Non-Goals

- **No autonomous commits** — the system never commits to the main branch without human approval
- **No internet access** — all retrieval is local; no external API calls in the critical path
- **No multi-repo awareness** — each repo has its own index; cross-repo analysis is out of scope
- **No historical blame analysis** — `git blame` patterns are not used for evidence scoring
- **No AI-generated tests** — the system validates against existing tests; it does not write them

---

## When to Distrust the System

Trust the ECO less when:
- Coverage dimension is at `escalate` or `block`
- The codebase has heavy use of dynamic patterns (`require(variable)`, factory functions)
- The task involves a language without tree-sitter support
- The working tree is dirty
