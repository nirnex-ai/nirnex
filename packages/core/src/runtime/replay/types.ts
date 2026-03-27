/**
 * Replay Engine — Types
 *
 * Defines the canonical types for deterministic replay of pipeline runs.
 *
 * Core contract:
 *   Replay is reconstruction of prior execution using recorded stage inputs,
 *   recorded stage outputs, and recorded nondeterministic dependency responses.
 *   Replay is NOT fresh execution against live dependencies.
 *
 * Three explicitly distinct execution modes:
 *   live    — original execution against live dependencies
 *   replay  — reconstruction from recorded materials (deterministic)
 *   re_run  — fresh execution against current live world (may differ)
 *
 * Design constraints:
 *   - Replay materials are append-only ledger records (never mutated)
 *   - Reconstruction reads only from the ledger — no live handler calls
 *   - Replayability is classified per stage, not just at run level
 *   - Reconstruction result is itself recorded in the ledger
 */

// ─── Execution mode ───────────────────────────────────────────────────────────

/**
 * Explicitly distinct execution modes.
 * These must never be conflated — replay and re_run have fundamentally
 * different guarantees.
 */
export type ExecutionMode = 'live' | 'replay' | 're_run';

// ─── Replayability status ─────────────────────────────────────────────────────

/**
 * Stage-level replayability classification.
 *
 *   replayable                — input, output, and all dependencies recorded
 *   conditionally_replayable  — output recorded but some dependencies missing
 *   non_replayable            — output not recorded; reconstruction impossible
 */
export type ReplayabilityStatus =
  | 'replayable'
  | 'conditionally_replayable'
  | 'non_replayable';

// ─── Ledger record families ───────────────────────────────────────────────────

/**
 * Records the captured input/output of a pipeline stage during original live execution.
 * This is the primary replay artifact — reconstruction reads these to reconstruct
 * stage outputs without calling any live handlers.
 */
export type ReplayMaterialRecord = {
  kind: 'replay_material';

  /** Pipeline stage this material was captured from */
  stage_id: string;

  /** Always 'live' — replay materials are captured during original execution */
  execution_mode: ExecutionMode;

  /** SHA-256 of normalized stage input */
  input_hash: string;

  /** SHA-256 of normalized stage output — used to verify reconstruction integrity */
  output_hash: string;

  /** Stage input after normalization (deep-sorted, all fields preserved) */
  normalized_input: unknown;

  /** Stage output after normalization — this IS the reconstructed output during replay */
  normalized_output: unknown;

  /** Stage-level replayability classification */
  replayability_status: ReplayabilityStatus;

  /**
   * Position in the dependency sequence within this stage.
   * 0 for the stage handler itself; >0 for subsequent nondeterministic calls (future).
   */
  dependency_sequence_index: number;

  /** Reference to the BoundTrace inputHash for cross-linking */
  trace_ref?: string;
};

/**
 * Records the initiation of a replay attempt.
 * Written to the ledger at the start of reconstructRun().
 * Distinguishes this replay trace from the original live run in the ledger.
 */
export type ReplayAttemptedRecord = {
  kind: 'replay_attempted';

  /** trace_id of the original run being replayed */
  run_trace_id: string;

  /** Always 'replay' — explicitly distinguishes from live or re_run */
  execution_mode: 'replay';

  /** Stage IDs requested for reconstruction */
  stages_requested: string[];
};

/**
 * Records a successful full reconstruction where all stage output hashes matched.
 * Written when every stage in stage_results has verified=true.
 */
export type ReplayVerifiedRecord = {
  kind: 'replay_verified';

  /** trace_id of the original run that was successfully replayed */
  run_trace_id: string;

  /** Stage IDs that passed hash verification */
  stages_verified: string[];

  /** Count of successfully verified stages */
  verified_count: number;
};

/**
 * Records a failed reconstruction.
 * Written when any stage hash mismatch is detected or required materials are missing.
 */
export type ReplayFailedRecord = {
  kind: 'replay_failed';

  /** trace_id of the original run that failed to replay */
  run_trace_id: string;

  /** Human-readable failure reason */
  failure_reason: string;

  /** First stage where divergence was detected */
  divergence_stage?: string;

  /** The recorded output hash that was expected */
  expected_hash?: string;

  /** The reconstructed output hash that was produced */
  actual_hash?: string;
};

// ─── Replay report ────────────────────────────────────────────────────────────

/**
 * Per-stage reconstruction result.
 */
export interface StageReplayResult {
  stage_id: string;
  replayability_status: ReplayabilityStatus;
  recorded_output_hash: string;
  reconstructed_output_hash: string;
  /** true when reconstructed_output_hash === recorded_output_hash */
  verified: boolean;
  failure_reason?: string;
}

/**
 * Full reconstruction report returned by reconstructRun().
 *
 * mode is always 'replay' — never 'live' or 're_run'.
 * This field must be checked before interpreting results.
 */
export interface ReplayReport {
  /** trace_id of the original run that was reconstructed */
  run_trace_id: string;

  /** Always 'replay' — explicitly distinguishes from live execution */
  mode: 'replay';

  /** true when ALL expected stages have replayable materials (status=replayable) */
  overall_replayable: boolean;

  /** true when ALL stages were verified (recorded hash === reconstructed hash) */
  verified: boolean;

  /** Per-stage reconstruction results in canonical pipeline order */
  stage_results: StageReplayResult[];

  /** stage_id of the first divergence point, if any verification failed */
  divergence_point?: string;

  /** Stage IDs with no recorded replay material */
  missing_stages?: string[];
}
