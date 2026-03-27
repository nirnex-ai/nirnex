/**
 * Runtime Ledger — Append-Only Writer
 *
 * Provides the single write path for all ledger entries.
 * No update or delete helpers are exported — append-only is enforced by:
 *   - API surface (no update/delete functions exported)
 *   - DB triggers (BEFORE UPDATE / BEFORE DELETE → RAISE(ABORT))
 *
 * Sprint 20: every write now computes and stores chain integrity fields:
 *   - payload_hash     — SHA-256 of canonical payload
 *   - sequence_no      — monotonically increasing, computed inside a transaction
 *   - prev_entry_hash  — entry_hash of the prior row (GENESIS_HASH for first)
 *   - entry_hash       — SHA-256 of (ledger_id, seq, prev, payload_hash, schema, written_at)
 *   - written_at       — exact write timestamp (separate from event timestamp)
 *
 * appendLedgerEntry() now returns AppendReceipt — callers can use it for
 * cross-linking (e.g., attaching ledger references to trace context).
 * The return value is safe to ignore for backward compatibility.
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
import {
  computePayloadHash,
  computeEntryHash,
  GENESIS_HASH,
  type AppendReceipt,
} from './immutability/index.js';

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
 * Creates the `ledger_entries` table, all indexes, and immutability triggers
 * if not already present. Configures WAL mode and foreign key enforcement.
 */
export function initLedgerDb(dbPath: string): Database.Database {
  // Ensure parent directory exists (caller may use a fresh temp dir)
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run DDL statements (CREATE IF NOT EXISTS — idempotent)
  db.exec(LEDGER_TABLE_SQL);

  return db;
}

// ─── Write path ───────────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO ledger_entries (
    ledger_id, request_id, trace_id, parent_ledger_id, tee_id,
    stage, record_type, actor, timestamp, written_at, schema_version,
    payload_json, payload_hash, prev_entry_hash, entry_hash, sequence_no,
    supersedes_entry_id
  ) VALUES (
    @ledger_id, @request_id, @trace_id, @parent_ledger_id, @tee_id,
    @stage, @record_type, @actor, @timestamp, @written_at, @schema_version,
    @payload_json, @payload_hash, @prev_entry_hash, @entry_hash, @sequence_no,
    @supersedes_entry_id
  )
`;

/**
 * Append a validated LedgerEntry to the ledger DB.
 *
 * Returns an AppendReceipt containing the chain metadata for this entry.
 * The receipt can be used to cross-link ledger entries with trace context.
 *
 * Rules:
 * - Validates entry before write; throws LedgerValidationError on failure
 * - Fills timestamp if absent (fallback only — mapper-supplied timestamps preserved)
 * - Duplicate ledger_id throws (PRIMARY KEY constraint — do not suppress)
 * - All chain fields computed inside a transaction for atomicity
 */
export function appendLedgerEntry(
  db: Database.Database,
  entry: LedgerEntry,
): AppendReceipt {
  // Apply timestamp fallback BEFORE validation (so validator sees a timestamp)
  const entryWithTs: LedgerEntry = entry.timestamp
    ? entry
    : { ...entry, timestamp: new Date().toISOString() };

  const result = validateLedgerEntry(entryWithTs);
  if (!result.valid) {
    throw new LedgerValidationError(result.errors);
  }

  // Compute chain fields inside a transaction to ensure atomicity of sequence assignment
  const receipt = (db.transaction(() => {
    const { next_seq } = db.prepare(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_seq FROM ledger_entries`
    ).get() as { next_seq: number };

    const prevRow = db.prepare(
      `SELECT entry_hash FROM ledger_entries WHERE sequence_no = ?`
    ).get(next_seq - 1) as { entry_hash: string } | undefined;

    const prev_entry_hash = prevRow?.entry_hash ?? GENESIS_HASH;
    const written_at      = new Date().toISOString();
    const payload_hash    = computePayloadHash(entryWithTs.payload);
    const entry_hash      = computeEntryHash({
      ledger_id:       entryWithTs.ledger_id,
      sequence_no:     next_seq,
      prev_entry_hash,
      payload_hash,
      schema_version:  entryWithTs.schema_version,
      written_at,
    });

    db.prepare(INSERT_SQL).run({
      ledger_id:           entryWithTs.ledger_id,
      request_id:          entryWithTs.request_id,
      trace_id:            entryWithTs.trace_id,
      parent_ledger_id:    entryWithTs.parent_ledger_id ?? null,
      tee_id:              entryWithTs.tee_id ?? null,
      stage:               entryWithTs.stage,
      record_type:         entryWithTs.record_type,
      actor:               entryWithTs.actor,
      timestamp:           entryWithTs.timestamp,
      written_at,
      schema_version:      entryWithTs.schema_version,
      payload_json:        JSON.stringify(entryWithTs.payload),
      payload_hash,
      prev_entry_hash,
      entry_hash,
      sequence_no:         next_seq,
      supersedes_entry_id: entryWithTs.supersedes_entry_id ?? null,
    });

    return {
      ledger_entry_id: entryWithTs.ledger_id,
      sequence_no:     next_seq,
      entry_hash,
      prev_entry_hash,
    } satisfies AppendReceipt;
  }))();

  return receipt;
}

/**
 * Async wrapper for appendLedgerEntry.
 * Provided for forward compatibility with async storage backends.
 * Returns the AppendReceipt.
 */
export async function appendLedgerEntryAsync(
  db: Database.Database,
  entry: LedgerEntry,
): Promise<AppendReceipt> {
  return appendLedgerEntry(db, entry);
}
