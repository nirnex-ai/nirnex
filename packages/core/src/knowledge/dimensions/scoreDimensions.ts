/**
 * scoreDimensions — Coordinator
 *
 * The single entry point for dimension computation.
 * Accepts raw ECO-builder data, normalizes it into DimensionSignals,
 * invokes all 5 independent evaluators, runs causal clustering, applies
 * suppression to composite confidence, and produces ScoreDimensionsOutput.
 *
 * Data flow (Sprint 16+):
 *   raw input
 *     → buildDimensionSignals()     (signal normalization)
 *     → buildRawCausalSignals()     (emit causal signals per dimension)
 *     → clusterCausalSignals()      (group by root cause, assign primary/derived)
 *     → 5 independent evaluators    (unchanged — no cross-dimension coupling)
 *     → attachCausalProvenance()    (annotate DimensionResult.causal fields)
 *     → computeComposite()          (suppression-aware weighted sum)
 *
 * Design constraints:
 *   - Evaluators are invoked in isolation — no cross-dimension score reuse
 *   - Causal clustering is a SIGNAL HYGIENE layer, not a new policy layer
 *   - Dimension results retain their true status (not softened by suppression)
 *   - effective_severity may be softened only for derived-only dimensions
 *   - BLOCK on any dimension still caps composite at 40
 *   - ESCALATE on any dimension still caps composite at 70
 *   - Suppressed (derived) dimensions contribute DERIVED_WEIGHT_FACTOR of normal weight
 *   - CALCULATION_VERSION must increment when scoring logic changes
 */

import type { ScoreDimensionsOutput, RawDimensionInput, DimensionResult, DimensionSeverity } from './types.js';
import { buildDimensionSignals } from './signals.js';
import { getThresholds } from './thresholds.js';
import { computeCoverageDimension } from './coverage.js';
import { computeFreshnessDimension } from './freshness.js';
import { computeMappingDimension } from './mapping.js';
import { computeConflictDimension } from './conflict.js';
import { computeGraphCompletenessDimension } from './graphCompleteness.js';
import {
  buildRawCausalSignals,
  clusterCausalSignals,
} from '../causal-clustering/cluster.js';
import {
  DERIVED_WEIGHT_FACTOR,
  getSeverityRank,
} from '../causal-clustering/rules.js';
import type {
  CausalClusterResult,
  FingerprintFamily,
} from '../causal-clustering/types.js';

// ─── Calculation version ──────────────────────────────────────────────────────

/**
 * Semver identifier for the scoring algorithm.
 * Increment MINOR when new signals/thresholds are added.
 * Increment MAJOR when scoring semantics change incompatibly.
 * v3.0.0 introduced causal clustering and suppression-aware composite scoring.
 */
export const CALCULATION_VERSION = '3.0.0';

// ─── Dimension weights for composite confidence ───────────────────────────────

const DIMENSION_WEIGHTS: Record<string, number> = {
  coverage:  0.25,
  freshness: 0.20,
  mapping:   0.25,
  conflict:  0.20,
  graph:     0.10,
};

// ─── Dimension name to causal dimension name mapping ─────────────────────────

const DIM_TO_CAUSAL: Record<string, string> = {
  coverage:  'coverage',
  freshness: 'freshness',
  mapping:   'mapping',
  conflict:  'conflict',
  graph:     'graph_completeness',
};

// ─── attachCausalProvenance ───────────────────────────────────────────────────

/**
 * Annotate each DimensionResult with causal provenance from the cluster result.
 *
 * For each dimension:
 *   - Find all signals emitted by this dimension
 *   - Determine which clusters this dimension participates in
 *   - Classify: is this dimension a primary, derived-only, or mixed contributor?
 *   - Set effective_severity (softened for derived-only dimensions)
 *   - Set unsuppressed_severity_basis = current status (always)
 */
