// Gate policy — maps conflict severity and type to Evidence Sufficiency Gate behavior.
// Returns a deterministic GateDecision with a human-readable reason.

import type { ConflictRecord, GateBehavior, GateDecision, ConflictSeverity } from '../types.js';

const BLOCKING_TYPES = new Set<ConflictRecord['type']>([
  'circular_dependency',
  'entrypoint_mismatch',
  'source_claim_contradiction',
  'spec_code_divergence',
]);

const CLARIFICATION_TYPES = new Set<ConflictRecord['type']>([
  'ownership_overlap',
  'multi_source_disagreement',
  'ambiguity_cluster',
]);

const EXPLORE_TYPES = new Set<ConflictRecord['type']>([
  'hub_collision',
  'spec_code_divergence',
]);

function gate(
  conflicts: ConflictRecord[]
): { behavior: GateBehavior; reason: string; dominantIds: string[] } {
  if (conflicts.length === 0) {
    return { behavior: 'pass', reason: 'No material conflicts detected.', dominantIds: [] };
  }

  // Sort by severity desc
  const RANK: Record<ConflictSeverity, number> = { low: 0, medium: 1, high: 2, block: 3 };
  const sorted = [...conflicts].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  const top = sorted[0];

  // Block: any blocking-severity conflict with blocking type
  const blockConflicts = conflicts.filter(
    c => c.severity === 'block' && BLOCKING_TYPES.has(c.type)
  );
  if (blockConflicts.length > 0) {
    return {
      behavior: 'refuse',
      reason: `Unresolved conflict makes safe bounded execution impossible: ${blockConflicts[0].summary}`,
      dominantIds: blockConflicts.map(c => c.id),
    };
  }

  // High severity structural → explore
  const highStructural = conflicts.filter(
    c => c.severity === 'high' && c.kind === 'structural' && EXPLORE_TYPES.has(c.type)
  );
  if (highStructural.length > 0) {
    return {
      behavior: 'explore',
      reason: `Contradictory evidence detected. Investigation allowed, commit disabled: ${highStructural[0].summary}`,
      dominantIds: highStructural.map(c => c.id),
    };
  }

  // Clarification needed: ambiguity or multi-source disagreement
  const clarifyConflicts = conflicts.filter(c => CLARIFICATION_TYPES.has(c.type));
  if (clarifyConflicts.length > 0 && top.severity !== 'low') {
    return {
      behavior: 'ask',
      reason: `Conflicting target interpretations found. Clarification required before commit: ${clarifyConflicts[0].summary}`,
      dominantIds: clarifyConflicts.map(c => c.id),
    };
  }

  // Warn: low/medium severity only
  if (top.severity === 'low' || top.severity === 'medium') {
    return {
      behavior: 'pass',
      reason: `Conflicting signals detected, but bounded execution is still safe. ${top.summary}`,
      dominantIds: [top.id],
    };
  }

  // Default: escalate to ask for anything else high severity
  return {
    behavior: 'ask',
    reason: `High-severity conflict requires clarification: ${top.summary}`,
    dominantIds: [top.id],
  };
}

export function applyGatePolicy(conflicts: ConflictRecord[]): GateDecision {
  const { behavior, reason, dominantIds } = gate(conflicts);
  return { behavior, reason, dominant_conflict_ids: dominantIds };
}
