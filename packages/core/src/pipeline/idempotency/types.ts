/**
 * Pipeline Idempotency — Types
 *
 * StageExecutionRecord — persisted record for each stage execution attempt.
 * StageExecutionStatus — lifecycle of a single execution claim.
 * IdempotencyDecision  — policy output: what the orchestrator should do.
 * StageIdempotencyMeta — per-stage configuration baked into STAGE_IDEMPOTENCY.
 */

// ─── Execution status ─────────────────────────────────────────────────────────

export type StageExecutionStatus = 'in_progress' | 'completed' | 'failed';

// ─── Execution record ─────────────────────────────────────────────────────────

export interface StageExecutionRecord {
  /** SHA-256 key derived from (orchestrator_version, stage_id, contract_version, input_hash, upstream_keys) */
  execution_key: string;
  stage_id: string;
  contract_version: string;
  /** SHA-256 of the normalized stage input */
  input_hash: string;
  status: StageExecutionStatus;
  trace_id: string;
  request_id: string;
  started_at: string;
  completed_at?: string;
  /** JSON-serialized stage output — present only when status='completed' */
  output_json?: string;
  /** SHA-256 of output_json — present only when status='completed' */
  result_hash?: string;
}

// ─── Idempotency decision ─────────────────────────────────────────────────────

export interface IdempotencyDecision {
  /** execute  — run the stage handler fresh
   *  replay   — return stored output without running handler
   *  reject_duplicate_inflight — another execution is already in_progress for this key
   */
  action: 'execute' | 'replay' | 'reject_duplicate_inflight';
  /** Present when action is 'replay' or 'reject_duplicate_inflight' */
  record?: StageExecutionRecord;
}

// ─── Per-stage idempotency configuration ─────────────────────────────────────

export interface StageIdempotencyMeta {
  /**
   * required — idempotency is enforced; completed results are replayed
   * none     — idempotency is never applied; stage always re-executes
   */
  mode: 'required' | 'none';
  /**
   * pure             — no observable side effects; safe to replay freely
   * external_mutation — produces side effects; treat with caution
   */
  side_effect_class: 'pure' | 'external_mutation';
}
