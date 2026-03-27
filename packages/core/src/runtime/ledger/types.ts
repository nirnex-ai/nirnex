/**
 * Runtime Ledger — Canonical Types
 *
 * Defines the LedgerEntry envelope and 5 record families (discriminated union).
 * Every ledger write must conform to LedgerEntry.
 *
 * Design constraints:
 *   - record_type is the SQL-queryable projection of payload.kind — they MUST match
 *   - 'override' and 'outcome' are synthetic stages (not pipeline positions)
 *   - record_type: 'trace' is LEGACY IMPORT ONLY — not for new governance records
 *   - Multiple traces may share a request_id (retries, replays)
 *
 * Parent semantics:
 *   1. Stage DecisionRecords — linear chain: parent = previous stage's ledger_id
 *   2. OverrideRecords      — parent = ledger_id of the targeted record
 *   3. OutcomeRecord        — parent = last stage's ledger_id
 *   4. Trace-adapter records — no parent (undefined)
 */

// ─── Schema version ───────────────────────────────────────────────────────────

export const LEDGER_SCHEMA_VERSION = '1.0.0' as const;

// ─── Stage ────────────────────────────────────────────────────────────────────

/**
 * Pipeline positions + synthetic terminal/system stages.
 *
 * NOTE: 'override' and 'outcome' are NOT pipeline positions.
 * They are event categories. Timeline reconstruction must not assume
 * they appear between pipeline stages.
 */
export type LedgerStage =
  | 'knowledge'
  | 'eco'
  | 'classification'
  | 'strategy'
  | 'pre_tool_guard'
  | 'implementation'
  | 'validation'
  | 'post_tool_trace'
  | 'stop'
  | 'override'   // synthetic — marks an override event, not a pipeline position
  | 'outcome'    // synthetic — marks terminal state, not a pipeline position
  | 'execution'  // synthetic — marks idempotency replay/rejection events
  | 'confidence' // synthetic — marks confidence evolution snapshots
  | 'replay';    // synthetic — marks replay engine records (materials, attempts, results)

// ─── Record type ──────────────────────────────────────────────────────────────

export type LedgerRecordType =
  | 'decision'
  | 'trace'
  | 'override'
  | 'outcome'
  | 'refusal'
  | 'deviation'
  | 'stage_replay'
  | 'stage_rejection'
  | 'correction'
  | 'confidence_snapshot'
  | 'replay_material'
  | 'replay_attempted'
  | 'replay_verified'
  | 'replay_failed';

// ─── Actor ────────────────────────────────────────────────────────────────────

export type LedgerActor = 'system' | 'analyst' | 'human';

// ─── Record families ──────────────────────────────────────────────────────────

export type DecisionRecord = {
  kind: 'decision';
  decision_name: string;
  decision_code: string;
  input_refs: {
    eco_id?: string;
    tee_id?: string;
    trace_ids?: string[];
    evidence_ids?: string[];
    policy_ids?: string[];
  };
  result: {
    status: 'pass' | 'warn' | 'escalate' | 'block' | 'refuse';
    selected_value?: string;
    selected_lane?: 'A' | 'B' | 'C';
  };
  rationale: {
    summary: string;
    rule_refs: string[];
    signal_refs?: string[];
  };
  severity?: 'low' | 'medium' | 'high' | 'critical';
};

export type OverrideRecord = {
  kind: 'override';
  override_id: string;
  target_stage: string;
  target_record_id?: string;
  scope: {
    files?: string[];
    commands?: string[];
    tee_ids?: string[];
  };
  reason: string;
  token_id?: string;
  expires_at?: string;
  approved_by: 'human' | 'analyst';
  effect: 'allow' | 'force_lane' | 'bypass_guard' | 'accept_deviation';
};

export type OutcomeRecord = {
  kind: 'outcome';
  completion_state: 'merged' | 'escalated' | 'abandoned' | 'refused';
  artifact_refs?: {
    commit_sha?: string;
    files_changed?: string[];
    validation_run_ids?: string[];
  };
  quality_summary?: {
    validations_passed: string[];
    validations_failed: string[];
    deviations_detected?: number;
  };
  final_lane?: 'A' | 'B' | 'C';
  final_disposition_reason: string;
};

export type RefusalRecord = {
  kind: 'refusal';
  refusal_code: string;
  refusal_reason: string;
  blocking_dimension?: 'coverage' | 'freshness' | 'mapping' | 'conflict' | 'graph';
  required_action?: string;
};

