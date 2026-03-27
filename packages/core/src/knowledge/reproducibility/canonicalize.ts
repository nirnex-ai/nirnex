/**
 * Reproducibility — Canonicalization
 *
 * Ensures ECO outputs and intermediate structures are sorted deterministically
 * before fingerprinting or serialization.
 *
 * Determinism usually fails in boring places:
 *   - object key order varies by JS engine / insertion order
 *   - array ordering depends on insertion sequence
 *   - Set/Map iteration order is insertion-dependent
 *   - Warning/reason accumulation order is logic-dependent
 *
 * Design constraints:
 *   - Pure functions — no side effects, no I/O
 *   - canonicalizeECO must be idempotent (applying twice = applying once)
 *   - stableJsonStringify sorts keys at every nesting level
 *   - Numeric scores are already deterministic; no rounding is applied here
 *     (callers are responsible for consistent formatting at their layer)
 */

// ─── stableJsonStringify ──────────────────────────────────────────────────────

/**
 * JSON.stringify with deterministically sorted object keys at every level.
 * Array element order is preserved (callers must sort arrays before passing).
 *
 * Useful for canonical serialization (fingerprinting, cache storage).
 */
export function stableJsonStringify(value: unknown, indent?: number): string {
  return JSON.stringify(value, sortedReplacer, indent);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

// ─── Canonical sort helpers ───────────────────────────────────────────────────

/**
 * Sort an array of strings alphabetically (stable sort).
 * Returns a new array; does not mutate input.
 */
export function sortStrings(arr: string[]): string[] {
  return [...arr].sort((a, b) => a.localeCompare(b));
}

/**
 * Sort an array of objects by a string key extractor.
 * Returns a new array; does not mutate input.
 */
export function sortBy<T>(arr: T[], key: (item: T) => string): T[] {
  return [...arr].sort((a, b) => key(a).localeCompare(key(b)));
}

// ─── Canonical conflict sort key ──────────────────────────────────────────────

/**
 * Sort key for ConflictRecord-like objects.
 * Primary: id (stable unique identifier).
 */
function conflictSortKey(c: { id?: string; [key: string]: unknown }): string {
  return c.id ?? '';
}

// ─── canonicalizeECO ─────────────────────────────────────────────────────────

/**
 * Return a new ECO object with all non-deterministic arrays canonically sorted.
 *
 * Arrays sorted:
 *   - boundary_warnings    → alphabetical
 *   - escalation_reasons   → alphabetical
 *   - conflicts            → by id
 *   - conflict_ledger_events → by kind+id (if present)
 *   - penalties            → by type+source (if present)
 *   - hub_nodes_in_path    → alphabetical
 *   - cross_module_edges   → alphabetical
 *   - unobservable_factors → alphabetical
 *
 * Dimensions, score values, and nested objects are not modified.
 * This function is idempotent: canonicalizeECO(canonicalizeECO(x)) === canonicalizeECO(x).
 *
 * @param eco - the ECO object to canonicalize
 * @returns   a new object with sorted arrays (shallow copy at top level)
 */
export function canonicalizeECO<T extends Record<string, unknown>>(eco: T): T {
  const result = { ...eco } as Record<string, unknown>;

  if (Array.isArray(result['boundary_warnings'])) {
    result['boundary_warnings'] = sortStrings(result['boundary_warnings'] as string[]);
  }

  if (Array.isArray(result['escalation_reasons'])) {
    result['escalation_reasons'] = sortStrings(result['escalation_reasons'] as string[]);
  }

  if (Array.isArray(result['hub_nodes_in_path'])) {
    result['hub_nodes_in_path'] = sortStrings(result['hub_nodes_in_path'] as string[]);
  }

  if (Array.isArray(result['cross_module_edges'])) {
    result['cross_module_edges'] = sortStrings(result['cross_module_edges'] as string[]);
  }

  if (Array.isArray(result['unobservable_factors'])) {
    result['unobservable_factors'] = sortStrings(result['unobservable_factors'] as string[]);
  }

  if (Array.isArray(result['conflicts'])) {
    result['conflicts'] = sortBy(
      result['conflicts'] as Array<{ id?: string; [key: string]: unknown }>,
      conflictSortKey,
    );
  }

  if (Array.isArray(result['conflict_ledger_events'])) {
    result['conflict_ledger_events'] = sortBy(
      result['conflict_ledger_events'] as Array<{ kind?: string; id?: string; [key: string]: unknown }>,
      (e) => `${e.kind ?? ''}:${e.id ?? ''}`,
    );
  }

  if (Array.isArray(result['penalties'])) {
    result['penalties'] = sortBy(
      result['penalties'] as Array<{ type?: string; source?: string; [key: string]: unknown }>,
      (p) => `${p.type ?? ''}:${p.source ?? ''}`,
    );
  }

  return result as T;
}
