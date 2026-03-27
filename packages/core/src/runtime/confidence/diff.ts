/**
 * Confidence Evolution Tracking — Diff Computation
 *
 * Computes the delta between two consecutive confidence snapshots.
 */

import type { ConfidenceSnapshotRecord } from './types.js';

export interface ConfidenceDiffResult {
  /** Change in computed_confidence. null when no prior snapshot exists. */
  delta_composite: number | null;
  /** Human-readable reasons for this delta (e.g. band transitions) */
  delta_reasons: string[];
}

/**
 * Compute the diff between a current snapshot and an optional prior snapshot.
 *
 * @param current  - the snapshot being appended
 * @param previous - the prior snapshot in this trace (undefined for snapshot_index=1)
 */
export function computeConfidenceDiff(
  current: ConfidenceSnapshotRecord,
  previous?: ConfidenceSnapshotRecord,
): ConfidenceDiffResult {
  if (!previous) {
    return { delta_composite: null, delta_reasons: [] };
  }

  const delta_composite = current.computed_confidence - previous.computed_confidence;
  const delta_reasons: string[] = [];

  if (current.confidence_band !== previous.confidence_band) {
    delta_reasons.push(
      `band_transition: ${previous.confidence_band} → ${current.confidence_band}`,
    );
  }

  if (delta_composite > 0) {
    delta_reasons.push(`confidence_increased: +${delta_composite}`);
  } else if (delta_composite < 0) {
    delta_reasons.push(`confidence_decreased: ${delta_composite}`);
  }

  return { delta_composite, delta_reasons };
}