export type DeviationRecord = {
  kind: 'deviation';
  detected_at_stage: string;
  expected_ref?: string;
  observed_summary: string;
  severity: 'low' | 'medium' | 'high';
  disposition: 'logged' | 'escalated' | 'overridden' | 'abandoned';
};

// ─── Stage replay record ──────────────────────────────────────────────────────

export type StageReplayRecord = {
  kind: 'stage_replay';
  stage_id: string;
  /** The execution key whose stored output is being replayed */
  replay_of_execution_key: string;
  /** trace_id of the original execution that produced the stored output */
  original_trace_id: string;
  result_hash?: string;
};

// ─── Stage rejection record ───────────────────────────────────────────────────

export type StageRejectionRecord = {
  kind: 'stage_rejection';
  stage_id: string;
  /** The execution key that was found to be in_progress by another caller */
  execution_key: string;
  rejection_reason: string;
};

/**
 * LEGACY IMPORT ONLY.
 *
 * Used exclusively to adapt pre-existing Sprint 6 trace blobs into the ledger.
 * New governance-producing code MUST NOT emit TraceAdapterRecord unless
 * explicitly importing historical data. This is a bounded loophole — bypassing
 * typed record families undermines ledger governance discipline.
 */
export type TraceAdapterRecord = {
  kind: 'trace';
  raw: unknown;
};

// ─── Correction record ────────────────────────────────────────────────────────

/**
 * Represents a governance correction: a new entry that acknowledges a prior
 * entry while recording a revised interpretation or updated state.
 *
 * The original entry is NEVER modified — it stands as historical fact.
 * The correction entry references it and records why interpretation changed.
 */
export type CorrectionRecord = {
  kind: 'correction';
  /** ledger_id of the entry being superseded */
  supersedes_entry_id: string;
  /** Why this correction was necessary */
  supersession_reason: string;
  /** Class of correction */
  correction_type: 'data_error' | 'policy_update' | 'supersession';
  /** Human-readable summary of which fields/conclusions changed */
  corrected_fields_summary: string;
};

// ─── Confidence snapshot record ───────────────────────────────────────────────

/**
 * Ledger payload for a confidence evolution snapshot.
 * Re-exported from the confidence module — defined here for ledger type completeness.
 * Import from runtime/confidence for the full type with all fields.
 */
export type { ConfidenceSnapshotRecord } from '../confidence/types.js';

export type LedgerPayload =
  | DecisionRecord
  | OverrideRecord
  | OutcomeRecord
  | RefusalRecord
  | DeviationRecord
  | TraceAdapterRecord
  | StageReplayRecord
  | StageRejectionRecord
  | CorrectionRecord
  | import('../confidence/types.js').ConfidenceSnapshotRecord
  | import('../replay/types.js').ReplayMaterialRecord
  | import('../replay/types.js').ReplayAttemptedRecord
  | import('../replay/types.js').ReplayVerifiedRecord
  | import('../replay/types.js').ReplayFailedRecord;

// ─── Canonical ledger envelope ────────────────────────────────────────────────

export interface LedgerEntry {
  /** Always '1.0.0' — increment when schema changes incompatibly */
  schema_version: typeof LEDGER_SCHEMA_VERSION;

  /** Unique record ID — crypto.randomUUID() */
  ledger_id: string;

  /** Execution trace root — one per runOrchestrator() invocation */
  trace_id: string;

  /**
   * User request root. Multiple traces may share one request_id
   * (e.g. retries create a new trace under the same request).
   */
  request_id: string;

  session_id?: string;
  tee_id?: string;

  /**
   * Parent record linkage — see parent semantics in module header comment.
   */
  parent_ledger_id?: string;

  /**
   * For correction records: the ledger_id of the entry being superseded.
   * Stored as a column for easy querying by the chain verifier.
   * Must match CorrectionRecord.supersedes_entry_id when payload.kind = 'correction'.
   */
  supersedes_entry_id?: string;

  /**
   * ISO 8601. Mapper-supplied event timestamp; writer fills only if absent.
   * Always reflects when the event occurred, not when it was written.
   */
  timestamp: string;

  stage: LedgerStage;

  /**
   * SQL-queryable projection of payload.kind.
   * Validators enforce strict equality: record_type MUST equal payload.kind.
   * Mismatch is a hard validation error — not silently accepted.
   */
  record_type: LedgerRecordType;

  actor: LedgerActor;
  payload: LedgerPayload;
}
