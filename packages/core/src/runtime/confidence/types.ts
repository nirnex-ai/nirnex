/**
 * Confidence Evolution Tracking — Types
 *
 * Defines the canonical types for tracking how confidence evolves across
 * the pipeline lifecycle as an immutable time series in the Decision Ledger.
 *
 * Design constraints:
 *   - Snapshots are append-only — existing snapshots are never mutated
 *   - Each snapshot captures the full confidence state at that moment
 *   - snapshot_index is 1-based and monotonically increasing per trace
 *   - Dimensions are numeric scores 0–100, or 'uncomputed' before scoring
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Increment when the scoring formula changes in a semantically significant way */
export const CONFIDENCE_MODEL_VERSION = '1.0.0' as const;

// ─── ConfidenceBand ───────────────────────────────────────────────────────────

/**
 * Categorical bucket derived from a numeric confidence score.
 *
 * Thresholds:
 *   high         ≥ 80
 *   moderate     ≥ 60
 *   low          ≥ 40
 *   very_low     < 40
 *   forced_unknown  runtime override — score is unreliable
 *   blocked      pipeline cannot proceed — hard gate failure
 */
export type ConfidenceBand =
  | 'high'
  | 'moderate'
  | 'low'
  | 'very_low'
  | 'forced_unknown'
  | 'blocked';

// ─── ConfidenceTriggerType ────────────────────────────────────────────────────

/**
 * The lifecycle event that caused this snapshot to be recorded.
 */
export type ConfidenceTriggerType =
  | 'eco_initialized'
  | 'evidence_gate_evaluated'
  | 'conflict_penalty_applied'
  | 'dimension_scored'
  | 'lane_classified'
  | 'lane_escalated'
  | 'override_acknowledged'
  | 'final_outcome_sealed';

// ─── ConfidenceDimensions ─────────────────────────────────────────────────────

/**
 * Per-dimension confidence scores (0–100) or 'uncomputed' if not yet evaluated.
 */
export interface ConfidenceDimensions {
  coverage:           number | 'uncomputed';
  freshness:          number | 'uncomputed';
  mapping:            number | 'uncomputed';
  conflict:           number | 'uncomputed';
  graph_completeness: number | 'uncomputed';
}

// ─── ConfidenceGates ──────────────────────────────────────────────────────────

export interface ConfidenceGates {
  sufficiency_gate_verdict?: string;
  lane?: string;
}

// ─── ConfidenceSnapshotRecord ─────────────────────────────────────────────────

/**
 * Ledger payload for a confidence evolution snapshot.
 *
 * Recorded at defined pipeline checkpoints:
 *   1. ECO_BUILD completes          → trigger='eco_initialized'
 *   2. SUFFICIENCY_GATE completes   → trigger='evidence_gate_evaluated'
 *   3. CLASSIFY_LANE completes      → trigger='lane_classified'
 *   4. Final outcome sealed         → trigger='final_outcome_sealed'
 */
export type ConfidenceSnapshotRecord = {
  kind: 'confidence_snapshot';

  /** 1-based monotonically increasing index within a trace */
  snapshot_index: number;

  /** Version of the confidence model that produced this snapshot */
  confidence_model_version: string;

  /** Raw numeric confidence computed from ECO dimensions (0–100) */
  computed_confidence: number;

  /**
   * Effective confidence after applying overrides (forced_unknown, forced_lane_minimum).
   * May differ from computed_confidence when overrides apply.
   */
  effective_confidence: number;

  /** Categorical band derived from effective_confidence + runtime flags */
  confidence_band: ConfidenceBand;

  /** Pipeline stage that triggered this snapshot */
  stage_name: string;

  /** The lifecycle event that caused this snapshot to be recorded */
  trigger_type: ConfidenceTriggerType;

  /** Per-dimension scores at the time of this snapshot */
  dimensions: ConfidenceDimensions;

  /** Gate state at the time of this snapshot (optional) */
  gates?: ConfidenceGates;

  /**
   * The effective lane determined (from forced_lane_minimum or CLASSIFY_LANE).
   * Set when known; absent at earlier checkpoints where lane hasn't been determined.
   */
  effective_lane?: string;

  /**
   * snapshot_index of the prior snapshot this diff is computed from.
   * Absent for snapshot_index=1 (no prior).
   */
  changed_from_snapshot_index?: number;

  /**
   * Change in computed_confidence from the prior snapshot.
   * null when there is no prior snapshot.
   */
  delta_composite?: number | null;

  /**
   * Human-readable reasons for this snapshot's delta, e.g. band transitions.
   */
  delta_reasons?: string[];

  /**
   * ledger_ids of the LedgerEntries this snapshot was derived from
   * (e.g. the ECO_COMPUTED decision entry).
   */
  derived_from_entry_ids?: string[];
};
