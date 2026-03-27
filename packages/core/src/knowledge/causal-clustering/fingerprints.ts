/**
 * Causal Clustering — Deterministic Fingerprinting
 *
 * Produces stable fingerprints for probable shared root causes.
 * Two signals with the same fingerprint join the same cluster.
 *
 * Fingerprint inputs (deterministic fields only):
 *   - cause_hints[0]  — the primary cause family (drives the fingerprint)
 *   - scope_refs      — sorted canonical scope IDs
 *
 * Design constraints:
 *   - Pure function — no side effects, no I/O, no randomness
 *   - Only the first cause hint drives the fingerprint (one signal = one cluster)
 *   - Scope comparison is EXACT — different scopes are different root causes
 *   - Do not use semantic similarity, fuzzy matching, or LLM classification
 *
 * What is intentionally NOT included in the fingerprint:
 *   - severity_candidate (two signals with same cause but different severity still cluster)
 *   - commit_ref (not always available; its absence must not prevent clustering)
 *   - entity_refs / path_refs (too granular; scope_refs provide sufficient isolation)
 *   - metadata (diagnostic-only; must not influence clustering)
 */

import type { RawCausalSignal } from './types.js';

// ─── Separator constants ──────────────────────────────────────────────────────

const FAMILY_SCOPE_SEPARATOR  = '::';
const SCOPE_LIST_SEPARATOR    = ',';

// ─── buildFingerprint ─────────────────────────────────────────────────────────

/**
 * Compute a deterministic fingerprint for a RawCausalSignal.
 *
 * Format: `<primary_cause_family>::<sorted_scope_refs_joined_by_comma>`
 *
 * Examples:
 *   STALE_INDEX_SCOPE_MISMATCH::src/auth/login.ts,src/auth/session.ts
 *   MISSING_REQUIRED_EVIDENCE::src/payments/charge.ts
 *   CONFLICTING_EVIDENCE_SET::   (empty scope = global conflict)
 *
 * @param signal - the raw causal signal to fingerprint
 * @returns      stable fingerprint string
 */
export function buildFingerprint(signal: RawCausalSignal): string {
  const primaryFamily = signal.cause_hints[0];

  if (!primaryFamily) {
    // Signal with no cause hints cannot be clustered — use a unique sentinel
    return `__NO_CAUSE_HINT__::${signal.signal_id}`;
  }

  // Sort scope_refs for order-independence
  const sortedScope = [...signal.scope_refs].sort().join(SCOPE_LIST_SEPARATOR);

  return `${primaryFamily}${FAMILY_SCOPE_SEPARATOR}${sortedScope}`;
}

// ─── assignFingerprints ───────────────────────────────────────────────────────

/**
 * Assign fingerprints to an array of signals in-place.
 * Returns the same array with fingerprint fields populated.
 *
 * This is a convenience function for the clustering pipeline.
 * Signals already having a non-empty fingerprint are NOT re-fingerprinted.
 */
export function assignFingerprints(signals: RawCausalSignal[]): RawCausalSignal[] {
  for (const signal of signals) {
    if (!signal.fingerprint) {
      signal.fingerprint = buildFingerprint(signal);
    }
  }
  return signals;
}
