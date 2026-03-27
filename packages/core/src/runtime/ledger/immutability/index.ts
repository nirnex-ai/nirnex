/**
 * Ledger Immutability — Public API
 *
 * Tamper-evident append-only ledger foundation:
 *   - Canonical payload serialization for stable hashing
 *   - SHA-256 payload hash + chained entry hash
 *   - Chain verification at full, range, and entry granularity
 *   - Runtime guards and LedgerIntegrityError
 */

export { canonicalizePayload } from './canonicalize.js';
export { computePayloadHash, computeEntryHash } from './hash.js';
export { verifyLedgerChain, verifyLedgerRange, verifyLedgerEntry } from './verify.js';
export {
  ensureImmutabilityTriggers,
  assertLedgerIntact,
  getLedgerIntegrityStatus,
  LedgerIntegrityError,
} from './guards.js';

export {
  GENESIS_HASH,
  type AppendReceipt,
  type ChainVerificationResult,
  type EntryHashParams,
} from './types.js';
