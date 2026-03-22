---
id: intent-detection
title: Intent Detection
sidebar_label: Intent Detection
sidebar_position: 1
description: Heuristic-based intent detection from spec files. Maximum two intents per task.
---

<span class="u-eyebrow">Architecture · Intent & ECO</span>

# Intent Detection

Intent detection parses the spec file and classifies the task into one or two intent classes. **Heuristic only — no LLM in this step.**

---

## Intent Classes

| Intent | Trigger signals | Retrieval bias |
|--------|----------------|---------------|
| `REFACTOR` | "extract", "move", "rename", "restructure" | Dependency graph, call sites |
| `BUG_FIX` | "fix", "broken", "failing", "error", "regression" | Symbol history, gate results |
| `FEATURE_ADD` | "add", "implement", "new", "create" | Export surface, module boundaries |
| `NEEDS_EXPLORE` | "understand", "map", "investigate", "unclear" | Vector search activated |
| `CONFIG_CHANGE` | "update config", "env", "setting", ".env" | File metadata only |
| `UNKNOWN` | None of the above match with confidence | Broad retrieval, all tiers |

---

## Rules

- **Maximum 2 intents per task.** A task that appears to span 3+ intents is flagged for decomposition before proceeding.
- **UNKNOWN is valid.** It is not an error — it triggers broad retrieval and a reduced sufficiency threshold.
- **No model inference.** Detection is keyword + pattern matching against the spec's title, description, and acceptance criteria fields.

---

## Output

```json
{
  "intents": ["BUG_FIX", "REFACTOR"],
  "confidence": 0.87,
  "signals": ["fix", "restructure"],
  "flagged_for_decomposition": false
}
```

This output feeds directly into the [Query Router](/docs/knowledge-engine/query-router) to bias retrieval strategy.
