/**
 * Ledger — Dimension Scoring Trace
 *
 * Captures a complete, replay-capable trace record from a ScoreDimensionsOutput.
 * Stored in the decision ledger to enable:
 *   - replay (same inputs → same outputs)
 *   - calibration (compare expected vs. actual per-dimension)
 *   - refusal audit (what signals drove a block?)
 *   - regression diagnosis (did a threshold change affect behavior?)
 *   - override governance (what would happen without the override?)
 *   - causal cluster inspection (what got clustered, why, what was suppressed)
 *
 * Design constraints:
 *   - Pure function — no filesystem I/O (caller decides where to persist)
 *   - All per-dimension metrics, reason codes, and thresholds are included
 *   - calculation_version is always present for future calibration
 *   - Timestamp is ISO 8601
 *   - causal_clustering section is always present from v3.0.0 onward
 */

import type { ScoreDimensionsOutput, DimensionResult } from '../dimensions/types.js';
import type { SuppressionRecord } from '../causal-clustering/types.js';

// ─── Trace types ──────────────────────────────────────────────────────────────

export interface DimensionTraceEntry {
  status: string;
  value: number;
  reason_codes: string[];
  summary: string;
  metrics: Record<string, number | string | boolean>;
  provenance: { signals: string[]; thresholds: Record<string, number> };
}

export interface CausalClusteringTrace {
  /** All raw causal signals emitted before clustering. */
  raw_signals: Array<{
    signal_id: string;
    dimension: string;
    signal_type: string;
    severity_candidate: string;
    cause_hints: string[];
    fingerprint: string;
    scope_refs: string[];
  }>;
  /** All clusters formed this session. */
  clusters: Array<{
    cluster_id: string;
    root_cause_type: string;
    fingerprint: string;
    primary_signal_id: string;
    member_signal_ids: string[];
    affected_dimensions: string[];
    severity_ceiling: string;
    suppression_rule: string;
    explanation: string;
  }>;
  /** Full suppression decision for every signal. */
  suppression_decisions: SuppressionRecord[];
  /** Map from signal_id → 'primary' | 'derived' | 'independent'. */
  primary_vs_derived_map: Record<string, 'primary' | 'derived' | 'independent'>;
  /** Per-dimension suppression summary. */
  effective_dimension_inputs: Record<string, {
    suppressed: boolean;
    cluster_ids: string[];
    primary_causes: string[];
    derived_causes: string[];
  }>;
}

export interface DimensionScoringTrace {
  timestamp: string;
  calculation_version: string;
  composite_internal_confidence: number;
  /** Dimension entries also available at the top level for direct property access. */
  coverage:  DimensionTraceEntry;
  freshness: DimensionTraceEntry;
  mapping:   DimensionTraceEntry;
  conflict:  DimensionTraceEntry;
  graph:     DimensionTraceEntry;
  /** Nested dimensions object for structured iteration. Same entries as top-level. */
  dimensions: {
    coverage:  DimensionTraceEntry;
    freshness: DimensionTraceEntry;
    mapping:   DimensionTraceEntry;
    conflict:  DimensionTraceEntry;
    graph:     DimensionTraceEntry;
  };
  /** Signal snapshot used for scoring — enables full replay */
  signal_snapshot: Record<string, unknown>;
  /**
   * Causal clustering audit record (Sprint 16+).
   * Always present from calculation_version 3.0.0 onward.
   * Enables full inspection of: what was clustered, why, and what was suppressed.
   */
  causal_clustering: CausalClusteringTrace;
}

// ─── traceDimensionScoring ────────────────────────────────────────────────────

/**
 * Build a DimensionScoringTrace from a ScoreDimensionsOutput.
 *
 * @param output - the complete output from scoreDimensions()
 * @returns      DimensionScoringTrace suitable for ledger storage
 */