function attachCausalProvenance(
  dimensions: Record<string, DimensionResult>,
  clusterResult: CausalClusterResult,
  allSignals: ReturnType<typeof buildRawCausalSignals>,
): Record<string, DimensionResult> {
  const enriched: Record<string, DimensionResult> = {};

  for (const [dimName, dimResult] of Object.entries(dimensions)) {
    const causalDimName = DIM_TO_CAUSAL[dimName] ?? dimName;

    // Find all signals from this dimension
    const dimSignals = allSignals.filter(s => s.dimension === causalDimName);

    if (dimSignals.length === 0) {
      // No signals emitted → no causal provenance to attach
      enriched[dimName] = dimResult;
      continue;
    }

    const rawSignalIds = dimSignals.map(s => s.signal_id);
    const clusterIds: string[] = [];
    const primaryCauses: FingerprintFamily[] = [];
    const derivedCauses: FingerprintFamily[] = [];
    const suppressedSignals: string[] = [];

    for (const sig of dimSignals) {
      const record = clusterResult.suppression_index[sig.signal_id];
      if (!record) continue;

      if (record.status === 'primary') {
        if (record.cluster_id) clusterIds.push(record.cluster_id);
        if (sig.cause_hints[0]) primaryCauses.push(sig.cause_hints[0] as FingerprintFamily);
      } else if (record.status === 'suppressed_by_cluster') {
        if (record.cluster_id) clusterIds.push(record.cluster_id);
        if (sig.cause_hints[0]) derivedCauses.push(sig.cause_hints[0] as FingerprintFamily);
        suppressedSignals.push(sig.signal_id);
      }
      // 'independent' signals: no cluster involvement, don't add to clusterIds
    }

    // Determine effective_severity
    // If dimension has ANY primary or independent signal: effective = status (full weight)
    // If dimension has ONLY suppressed signals: effective = softened (cluster ceiling or lower)
    const hasPrimaryOrIndependent = dimSignals.some(sig => {
      const record = clusterResult.suppression_index[sig.signal_id];
      return record?.status === 'primary' || record?.status === 'independent';
    });

    let effectiveSeverity: DimensionSeverity = dimResult.status;

    if (!hasPrimaryOrIndependent && suppressedSignals.length > 0) {
      // All signals are suppressed → find cluster ceiling
      const clusterCeilings = clusterIds
        .map(cid => clusterResult.clusters.find(c => c.cluster_id === cid)?.severity_ceiling)
        .filter(Boolean);

      if (clusterCeilings.length > 0) {
        // Use the minimum ceiling (most lenient) since we're suppressing
        const minCeilingRank = Math.min(
          ...clusterCeilings.map(c => getSeverityRank(c as DimensionSeverity)),
        );
        const severityOrder: DimensionSeverity[] = ['pass', 'warn', 'escalate', 'block'];
        const dimStatusRank = getSeverityRank(dimResult.status as 'pass' | 'warn' | 'escalate' | 'block');

        // Effective severity is at most 'warn' for derived-only dimensions
        // This implements "derived signals cannot independently escalate"
        const softenedRank = Math.min(dimStatusRank, Math.min(minCeilingRank, getSeverityRank('warn')));
        effectiveSeverity = severityOrder[softenedRank] ?? dimResult.status;
      }
    }

    enriched[dimName] = {
      ...dimResult,
      causal: {
        raw_signal_ids:             rawSignalIds,
        cluster_ids:                [...new Set(clusterIds)],
        primary_causes:             [...new Set(primaryCauses)],
        derived_causes:             [...new Set(derivedCauses)],
        suppressed_signals:         suppressedSignals,
        effective_severity:         effectiveSeverity,
        unsuppressed_severity_basis: dimResult.status,
      },
    };
  }

  return enriched;
}

// ─── computeSuppressionAwareComposite ─────────────────────────────────────────

/**
 * Compute the composite confidence with suppression-aware dimension weights.
 *
 * Dimensions that are derived-only (all signals suppressed by a cluster)
 * contribute at DERIVED_WEIGHT_FACTOR of their normal weight.
 * This prevents a single root cause from triple-penalizing the composite.
 *
 * Severity caps remain unchanged:
 *   any BLOCK  → cap at 40
 *   any ESCALATE → cap at 70
 */
