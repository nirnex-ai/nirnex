/**
 * Runtime Ledger — Schema
 *
 * SQL DDL for the ledger_entries table and canonical DB path resolver.
 *
 * Design constraints:
 *   - Ledger DB is separate from the index DB (.aidos.db) — different concerns
 *   - getLedgerDbPath() is the ONLY sanctioned way to derive the ledger DB path
 *   - LEDGER_TABLE_SQL is idempotent (CREATE IF NOT EXISTS + indexes)
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

// ─── Table DDL ────────────────────────────────────────────────────────────────

/**
 * Idempotent DDL for the ledger_entries table and its indexes.
 *
 * Columns:
 *   ledger_id      — PRIMARY KEY (UUID)
 *   request_id     — user request root (multiple traces may share this)
 *   trace_id       — execution trace root (one per runOrchestrator call)
 *   tee_id         — optional Task Execution Envelope correlation
 *   stage          — pipeline stage or synthetic category
 *   record_type    — SQL-queryable projection of payload.kind
 *   actor          — who produced this record
 *   timestamp      — ISO 8601 event time (mapper-supplied)
 *   schema_version — schema version at write time
 *   payload_json   — JSON-serialized LedgerPayload
 *
 * Indexes cover all common query patterns:
 *   - fetch all records for a trace
 *   - fetch all records for a request (spans traces)
 *   - fetch by stage or record_type
 *   - chronological ordering
 */
export const LEDGER_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ledger_entries (
    ledger_id      TEXT    PRIMARY KEY,
    request_id     TEXT    NOT NULL,
    trace_id       TEXT    NOT NULL,
    tee_id         TEXT,
    stage          TEXT    NOT NULL,
    record_type    TEXT    NOT NULL,
    actor          TEXT    NOT NULL,
    timestamp      TEXT    NOT NULL,
    schema_version TEXT    NOT NULL,
    payload_json   TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_request  ON ledger_entries(request_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_trace    ON ledger_entries(trace_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_tee      ON ledger_entries(tee_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_stage    ON ledger_entries(stage);
  CREATE INDEX IF NOT EXISTS idx_ledger_type     ON ledger_entries(record_type);
  CREATE INDEX IF NOT EXISTS idx_ledger_ts       ON ledger_entries(timestamp);
`;
