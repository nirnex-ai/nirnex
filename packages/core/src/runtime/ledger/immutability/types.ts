/**
 * Ledger Immutability — Types
 *
 * AppendReceipt     — returned by appendLedgerEntry() for cross-linking and audit
 * ChainVerificationResult — returned by all verify*() functions
 * EntryHashParams   — inputs used to compute the entry hash
 */

// ─── GENESIS_HASH ─────────────────────────────────────────────────────────────

/**
 * Well-known sentinel for the first entry in the chain.
 * The first appended entry always has prev_entry_hash = GENESIS_HASH.
 */
export const GENESIS_HASH = '0'.repeat(64);

// ─── AppendReceipt ────────────────────────────────────────────────────────────

/**
 * Returned by appendLedgerEntry() after a successful write.
 *
 * Callers may attach this to trace context for cross-linking
 * (tracing which ledger entry corresponds to a given pipeline event)
 * without making the trace file the authority on ledger content.
 */
export interface AppendReceipt {
  /** The ledger_id of the newly appended entry */
  ledger_entry_id: string;
  /** Monotonically increasing sequence number assigned to this entry */
  sequence_no: number;
  /** SHA-256 of key entry fields — proof of identity for this append */
  entry_hash: string;
  /** entry_hash of the immediately prior entry (GENESIS_HASH for first) */
  prev_entry_hash: string;
}

// ─── ChainVerificationResult ──────────────────────────────────────────────────

/**
 * Returned by verifyLedgerChain(), verifyLedgerRange(), and verifyLedgerEntry().
 *
 * On tamper or chain break: valid=false, errors contains diagnostic messages.
 */
export interface ChainVerificationResult {
  valid: boolean;
  errors: string[];
  /** Number of entries successfully verified */
  verified_count: number;
  /** sequence_no of the first entry in the verified range (0 if empty) */
  first_sequence: number;
  /** sequence_no of the last entry in the verified range (0 if empty) */
  last_sequence: number;
}

// ─── EntryHashParams ──────────────────────────────────────────────────────────

/** Inputs to computeEntryHash() — exactly what gets committed to the hash */
export interface EntryHashParams {
  ledger_id: string;
  sequence_no: number;
  prev_entry_hash: string;
  payload_hash: string;
  schema_version: string;
  written_at: string;
}
