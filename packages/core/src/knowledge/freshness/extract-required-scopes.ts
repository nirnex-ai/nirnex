import type { RequiredScopeRef } from './types.js';

export interface RequiredScopeInput {
  /** Canonical file paths touched by retrieval / ECO (e.g. eco.modules_touched). */
  modulesTouched?: string[];
  /** Symbol IDs explicitly requested by intent or plan. */
  symbols?: string[];
  /** Hub nodes already in the retrieval path (graph source, higher weight). */
  hubNodes?: string[];
}

/**
 * Convert ECO / retrieval data into a canonical list of RequiredScopeRef objects.
 *
 * Weight assignment (deterministic, not model-inferred):
 *   - retrieval (modulesTouched) → weight 1.0
 *   - graph (hubNodes)           → weight 1.5  (hub = higher blast-radius)
 *   - intent (symbols)           → weight 1.2  (explicit symbol request)
 *
 * Duplicates are eliminated — if a file appears in both modulesTouched and
 * hubNodes, the higher-weight entry wins.
 */
export function extractRequiredScopes(input: RequiredScopeInput): RequiredScopeRef[] {
  const { modulesTouched = [], symbols = [], hubNodes = [] } = input;

  const seen = new Map<string, RequiredScopeRef>();

  const upsert = (ref: RequiredScopeRef) => {
    const existing = seen.get(ref.scopeId);
    if (!existing || ref.weight > existing.weight) {
      seen.set(ref.scopeId, ref);
    }
  };

  // ── Retrieval source — base weight ───────────────────────────────────────
  for (const filePath of modulesTouched) {
    if (!filePath) continue;
    upsert({
      filePath,
      scopeId: filePath,
      source: 'retrieval',
      weight: 1.0,
    });
  }

  // ── Graph source — hub nodes carry higher weight ──────────────────────────
  for (const filePath of hubNodes) {
    if (!filePath) continue;
    upsert({
      filePath,
      scopeId: filePath,
      source: 'graph',
      weight: 1.5,
    });
  }

  // ── Intent source — explicit symbol requests ──────────────────────────────
  for (const symbolId of symbols) {
    if (!symbolId) continue;
    upsert({
      symbolId,
      scopeId: symbolId,
      source: 'intent',
      weight: 1.2,
    });
  }

  return Array.from(seen.values());
}
