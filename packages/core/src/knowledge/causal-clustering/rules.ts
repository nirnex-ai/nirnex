/**
 * Causal Clustering — Suppression Rules
 *
 * A declarative policy table that governs how signals in a cluster are
 * classified as primary vs. derived, and how severity is bounded.
 *
 * Design constraints:
 *   - No hidden math: every suppression decision traces to a named rule
 *   - Release version is deliberately narrow — only high-confidence rules ship
 *   - Dimension priority is hard-coded (not user-tunable for release)
 *   - Multiple independent causes in the same dimension are never suppressed
 *     across each other (different fingerprints = different clusters)
 *
 * Release rules:
 *
 *   Rule 1 — SHARED_ROOT_CAUSE_MULTI_DIMENSION
 *     When signals from different dimensions share a fingerprint:
 *       - keep ALL affected dimensions visible in the output
 *       - allow only ONE full severity contribution to composite
 *       - mark remaining signals derived (suppressed_by_cluster)
 *       - select primary via DIMENSION_PRIORITY + severity tiebreak
 *
 *   Rule 2 — PRIMARY_DIMENSION_SELECTION
 *     Within a cluster, primary signal is selected by:
 *       1. Dimension priority: hard constraint > freshness > graph_completeness
 *                              > mapping > coverage > conflict > confidence_input
 *       2. If same priority: highest severity_candidate wins
 *       3. If still tied: lexicographic sort of signal_id (deterministic)
 *
 *   Rule 3 — SUPPRESSION_WEIGHT
 *     Primary signal: full weight in composite confidence
 *     Derived signals: DERIVED_WEIGHT_FACTOR of normal weight
 *
 *   Rule 4 — SEVERITY_CEILING
 *     cluster.severity_ceiling = max severity across all members
 *     A derived signal cannot independently escalate BEYOND the cluster ceiling
 *     unless it has a separate unsuppressed cause with a higher severity.
 *     (Implemented by the dimension scoring layer, not clustering itself.)
 *
 *   Rule 5 — INDEPENDENT_CAUSES_NEVER_MERGED
 *     Two signals with different fingerprints are NEVER placed in the same cluster,
 *     even if they affect the same dimension or scope.
 */

import type { CausalDimension, RawCausalSignal, SignalSeverityCandidate } from './types.js';

// ─── Dimension priority (lower index = higher priority) ───────────────────────

/**
 * Ordered priority for primary signal selection.
 * 'hard_constraint' is a sentinel for future constraint-related signals.
 * Dimensions earlier in the list take precedence.
 */
const DIMENSION_PRIORITY_ORDER: ReadonlyArray<CausalDimension | 'hard_constraint'> = [
  'freshness',          // index currency is a fundamental constraint
  'graph_completeness', // graph structure integrity
  'mapping',            // symbol resolution
  'coverage',           // evidence presence
  'conflict',           // semantic disagreements
  'confidence_input',   // composite-only signals
];

/**
 * Returns the priority rank for a dimension (lower = higher priority).
 * Unknown dimensions get lowest priority.
 */
export function getDimensionPriority(dimension: CausalDimension): number {
  const idx = DIMENSION_PRIORITY_ORDER.indexOf(dimension);
  return idx === -1 ? DIMENSION_PRIORITY_ORDER.length : idx;
}

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER: ReadonlyArray<SignalSeverityCandidate> = ['pass', 'warn', 'escalate', 'block'];

/**
 * Returns a numeric severity rank (higher = more severe).
 */
export function getSeverityRank(severity: SignalSeverityCandidate): number {
  return SEVERITY_ORDER.indexOf(severity);
}

// ─── Derived weight factor ────────────────────────────────────────────────────

/**
 * The fraction of normal composite weight applied to a derived (suppressed) signal.
 * 0.5 = 50% weight reduction for signals that are derived from a clustered root cause.
 *
 * This value is intentionally conservative: we don't suppress entirely (would hide
 * real degradation) and don't apply full weight (would defeat the purpose of clustering).
 */
export const DERIVED_WEIGHT_FACTOR = 0.5;

// ─── Rule names ───────────────────────────────────────────────────────────────

export const SUPPRESSION_RULES = {
  SHARED_ROOT_CAUSE_MULTI_DIMENSION: 'SHARED_ROOT_CAUSE_MULTI_DIMENSION',
  PRIMARY_DIMENSION_SELECTION:       'PRIMARY_DIMENSION_SELECTION',
  SUPPRESSION_WEIGHT:                'SUPPRESSION_WEIGHT',
  SEVERITY_CEILING:                  'SEVERITY_CEILING',
  INDEPENDENT_CAUSES_NEVER_MERGED:   'INDEPENDENT_CAUSES_NEVER_MERGED',
} as const;

export type SuppressionRuleName = (typeof SUPPRESSION_RULES)[keyof typeof SUPPRESSION_RULES];

// ─── Primary signal selection ─────────────────────────────────────────────────

/**
 * Select the primary signal from a set of candidates for the same cluster.
 *
 * Selection is deterministic:
 *   1. Lowest dimension priority rank (freshness wins over mapping, etc.)
 *   2. Highest severity rank (block > escalate > warn > pass)
 *   3. Lexicographic sort of signal_id as final tiebreaker
 *
 * Returns the signal_id of the selected primary.
 */
export function selectPrimarySignalId(candidates: RawCausalSignal[]): string {
  if (candidates.length === 0) {
    throw new Error('selectPrimarySignalId: candidates array is empty');
  }

  const sorted = [...candidates].sort((a, b) => {
    // 1. Dimension priority (lower rank = higher priority)
    const dimA = getDimensionPriority(a.dimension);
    const dimB = getDimensionPriority(b.dimension);
    if (dimA !== dimB) return dimA - dimB;

    // 2. Severity rank (higher severity = higher priority → sort descending)
    const sevA = getSeverityRank(a.severity_candidate);
    const sevB = getSeverityRank(b.severity_candidate);
    if (sevA !== sevB) return sevB - sevA;

    // 3. Deterministic tiebreak: lexicographic signal_id ascending
    return a.signal_id.localeCompare(b.signal_id);
  });

  return sorted[0]!.signal_id;
}

// ─── Severity ceiling computation ─────────────────────────────────────────────

/**
 * Compute the severity ceiling for a cluster: the maximum severity across all members.
 */
export function computeSeverityCeiling(
  candidates: RawCausalSignal[],
): SignalSeverityCandidate {
  let maxRank = -1;
  let ceiling: SignalSeverityCandidate = 'pass';

  for (const sig of candidates) {
    const rank = getSeverityRank(sig.severity_candidate);
    if (rank > maxRank) {
      maxRank = rank;
      ceiling = sig.severity_candidate;
    }
  }

  return ceiling;
}
