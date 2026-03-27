/**
 * Ledger Immutability — Runtime Guards
 *
 * Utility functions for asserting and checking ledger integrity at runtime.
 *
 * These are the operational boundary: if a governance-sensitive operation
 * (override review, audit export, final disposition) is about to execute,
 * these guards can confirm the ledger chain is intact before proceeding.
 *
 * Design constraints:
 *   - All checks are non-destructive (read-only)
 *   - Guards throw LedgerIntegrityError on failure — callers decide whether to
 *     escalate, block, or log-and-continue
 *   - ensureImmutabilityTriggers() is idempotent — safe to call on every open
 */

import type Database from 'better-sqlite3';
import { verifyLedgerChain } from './verify.js';

// ─── LedgerIntegrityError ─────────────────────────────────────────────────────

export class LedgerIntegrityError extends Error {
  constructor(
    public readonly verificationErrors: string[],
    message: string = `Ledger integrity check failed with ${verificationErrors.length} error(s)`,
  ) {
    super(message);
    this.name = 'LedgerIntegrityError';
  }
}

// ─── ensureImmutabilityTriggers ───────────────────────────────────────────────

/**
 * Install the UPDATE/DELETE protection triggers if they are not already present.
 * Idempotent: CREATE TRIGGER IF NOT EXISTS.
 *
 * Called by initLedgerDb() — guards must be active from the first write.
 */
export function ensureImmutabilityTriggers(db: InstanceType<typeof Database>): void {
  db.exec(`
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
  `);
}

// ─── assertLedgerIntact ───────────────────────────────────────────────────────

/**
 * Assert that the entire ledger chain is intact.
 * Throws LedgerIntegrityError if any check fails.
 *
 * Use before governance-sensitive operations:
 *   - override approval
 *   - audit export
 *   - final disposition
 */
export function assertLedgerIntact(db: InstanceType<typeof Database>): void {
  const result = verifyLedgerChain(db);
  if (!result.valid) {
    throw new LedgerIntegrityError(result.errors);
  }
}

// ─── getLedgerIntegrityStatus ─────────────────────────────────────────────────

/**
 * Non-throwing version of the integrity check.
 * Returns a status object suitable for health checks and monitoring surfaces.
 */
export function getLedgerIntegrityStatus(db: InstanceType<typeof Database>): {
  status: 'pass' | 'fail';
  verified_count: number;
  error_count: number;
  errors: string[];
} {
  const result = verifyLedgerChain(db);
  return {
    status:         result.valid ? 'pass' : 'fail',
    verified_count: result.verified_count,
    error_count:    result.errors.length,
    errors:         result.errors,
  };
}
