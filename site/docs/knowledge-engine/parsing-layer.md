---
id: parsing-layer
title: Parsing Layer
sidebar_label: Parsing Layer
sidebar_position: 2
description: Tree-sitter based atomic post-commit parsing that updates the module index within ~200ms.
---

<span class="u-eyebrow">Knowledge Engine · Layer 01</span>

# Parsing Layer

Post-commit parsing updates the module index in **~200ms**. Atomic, silent, every commit.

---

## Pipeline

```
git post-commit hook
  └─► nirnex index --changed-only
        ├─► tree-sitter parse (TypeScript/JavaScript)
        ├─► ctags fallback (unsupported languages)
        ├─► extract: symbols · exports · imports · dependencies
        └─► upsert → SQLite (WAL, atomic transaction)
```

---

## Parser Stack

| Tool | Role | Fallback |
|------|------|---------|
| **tree-sitter-typescript** | Primary — full AST, symbol resolution | ctags |
| **ctags** | Secondary — any language tree-sitter doesn't cover | summary-only |
| **Summary-only** | Tertiary — file-level metadata when no parser available | −15 confidence penalty |

---

## What Gets Indexed

Every parsed file produces a module record with:

- `exports[]` — named and default exports
- `imports[]` — resolved import paths
- `symbols[]` — functions, classes, interfaces, type aliases
- `dependencies[]` — resolved module graph edges
- `last_parsed_at` — commit SHA + timestamp
- `parse_method` — `tree-sitter | ctags | summary`

---

## Staleness

The index is considered stale if it is **1+ commits behind HEAD**. This triggers a −20 confidence deduction. The system does not block on stale data — it penalises it and reports it.
