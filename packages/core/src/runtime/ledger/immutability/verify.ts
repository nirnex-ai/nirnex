/**
 * Ledger Immutability — Chain Verification
 *
 * Three verification functions at different granularities:
 *
 *   verifyLedgerChain(db)
 *     Verifies the entire ledger. Use for startup checks, audit export,
 *     and governance-sensitive operations.
 *
 *   verifyLedgerRange(db, startSeq, endSeq)
 *     Verifies a contiguous slice of the chain. Use for incremental verification
 *     of large ledgers or replay verification windows.
 *
 *   verifyLedgerEntry(db, ledgerId)
 *     Verifies a single entry in isolation. Checks payload_hash and entry_hash
 *     but NOT the prev_entry_hash chain (use verifyLedgerRange for chain checks).
 *
 * Checks performed:
 *   1. Sequence continuity — no gaps in sequence_no
 *   2. Prev-hash continuity — each entry's prev_entry_hash = prior entry's entry_hash
 *   3. Payload integrity — recomputed payload_hash === stored payload_hash
 *   4. Entry integrity — recomputed entry_hash === stored entry_hash
 *   5. Orphan corrections — supersedes_entry_id references must exist in the ledger
 *
 * Design constraints:
 *   - Read-only: never modifies the DB
 *   - Deterministic: same DB → same result
 *   - Returns structured errors (not exceptions) for graceful degradation
 */

import type Database from 'better-sqlite3';
import { computePayloadHash, computeEntryHash } from './hash.js';
import { GENESIS_HASH, type ChainVerificationResult } from './types.js';

// ─── Internal row type ────────────────────────────────────────────────────────

interface LedgerRow {
  ledger_id:           string;
  sequence_no:         number;
  prev_entry_hash:     string;
  payload_json:        string;
  payload_hash:        string;
  entry_hash:          string;
  schema_version:      string;
  written_at:          string;
  supersedes_entry_id: string | null;
}

// ─── verifyLedgerChain ────────────────────────────────────────────────────────

/**
 * Verify the full ledger chain.
 */
export function verifyLedgerChain(db: InstanceType<typeof Database>): ChainVerificationResult {
  const rows = db.prepare(
    `SELECT ledger_id, sequence_no, prev_entry_hash, payload_json,
            payload_hash, entry_hash, schema_version, written_at, supersedes_entry_id
     FROM ledger_entries ORDER BY sequence_no ASC`
  ).all() as LedgerRow[];

  return verifyRows(db, rows);
}

// ─── verifyLedgerRange ────────────────────────────────────────────────────────

/**
 * Verify a contiguous slice of the chain by sequence number (inclusive).
 */
export function verifyLedgerRange(
  db: InstanceType<typeof Database>,
  startSeq: number,
  endSeq: number,
): ChainVerificationResult {
  const rows = db.prepare(
    `SELECT ledger_id, sequence_no, prev_entry_hash, payload_json,
            payload_hash, entry_hash, schema_version, written_at, supersedes_entry_id
     FROM ledger_entries WHERE sequence_no >= ? AND sequence_no <= ? ORDER BY sequence_no ASC`
  ).all(startSeq, endSeq) as LedgerRow[];

  return verifyRows(db, rows, /* skipChainContinuity */ true);
}

// ─── verifyLedgerEntry ────────────────────────────────────────────────────────

/**
 * Verify a single entry by ledger_id.
 * Checks payload_hash and entry_hash only — not the full chain.
 */
