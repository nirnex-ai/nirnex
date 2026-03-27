/**
 * Ledger Immutability — Hash Functions
 *
 * Two hash functions, both returning 64-char lowercase hex SHA-256:
 *
 * computePayloadHash(payload)
 *   SHA-256 of the canonical JSON of the payload object.
 *   Stored as payload_hash in the ledger row.
 *   Used to detect any post-write mutation of payload_json.
 *
 * computeEntryHash(params)
 *   SHA-256 of a deterministic JSON string built from key entry fields:
 *     { ledger_id, sequence_no, prev_entry_hash, payload_hash, schema_version, written_at }
 *   Stored as entry_hash in the ledger row.
 *   Used to chain entries: each new entry commits to the prior entry's hash.
 *
 * Why separate functions?
 *   payload_hash proves the payload content.
 *   entry_hash proves the chain position (sequence + prior hash + identity).
 *   A tamper that replaces one entry with another valid-looking entry would need
 *   to forge both the payload_hash AND the chain of entry_hashes from that point
 *   forward — computationally infeasible.
 */

import { createHash } from 'crypto';
import { canonicalizePayload } from './canonicalize.js';
import type { EntryHashParams } from './types.js';

// ─── computePayloadHash ───────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hash of the canonical form of a ledger payload.
 *
 * @param payload - the LedgerPayload object (as parsed from storage or freshly built)
 * @returns       - 64-char lowercase hex SHA-256
 */
export function computePayloadHash(payload: unknown): string {
  return createHash('sha256')
    .update(canonicalizePayload(payload))
    .digest('hex');
}

// ─── computeEntryHash ─────────────────────────────────────────────────────────

/**
 * Compute the chain entry hash.
 *
 * Inputs committed to the hash:
 *   ledger_id       — unique identity of this entry
 *   sequence_no     — position in the chain
 *   prev_entry_hash — binds this entry to the prior entry (or GENESIS_HASH)
 *   payload_hash    — binds this entry to its payload
 *   schema_version  — binds this entry to the schema it was written under
 *   written_at      — binds this entry to its exact write timestamp
 *
 * @param params - EntryHashParams
 * @returns      - 64-char lowercase hex SHA-256
 */
export function computeEntryHash(params: EntryHashParams): string {
  // Use canonical JSON of the params object (sorted keys) for determinism
  const content = canonicalizePayload({
    ledger_id:       params.ledger_id,
    sequence_no:     params.sequence_no,
    prev_entry_hash: params.prev_entry_hash,
    payload_hash:    params.payload_hash,
    schema_version:  params.schema_version,
    written_at:      params.written_at,
  });
  return createHash('sha256').update(content).digest('hex');
}