export function traceDimensionScoring(output: ScoreDimensionsOutput): DimensionScoringTrace {
  const traceDimension = (dim: DimensionResult): DimensionTraceEntry => ({
    status:       dim.status,
    value:        dim.value,
    reason_codes: dim.reason_codes,
    summary:      dim.summary,
    metrics:      dim.metrics,
    provenance:   dim.provenance,
  });

  // Serialize the signal snapshot — serialize all primitive fields for replay
  const signals = output.trace_inputs;
  const signal_snapshot: Record<string, unknown> = {
    intent:                  signals.intent,
    matchedScopeCount:       signals.matchedScopeCount,
    requestedScopeCount:     signals.requestedScopeCount,
    retrievedEvidenceClasses: signals.retrievedEvidenceClasses,
    requiredEvidenceClasses:  signals.requiredEvidenceClasses,
    mappingPattern:           signals.mappingPattern,
    primaryCandidateScore:    signals.primaryCandidateScore,
    alternateCandidateScore:  signals.alternateCandidateScore,
    symbolsResolved:          signals.symbolsResolved,
    symbolsUnresolved:        signals.symbolsUnresolved,
    conflictCount:            signals.conflicts?.length ?? 0,
    parseFailureCount:        signals.parseFailureCount,
    brokenSymbolCount:        signals.brokenSymbolCount,
    totalSymbolCount:         signals.totalSymbolCount,
    graphDepthAchieved:       signals.graphDepthAchieved,
    graphDepthRequested:      signals.graphDepthRequested,
    fallbackUsageRate:        signals.fallbackUsageRate,
    criticalNodesMissing:     signals.criticalNodesMissing,
    freshnessImpactSeverity:  signals.freshnessImpact?.severity ?? null,
    freshnessImpactRatio:     signals.freshnessImpact?.impactRatio ?? null,
    scopeIds:                 signals.scopeIds,
  };

  const dimEntries = {
    coverage:  traceDimension(output.dimensions.coverage),
    freshness: traceDimension(output.dimensions.freshness),
    mapping:   traceDimension(output.dimensions.mapping),
    conflict:  traceDimension(output.dimensions.conflict),
    graph:     traceDimension(output.dimensions.graph),
  };

  // ── Causal clustering trace ────────────────────────────────────────────────
  const clusterResult = output.causal_cluster_result;

  // Build primary_vs_derived_map
  const primary_vs_derived_map: Record<string, 'primary' | 'derived' | 'independent'> = {};
  for (const [signalId, record] of Object.entries(clusterResult.suppression_index)) {
    primary_vs_derived_map[signalId] =
      record.status === 'suppressed_by_cluster' ? 'derived' :
      record.status === 'primary'               ? 'primary' :
      'independent';
  }

  // Build effective_dimension_inputs summary per dimension
  const effective_dimension_inputs: Record<string, {
    suppressed: boolean;
    cluster_ids: string[];
    primary_causes: string[];
    derived_causes: string[];
  }> = {};

  const dimNames: Array<keyof typeof output.dimensions> = ['coverage', 'freshness', 'mapping', 'conflict', 'graph'];
  for (const dimName of dimNames) {
    const dim = output.dimensions[dimName];
    if (dim.causal) {
      effective_dimension_inputs[dimName] = {
        suppressed:     dim.causal.suppressed_signals.length > 0 && dim.causal.primary_causes.length === 0,
        cluster_ids:    dim.causal.cluster_ids,
        primary_causes: dim.causal.primary_causes,
        derived_causes: dim.causal.derived_causes,
      };
    } else {
      effective_dimension_inputs[dimName] = {
        suppressed:     false,
        cluster_ids:    [],
        primary_causes: [],
        derived_causes: [],
      };
    }
  }

  const causal_clustering: CausalClusteringTrace = {
    raw_signals: clusterResult.all_signals.map(s => ({
      signal_id:          s.signal_id,
      dimension:          s.dimension,
      signal_type:        s.signal_type,
      severity_candidate: s.severity_candidate,
      cause_hints:        s.cause_hints,
      fingerprint:        s.fingerprint,
      scope_refs:         s.scope_refs,
    })),
    clusters: clusterResult.clusters.map(c => ({
      cluster_id:         c.cluster_id,
      root_cause_type:    c.root_cause_type,
      fingerprint:        c.fingerprint,
      primary_signal_id:  c.primary_signal_id,
      member_signal_ids:  c.member_signal_ids,
      affected_dimensions: c.affected_dimensions,
      severity_ceiling:   c.severity_ceiling,
      suppression_rule:   c.suppression_rule,
      explanation:        c.explanation,
    })),
    suppression_decisions: Object.values(clusterResult.suppression_index),
    primary_vs_derived_map,
    effective_dimension_inputs,
  };

  return {
    timestamp:                     new Date().toISOString(),
    calculation_version:           output.calculation_version,
    composite_internal_confidence: output.composite_internal_confidence,
    // Top-level access for direct property checks
    ...dimEntries,
    // Nested access for structured iteration
    dimensions: dimEntries,
    signal_snapshot,
    causal_clustering,
  };
}
