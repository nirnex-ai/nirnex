-- ai-delivery-os SQLite schema
-- All 8 tables: modules, dependencies, edges, patterns, gate_results, summaries, hub_summaries, _meta

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── _meta ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

-- ─── modules ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  language      TEXT,
  loc           INTEGER DEFAULT 0,
  complexity    REAL    DEFAULT 0,
  indexed_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  content_hash  TEXT,
  is_hub        BOOLEAN DEFAULT 0
);

-- ─── dependencies ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dependencies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  specifier   TEXT    NOT NULL,
  resolved    TEXT,
  kind        TEXT    NOT NULL DEFAULT 'import',  -- import | require | dynamic
  is_local    BOOLEAN DEFAULT 0,
  is_cross_module BOOLEAN DEFAULT 0,
  UNIQUE(module_id, specifier)
);

-- ─── edges ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  to_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  kind      TEXT    NOT NULL DEFAULT 'static',  -- static | dynamic | re-export
  weight    REAL    DEFAULT 1.0,
  UNIQUE(from_id, to_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);

-- ─── patterns ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patterns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,   -- e.g. 'god-module', 'circular', 'hub'
  severity    TEXT    NOT NULL DEFAULT 'info',  -- info | warning | critical
  detail      TEXT,
  detected_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── gate_results ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gate_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT    NOT NULL,
  gate        TEXT    NOT NULL,   -- e.g. 'complexity', 'coverage', 'lint'
  status      TEXT    NOT NULL,   -- pass | fail | warn | skip
  score       REAL,
  detail      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gate_results_run ON gate_results(run_id);

-- ─── summaries ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS summaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  model       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  token_count INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(module_id, model)
);

-- ─── hub_summaries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub_summaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_path    TEXT    NOT NULL,   -- conceptual hub identifier (e.g. directory)
  model       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  token_count INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hub_path, model)
);