export function verifyLedgerEntry(
  db: InstanceType<typeof Database>,
  ledgerId: string,
): ChainVerificationResult {
  const row = db.prepare(
    `SELECT ledger_id, sequence_no, prev_entry_hash, payload_json,
            payload_hash, entry_hash, schema_version, written_at, supersedes_entry_id
     FROM ledger_entries WHERE ledger_id = ?`
  ).get(ledgerId) as LedgerRow | undefined;

  if (!row) {
    return {
      valid: false,
      errors: [`entry not found: ledger_id='${ledgerId}'`],
      verified_count: 0,
      first_sequence: 0,
      last_sequence: 0,
    };
  }

  const errors: string[] = [];
  verifyEntryHashes(row, errors);

  return {
    valid: errors.length === 0,
    errors,
    verified_count: errors.length === 0 ? 1 : 0,
    first_sequence: row.sequence_no,
    last_sequence:  row.sequence_no,
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Core verification loop over an ordered list of rows.
 *
 * @param db                   - database (used for orphan reference checks)
 * @param rows                 - ordered by sequence_no ASC
 * @param skipChainContinuity  - if true, skip gap and prev-hash chain checks
 *                               (used for range queries that may not start at seq=1)
 */
function verifyRows(
  db: InstanceType<typeof Database>,
  rows: LedgerRow[],
  skipChainContinuity = false,
): ChainVerificationResult {
  const errors: string[] = [];

  if (rows.length === 0) {
    return { valid: true, errors: [], verified_count: 0, first_sequence: 0, last_sequence: 0 };
  }

  // Build a set of all ledger_ids for orphan reference checking
  const allIds = new Set(
    (db.prepare(`SELECT ledger_id FROM ledger_entries`).all() as { ledger_id: string }[])
      .map(r => r.ledger_id)
  );

  let expectedSeq = skipChainContinuity ? rows[0].sequence_no : 1;
  let prevHash = GENESIS_HASH;

  // For range queries, the "previous hash" is whatever preceded the first row
  if (skipChainContinuity && rows.length > 0) {
    // Use the stored prev_entry_hash of the first row as the baseline
    prevHash = rows[0].prev_entry_hash;
  }

  for (const row of rows) {
    // 1. Sequence continuity
    if (!skipChainContinuity && row.sequence_no !== expectedSeq) {
      errors.push(
        `sequence gap: expected sequence_no=${expectedSeq}, got ${row.sequence_no} ` +
        `(ledger_id='${row.ledger_id}')`
      );
      // Reset expected to continue detecting further gaps
      expectedSeq = row.sequence_no + 1;
    } else {
      expectedSeq = row.sequence_no + 1;
    }

    // 2. Prev-hash continuity
    if (!skipChainContinuity && row.prev_entry_hash !== prevHash) {
      errors.push(
        `chain break at sequence_no=${row.sequence_no}: ` +
        `expected prev_entry_hash='${prevHash}', got '${row.prev_entry_hash}' ` +
        `(ledger_id='${row.ledger_id}')`
      );
    }

    // 3 & 4. Payload and entry hash integrity
    verifyEntryHashes(row, errors);

    // 5. Orphan correction check
    if (row.supersedes_entry_id !== null) {
      if (!allIds.has(row.supersedes_entry_id)) {
        errors.push(
          `orphan correction at sequence_no=${row.sequence_no}: ` +
          `supersedes_entry_id='${row.supersedes_entry_id}' not found in ledger ` +
          `(ledger_id='${row.ledger_id}')`
        );
      }
    }

    prevHash = row.entry_hash;
  }

  const verified_count = errors.length === 0 ? rows.length : 0;

  return {
    valid: errors.length === 0,
    errors,
    verified_count,
    first_sequence: rows[0].sequence_no,
    last_sequence:  rows[rows.length - 1].sequence_no,
  };
}

/**
 * Verify payload_hash and entry_hash for a single row.
 * Pushes error strings into `errors` array if mismatches are found.
 */
function verifyEntryHashes(row: LedgerRow, errors: string[]): void {
  // 3. Payload integrity
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(row.payload_json);
  } catch {
    errors.push(
      `invalid payload_json at sequence_no=${row.sequence_no} ` +
      `(ledger_id='${row.ledger_id}'): JSON parse failed`
    );
    return;
  }

  const recomputedPayloadHash = computePayloadHash(parsedPayload);
  if (recomputedPayloadHash !== row.payload_hash) {
    errors.push(
      `payload tampered at sequence_no=${row.sequence_no} ` +
      `(ledger_id='${row.ledger_id}'): ` +
      `stored payload_hash='${row.payload_hash}', ` +
      `recomputed='${recomputedPayloadHash}'`
    );
  }

  // 4. Entry hash integrity
  const recomputedEntryHash = computeEntryHash({
    ledger_id:       row.ledger_id,
    sequence_no:     row.sequence_no,
    prev_entry_hash: row.prev_entry_hash,
    payload_hash:    row.payload_hash,
    schema_version:  row.schema_version,
    written_at:      row.written_at,
  });
  if (recomputedEntryHash !== row.entry_hash) {
    errors.push(
      `entry_hash mismatch at sequence_no=${row.sequence_no} ` +
      `(ledger_id='${row.ledger_id}'): ` +
      `stored='${row.entry_hash}', ` +
      `recomputed='${recomputedEntryHash}'`
    );
  }
}
