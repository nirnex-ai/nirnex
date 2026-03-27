/**
 * Confidence Evolution Tracking — Snapshot Builder
 *
 * Constructs ConfidenceSnapshotRecord instances from pipeline stage outputs.
 */

import type {
  ConfidenceSnapshotRecord,
  ConfidenceDimensions,
  ConfidenceGates,
  ConfidenceTriggerType,
} from './types.js';
import { CONFIDENCE_MODEL_VERSION } from './types.js';
import { computeConfidenceBand, ecoSeverityToScore } from './bands.js';
import { computeConfidenceDiff } from './diff.js';
import type { EcoDimensions } from '../../pipeline/types.js';

// ─── Dimension mapper ─────────────────────────────────────────────────────────

/**
 * Convert EcoDimensions (severity strings) to ConfidenceDimensions (scores 0–100).
 */
export function ecoDimensionsToConfidence(ecoDims: EcoDimensions): ConfidenceDimensions {
  return {
    coverage:           ecoSeverityToScore(ecoDims.coverage.severity),
    freshness:          ecoSeverityToScore(ecoDims.freshness.severity),
    mapping:            ecoSeverityToScore(ecoDims.mapping.severity),
    conflict:           ecoSeverityToScore(ecoDims.conflict.severity),
    graph_completeness: ecoSeverityToScore(ecoDims.graph.severity),
  };
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

export interface BuildSnapshotParams {
  snapshot_index: number;
  computed_confidence: number;
  stage_name: string;
  trigger_type: ConfidenceTriggerType;
  dimensions: ConfidenceDimensions;
  /** forced_unknown flag from ECO output */
  forced_unknown?: boolean;
  /** blocked flag (e.g. from gate refusal) */
  blocked?: boolean;
  /** effective_lane from forced_lane_minimum or CLASSIFY_LANE output */
  effective_lane?: string;
  /** gate results at time of snapshot */
  gates?: ConfidenceGates;
  /** prior snapshot for diff computation */
  previous?: ConfidenceSnapshotRecord;
  /** ledger_ids of entries this snapshot is derived from */
  derived_from_entry_ids?: string[];
}

/**
 * Build a ConfidenceSnapshotRecord with diff computed against the prior snapshot.
 */
export function buildConfidenceSnapshot(params: BuildSnapshotParams): ConfidenceSnapshotRecord {
  const band = computeConfidenceBand(params.computed_confidence, {
    forced_unknown: params.forced_unknown,
    blocked: params.blocked,
  });

  const diff = computeConfidenceDiff(
    {
      kind: 'confidence_snapshot',
      snapshot_index: params.snapshot_index,
      confidence_model_version: CONFIDENCE_MODEL_VERSION,
      computed_confidence: params.computed_confidence,
      effective_confidence: params.computed_confidence,
      confidence_band: band,
      stage_name: params.stage_name,
      trigger_type: params.trigger_type,
      dimensions: params.dimensions,
    },
    params.previous,
  );

  const snapshot: ConfidenceSnapshotRecord = {
    kind: 'confidence_snapshot',
    snapshot_index: params.snapshot_index,
    confidence_model_version: CONFIDENCE_MODEL_VERSION,
    computed_confidence: params.computed_confidence,
    effective_confidence: params.computed_confidence,
    confidence_band: band,
    stage_name: params.stage_name,
    trigger_type: params.trigger_type,
    dimensions: params.dimensions,
  };

  if (params.gates) snapshot.gates = params.gates;
  if (params.effective_lane) snapshot.effective_lane = params.effective_lane;

  if (params.previous) {
    snapshot.changed_from_snapshot_index = params.previous.snapshot_index;
    snapshot.delta_composite = diff.delta_composite;
    snapshot.delta_reasons = diff.delta_reasons;
  } else {
    snapshot.delta_composite = null;
  }

  if (params.derived_from_entry_ids?.length) {
    snapshot.derived_from_entry_ids = params.derived_from_entry_ids;
  }

  return snapshot;
}
