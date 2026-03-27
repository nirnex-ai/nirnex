/**
 * Regression Detection — Metrics Computation
 *
 * Computes aggregate RunMetrics from a window of RunOutcomeSummaryRecords.
 * All computations are deterministic and pure.
 *
 * Design constraints:
 *   - Empty window → all metrics = 0, run_count = 0
 *   - null final_confidence values are excluded from confidence computations
 *   - Rate metrics are in [0, 1]
 *   - Confidence metrics are in [0, 100]
 */

import type { RunOutcomeSummaryRecord, RunMetrics } from './types.js';

// ─── computeRunMetrics ────────────────────────────────────────────────────────

/**
 * Compute aggregate metrics from a window of run outcome summaries.
 *
 * @param summaries - window of RunOutcomeSummaryRecords to aggregate
 * @returns         - RunMetrics with all aggregate statistics
 */
export function computeRunMetrics(summaries: RunOutcomeSummaryRecord[]): RunMetrics {
  const n = summaries.length;

  if (n === 0) {
    return {
      run_count:              0,
      avg_confidence:         0,
      median_confidence:      0,
      low_confidence_share:   0,
      refusal_rate:           0,
      forced_unknown_rate:    0,
      override_rate:          0,
      evidence_gate_fail_rate: 0,
      lane_c_rate:            0,
    };
  }

  // Collect non-null confidence values for confidence metrics
  const confidences = summaries
    .map(s => s.final_confidence)
    .filter((c): c is number => c !== null && c !== undefined);

  const avg_confidence = confidences.length > 0
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0;

  const median_confidence = confidences.length > 0
    ? computeMedian(confidences)
    : 0;

  const low_confidence_share = confidences.length > 0
    ? confidences.filter(c => c < 60).length / confidences.length
    : 0;

  const refusal_rate           = summaries.filter(s => s.completion_state === 'refused').length / n;
  const forced_unknown_rate    = summaries.filter(s => s.forced_unknown_applied).length / n;
  const override_rate          = summaries.filter(s => s.had_override).length / n;
  const evidence_gate_fail_rate = summaries.filter(s => s.evidence_gate_failed).length / n;
  const lane_c_rate            = summaries.filter(s => s.final_lane === 'C').length / n;

  return {
    run_count: n,
    avg_confidence,
    median_confidence,
    low_confidence_share,
    refusal_rate,
    forced_unknown_rate,
    override_rate,
    evidence_gate_fail_rate,
    lane_c_rate,
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
