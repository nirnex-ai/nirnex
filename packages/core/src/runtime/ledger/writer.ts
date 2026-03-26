/**
 * Runtime Ledger — Append-Only Writer
 *
 * Provides the single write path for all ledger entries.
 * No update or delete helpers are exported — append-only is enforced by API surface.
 *
 * Design constraints:
 *   - All writes validated before persistence (throws LedgerValidationError on failure)
 *   - Duplicate ledger_id throws (PRIMARY KEY constraint — do not swallow)
 *   - Timestamp: mapper-supplied values are preserved as-is;
 *     writer fills only if timestamp is absent (fallback)
 *   - No component writes raw JSON to ledger storage directly — all writes via appendLedgerEntry
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { LEDGER_TABLE_SQL } from './schema.js';
import { validateLedgerEntry } from './validators.js';
import type { LedgerEntry } from './types.js';

// ─── Error type ───────────────────────────────────────────────────────────────

export class LedgerValidationError extends Error {
  constructor(public readonly validationErrors: string[]) {
    super(`LedgerValidationError: ${validationErrors.join('; ')}`);
    this.name = 'LedgerValidationError';
  }
}

// ─── DB initialization ────────────────────────────────────────────────────────

/**
 * Open or create the ledger SQLite DB at `dbPath`.
 * Creates the `ledger_entries` table and all indexes if not already present.
 * Configures WAL mode and foreign key enforcement.
 */
export function initLedgerDb(dbPath: string): Database.Database {
  // Ensure parent directory exists (caller may use a fresh temp dir)
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run DDL statements individually (better-sqlite3 exec supports multiple statements)
  db.exec(LEDGER_TABLE_SQL);

  return db;
}

// ─── Write path ───────────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO ledger_entries
    (ledger_id, request_id, trace_id, tee_id, stage, record_type, actor, timestamp, schema_version, payload_json)
  VALUES
    (@ledger_id, @request_id, @trace_id, @tee_id, @stage, @record_type, @actor, @timestamp, @schema_version, @payload_json)
`;

/**
 * Append a validated LedgerEntry to the ledger DB.
 *
 * Rules:
 * - Validates entry before write; throws LedgerValidationError on failure
 * - Fills timestamp if absent (fallback only — mapper-supplied timestamps are preserved)
 * - Duplicate ledger_id throws (PRIMARY KEY constraint — do not suppress)
 */
export function appendLedgerEntry(db: Database.Database, entry: LedgerEntry): void {
  // Apply timestamp fallback BEFORE validation (so validator sees a timestamp)
  const entryWithTs: LedgerEntry = entry.timestamp
    ? entry
    : { ...entry, timestamp: new Date().toISOString() };

  const result = validateLedgerEntry(entryWithTs);
  if (!result.valid) {
    throw new LedgerValidationError(result.errors);
  }

  const stmt = db.prepare(INSERT_SQL);
  stmt.run({
    ledger_id:      entryWithTs.ledger_id,
    request_id:     entryWithTs.request_id,
    trace_id:       entryWithTs.trace_id,
    tee_id:         entryWithTs.tee_id ?? null,
    stage:          entryWithTs.stage,
    record_type:    entryWithTs.record_type,
    actor:          entryWithTs.actor,
    timestamp:      entryWithTs.timestamp,
    schema_version: entryWithTs.schema_version,
    payload_json:   JSON.stringify(entryWithTs.payload),
  });
}

/**
 * Async wrapper for appendLedgerEntry.
 * Provided for forward compatibility with async storage backends.
 */
export async function appendLedgerEntryAsync(
  db: Database.Database,
  entry: LedgerEntry,
): Promise<void> {
  appendLedgerEntry(db, entry);
}
