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
 *
 * Design constraints:
 *   - Pure function — no filesystem I/O (caller decides where to persist)
 *   - All per-dimension metrics, reason codes, and thresholds are included
 *   - calculation_version is always present for future calibration
 *   - Timestamp is ISO 8601
 */

import type { ScoreDimensionsOutput, DimensionResult } from '../dimensions/types.js';

// ─── Trace types ──────────────────────────────────────────────────────────────

export interface DimensionTraceEntry {
  status: string;
  value: number;
  reason_codes: string[];
  summary: string;
  metrics: Record<string, number | string | boolean>;
  provenance: { signals: string[]; thresholds: Record<string, number> };
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

  return {
    timestamp:                     new Date().toISOString(),
    calculation_version:           output.calculation_version,
    composite_internal_confidence: output.composite_internal_confidence,
    // Top-level access for direct property checks
    ...dimEntries,
    // Nested access for structured iteration
    dimensions: dimEntries,
    signal_snapshot,
  };
}
