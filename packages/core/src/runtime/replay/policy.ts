/**
 * Replay Engine — Policy
 *
 * Pure functions for evaluating whether a run or stage is replayable.
 * No I/O, no side effects — takes recorded materials and returns classification.
 */

import type { ReplayMaterialRecord, ReplayabilityStatus } from './types.js';

// ─── Run replayability ────────────────────────────────────────────────────────

export interface RunReplayabilityResult {
  status: ReplayabilityStatus;
  /** Stage IDs with no recorded replay material */
  missing_stages: string[];
  /** Stage IDs explicitly classified as non_replayable (output not recorded) */
  non_replayable_stages: string[];
}

/**
 * Determine the overall replayability of a run given its captured materials
 * and the set of expected stages.
 *
 * Rules:
 *   - All expected stages have 'replayable' materials → 'replayable'
 *   - No stages have materials at all               → 'non_replayable'
 *   - Some stages covered, some missing             → 'conditionally_replayable'
 *   - Any stage has replayability_status='non_replayable' → downgrade overall
 *
 * @param materials      - ReplayMaterialRecords captured during the original run
 * @param expectedStages - ordered list of stage IDs expected in a full run
 */
export function checkRunReplayability(
  materials: ReplayMaterialRecord[],
  expectedStages: string[],
): RunReplayabilityResult {
  const coveredStageIds  = new Set(materials.map(m => m.stage_id));
  const missingStages    = expectedStages.filter(s => !coveredStageIds.has(s));
  const nonReplayableStages = materials
    .filter(m => m.replayability_status === 'non_replayable')
    .map(m => m.stage_id);

  const allCovered  = missingStages.length === 0;
  const noneBlocked = nonReplayableStages.length === 0;
  const noneCovered = coveredStageIds.size === 0;

  if (allCovered && noneBlocked) {
    return { status: 'replayable', missing_stages: [], non_replayable_stages: [] };
  }
  if (noneCovered) {
    return {
      status: 'non_replayable',
      missing_stages: missingStages,
      non_replayable_stages: nonReplayableStages,
    };
  }
  return {
    status: 'conditionally_replayable',
    missing_stages: missingStages,
    non_replayable_stages: nonReplayableStages,
  };
}