function computeSuppressionAwareComposite(
  dimensions: Record<string, DimensionResult>,
  clusterResult: CausalClusterResult,
  allSignals: ReturnType<typeof buildRawCausalSignals>,
): number {
  let composite = 0;

  for (const [key, dim] of Object.entries(dimensions)) {
    const weight = DIMENSION_WEIGHTS[key] ?? 0;
    const causalDimName = DIM_TO_CAUSAL[key] ?? key;

    // Find signals from this dimension
    const dimSignals = allSignals.filter(s => s.dimension === causalDimName);

    // Determine if dimension is derived-only (all its signals are suppressed)
    const hasPrimaryOrIndependent = dimSignals.some(sig => {
      const record = clusterResult.suppression_index[sig.signal_id];
      return record?.status === 'primary' || record?.status === 'independent';
    });

    const allSuppressed =
      dimSignals.length > 0 &&
      !hasPrimaryOrIndependent &&
      dimSignals.every(sig => {
        const record = clusterResult.suppression_index[sig.signal_id];
        return record?.status === 'suppressed_by_cluster';
      });

    const effectiveWeight = allSuppressed ? weight * DERIVED_WEIGHT_FACTOR : weight;
    composite += dim.value * effectiveWeight * 100;
  }

  composite = Math.round(Math.min(100, Math.max(0, composite)));

  // Apply severity caps: any BLOCK → cap at 40; any ESCALATE → cap at 70
  const hasBlock    = Object.values(dimensions).some(d => d.status === 'block');
  const hasEscalate = Object.values(dimensions).some(d => d.status === 'escalate');

  if (hasBlock) {
    composite = Math.min(composite, 40);
  } else if (hasEscalate) {
    composite = Math.min(composite, 70);
  }

  return composite;
}

// ─── scoreDimensions ──────────────────────────────────────────────────────────

/**
 * Score all 5 ECO dimensions from raw ECO builder data.
 *
 * @param raw  - raw inputs from the ECO builder (spec, evidence, conflicts, graph, etc.)
 * @returns    ScoreDimensionsOutput with all 5 dimensions, composite confidence,
 *             causal cluster result, and trace
 */
export function scoreDimensions(raw: RawDimensionInput): ScoreDimensionsOutput {
  // ── Step 1: Normalize signals ─────────────────────────────────────────────
  const signals = buildDimensionSignals(raw);

  // ── Step 2: Get thresholds (with optional intent overrides) ───────────────
  const thresholds = getThresholds(raw.intent);

  // ── Step 3: Emit causal signals and run clustering ────────────────────────
  const rawCausalSignals = buildRawCausalSignals(signals);
  const clusterResult: CausalClusterResult = clusterCausalSignals(rawCausalSignals);

  // ── Step 4: Run 5 independent evaluators ─────────────────────────────────
  // Each evaluator reads only from `signals` — no cross-dimension coupling.
  const baseDimensions = {
    coverage:  computeCoverageDimension(signals, thresholds),
    freshness: computeFreshnessDimension(signals, thresholds),
    mapping:   computeMappingDimension(signals, thresholds),
    conflict:  computeConflictDimension(signals, thresholds),
    graph:     computeGraphCompletenessDimension(signals, thresholds),
  };

  // ── Step 5: Attach causal provenance to dimension results ─────────────────
  const enrichedRecord = attachCausalProvenance(
    baseDimensions as unknown as Record<string, DimensionResult>,
    clusterResult,
    rawCausalSignals,
  );
  const dimensions = {
    coverage:  enrichedRecord['coverage']!  as DimensionResult,
    freshness: enrichedRecord['freshness']! as DimensionResult,
    mapping:   enrichedRecord['mapping']!   as DimensionResult,
    conflict:  enrichedRecord['conflict']!  as DimensionResult,
    graph:     enrichedRecord['graph']!     as DimensionResult,
  };

  // ── Step 6: Compute suppression-aware composite confidence ────────────────
  const composite = computeSuppressionAwareComposite(
    dimensions as unknown as Record<string, DimensionResult>,
    clusterResult,
    rawCausalSignals,
  );

  return {
    dimensions,
    composite_internal_confidence: composite,
    trace_inputs: signals,
    calculation_version: CALCULATION_VERSION,
    causal_cluster_result: clusterResult,
  };
}

export type { RawDimensionInput, ScoreDimensionsOutput };
