/**
 * Ledger Immutability — Canonical Payload Serialization
 *
 * Produces a deterministic JSON string from any payload object, regardless of
 * the key insertion order used at write time. This canonical form is the input
 * to computePayloadHash().
 *
 * Rules:
 *   - Object keys are recursively sorted alphabetically
 *   - Array element order is preserved (semantic)
 *   - Primitive values pass through unchanged
 *   - null is preserved as null
 *
 * This is distinct from normalizeStageInput() in the idempotency module:
 *   - normalizeStageInput strips non-semantic fields (timestamp, cache_hit, …)
 *   - canonicalizePayload strips NOTHING — it is for hash commitment, not key comparison
 *
 * Stripping fields from stored payload would create a hash that doesn't match
 * the raw stored payload_json. That would defeat tamper detection.
 */

// ─── canonicalizePayload ──────────────────────────────────────────────────────

/**
 * Produce a canonical, deterministic JSON string from any JSON-compatible value.
 *
 * @param value - any JSON-compatible value (object, array, primitive, null)
 * @returns     - deterministic JSON string suitable for hashing
 */
export function canonicalizePayload(value: unknown): string {
  return JSON.stringify(deepSortKeys(value));
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = deepSortKeys(obj[key]);
    }
    return sorted;
  }
  return value;
}
