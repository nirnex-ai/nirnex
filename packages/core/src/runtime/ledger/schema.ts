/**
 * Runtime Ledger — Schema
 *
 * SQL DDL for the ledger_entries table and canonical DB path resolver.
 *
 * Sprint 20 additions (tamper-evident append-only ledger):
 *   - parent_ledger_id column (was in LedgerEntry type but not stored)
 *   - written_at  — actual write timestamp (vs mapper-supplied event timestamp)
 *   - sequence_no — monotonically increasing chain position
 *   - payload_hash — SHA-256 of canonical payload JSON
 *   - prev_entry_hash — entry_hash of the immediately prior entry
 *   - entry_hash — SHA-256 of (ledger_id, sequence_no, prev_entry_hash, payload_hash, schema_version, written_at)
 *   - supersedes_entry_id — for correction entries: references the superseded entry
 *   - UNIQUE indexes on sequence_no and entry_hash (enforce chain integrity at DB level)
 *   - BEFORE UPDATE trigger: rejects all updates (append-only)
 *   - BEFORE DELETE trigger: rejects all deletes (append-only)
 *
 * Design constraints:
 *   - Ledger DB is separate from the index DB (.aidos.db) — different concerns
 *   - getLedgerDbPath() is the ONLY sanctioned way to derive the ledger DB path
 *   - LEDGER_TABLE_SQL is idempotent (CREATE IF NOT EXISTS + indexes + triggers)
 *   - LEDGER_TABLE_BASE_SQL is the table-only DDL (no triggers) — for testing
 */

import path from 'path';

export { LEDGER_SCHEMA_VERSION } from './types.js';

// ─── DB path resolver ─────────────────────────────────────────────────────────

/**
 * Returns the canonical path for the ledger SQLite DB within a project root.
 *
 * Callers MUST use this function — never construct the path ad-hoc.
 * This keeps path derivation consistent and testable.
 */
export function getLedgerDbPath(targetRoot: string): string {
  return path.join(targetRoot, '.aidos-ledger.db');
}

// ─── Table DDL (columns only — no triggers) ───────────────────────────────────

/**
 * CREATE TABLE only — no immutability triggers, no unique indexes on chain fields.
 *
 * EXPORTED FOR TESTING ONLY.
 * Production code must use LEDGER_TABLE_SQL (which includes triggers).
 * This constant exists so adversarial tests can create tamper-able DBs.
 */
export const LEDGER_TABLE_BASE_SQL = `
  CREATE TABLE IF NOT EXISTS ledger_entries (
    ledger_id           TEXT    PRIMARY KEY,
    request_id          TEXT    NOT NULL,
    trace_id            TEXT    NOT NULL,
    parent_ledger_id    TEXT,
    tee_id              TEXT,
    stage               TEXT    NOT NULL,
    record_type         TEXT    NOT NULL,
    actor               TEXT    NOT NULL,
    timestamp           TEXT    NOT NULL,
    written_at          TEXT    NOT NULL,
    schema_version      TEXT    NOT NULL,
    payload_json        TEXT    NOT NULL,
    payload_hash        TEXT    NOT NULL,
    prev_entry_hash     TEXT    NOT NULL,
    entry_hash          TEXT    NOT NULL,
    sequence_no         INTEGER NOT NULL,
    supersedes_entry_id TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_sequence   ON ledger_entries(sequence_no);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entry_hash ON ledger_entries(entry_hash);
  CREATE INDEX IF NOT EXISTS idx_ledger_request  ON ledger_entries(request_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_trace    ON ledger_entries(trace_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_tee      ON ledger_entries(tee_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_stage    ON ledger_entries(stage);
  CREATE INDEX IF NOT EXISTS idx_ledger_type     ON ledger_entries(record_type);
  CREATE INDEX IF NOT EXISTS idx_ledger_ts       ON ledger_entries(timestamp);
`;

// ─── Full immutable DDL (table + triggers) ────────────────────────────────────

/**
 * Idempotent DDL for the ledger_entries table, all indexes, and immutability triggers.
 *
 * New columns (Sprint 20):
 *   parent_ledger_id    — parent record linkage (chain of stages within a trace)
 *   written_at          — exact write timestamp for hash computation
 *   sequence_no         — monotonically increasing chain position (UNIQUE)
 *   payload_hash        — SHA-256 of canonical payload JSON
 *   prev_entry_hash     — entry_hash of the prior entry (GENESIS_HASH for first)
 *   entry_hash          — SHA-256 of (ledger_id, seq, prev, payload_hash, schema, written_at)
 *   supersedes_entry_id — for correction entries: references superseded entry_id
 *
 * Triggers:
 *   ledger_no_update — BEFORE UPDATE: always RAISE(ABORT, 'ledger is append-only')
 *   ledger_no_delete — BEFORE DELETE: always RAISE(ABORT, 'ledger is append-only')
 */
export const LEDGER_TABLE_SQL = LEDGER_TABLE_BASE_SQL + `
  CREATE TRIGGER IF NOT EXISTS ledger_no_update
    BEFORE UPDATE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'ledger is append-only: UPDATE is not permitted');
    END;

  CREATE TRIGGER IF NOT EXISTS ledger_no_delete
    BEFORE DELETE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'ledger is append-only: DELETE is not permitted');
    END;
`;
