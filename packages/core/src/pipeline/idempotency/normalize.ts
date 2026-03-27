/**
 * Pipeline Idempotency — Input Normalization
 *
 * Produces a canonical, deterministic form of a stage input object so that
 * two inputs that are semantically equivalent produce the same JSON string
 * (and therefore the same execution key hash).
 *
 * Rules:
 *   - Object keys are deep-sorted alphabetically
 *   - Non-semantic fields are stripped at every nesting level
 *   - Array element order is preserved (arrays carry semantic ordering)
 *   - Primitive values (string, number, boolean, null) are passed through
 *
 * Non-semantic fields (stripped because they vary per-invocation but do not
 * affect the semantic content of a computation):
 *   timestamp, frozen_at, created_at, cache_hit
 */

// ─── Non-semantic field registry ─────────────────────────────────────────────

const NON_SEMANTIC_FIELDS = new Set([
  'timestamp',
  'frozen_at',
  'created_at',
  'cache_hit',
]);

// ─── normalizeStageInput ──────────────────────────────────────────────────────

/**
 * Recursively normalize an object for use in execution key computation.
 *
 * @param input - any JSON-compatible value
 * @returns     - normalized, deterministic form of the input
 */
export function normalizeStageInput(input: unknown): unknown {
  if (Array.isArray(input)) {
    // Preserve array order — semantic ordering must not be changed
    return input.map(normalizeStageInput);
  }

  if (input !== null && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    // Sort keys alphabetically for canonical ordering
    for (const key of Object.keys(obj).sort()) {
      if (!NON_SEMANTIC_FIELDS.has(key)) {
        result[key] = normalizeStageInput(obj[key]);
      }
    }
    return result;
  }

  // Primitives pass through unchanged
  return input;
}
