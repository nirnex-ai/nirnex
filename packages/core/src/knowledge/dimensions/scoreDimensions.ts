/**
 * scoreDimensions — Coordinator
 *
 * The single entry point for dimension computation.
 * Accepts raw ECO-builder data, normalizes it into DimensionSignals,
 * invokes all 5 independent evaluators, and produces ScoreDimensionsOutput.
 *
 * Design constraints:
 *   - Evaluators are invoked in isolation — no cross-dimension score reuse
 *   - Composite confidence is derived from dimension values, not input signals
 *   - BLOCK on any dimension caps composite at 40
 *   - ESCALATE on any dimension caps composite at 70
 *   - CALCULATION_VERSION must increment when scoring logic changes
 */

import type { ScoreDimensionsOutput, RawDimensionInput } from './types.js';
import { buildDimensionSignals } from './signals.js';
import { getThresholds } from './thresholds.js';
import { computeCoverageDimension } from './coverage.js';
import { computeFreshnessDimension } from './freshness.js';
import { computeMappingDimension } from './mapping.js';
import { computeConflictDimension } from './conflict.js';
import { computeGraphCompletenessDimension } from './graphCompleteness.js';

// ─── Calculation version ──────────────────────────────────────────────────────

/**
 * Semver identifier for the scoring algorithm.
 * Increment MINOR when new signals/thresholds are added.
 * Increment MAJOR when scoring semantics change incompatibly.
 * This version is stored in every trace record for future calibration.
 */
export const CALCULATION_VERSION = '2.0.0';

// ─── Dimension weights for composite confidence ───────────────────────────────

const DIMENSION_WEIGHTS: Record<string, number> = {
  coverage:  0.25,
  freshness: 0.20,
  mapping:   0.25,
  conflict:  0.20,
  graph:     0.10,
};

// ─── scoreDimensions ──────────────────────────────────────────────────────────

/**
 * Score all 5 ECO dimensions from raw ECO builder data.
 *
 * @param raw  - raw inputs from the ECO builder (spec, evidence, conflicts, graph, etc.)
 * @returns    ScoreDimensionsOutput with all 5 dimensions, composite confidence, and trace
 */
export function scoreDimensions(raw: RawDimensionInput): ScoreDimensionsOutput {
  // ── Step 1: Normalize signals ─────────────────────────────────────────────
  const signals = buildDimensionSignals(raw);

  // ── Step 2: Get thresholds (with optional intent overrides) ───────────────
  const thresholds = getThresholds(raw.intent);

  // ── Step 3: Run 5 independent evaluators ─────────────────────────────────
  // Each evaluator reads only from `signals` — no cross-dimension coupling.
  const coverage  = computeCoverageDimension(signals, thresholds);
  const freshness = computeFreshnessDimension(signals, thresholds);
  const mapping   = computeMappingDimension(signals, thresholds);
  const conflict  = computeConflictDimension(signals, thresholds);
  const graph     = computeGraphCompletenessDimension(signals, thresholds);

  const dimensions = { coverage, freshness, mapping, conflict, graph };

  // ── Step 4: Compute composite internal confidence ─────────────────────────
  let composite = 0;
  for (const [key, dim] of Object.entries(dimensions)) {
    const weight = DIMENSION_WEIGHTS[key] ?? 0;
    composite += dim.value * weight * 100;
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

  return {
    dimensions,
    composite_internal_confidence: composite,
    trace_inputs: signals,
    calculation_version: CALCULATION_VERSION,
  };
}

export type { RawDimensionInput, ScoreDimensionsOutput };
