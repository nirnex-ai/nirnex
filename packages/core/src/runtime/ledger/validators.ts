/**
 * Runtime Ledger — Validators
 *
 * Runtime validation for LedgerEntry envelopes and each record family.
 * All validators return ValidationResult — they never throw.
 *
 * Key invariant:
 *   payload.kind MUST equal record_type.
 *   This is enforced as a hard validation error (not a warning).
 *   `record_type` is the SQL-queryable projection of `payload.kind`.
 *   Mismatch indicates a mapper bug and creates internally inconsistent records.
 *
 * Design constraints:
 *   - No external deps — pure TypeScript
 *   - Validators accumulate all errors (not fail-fast)
 *   - Unknown optional fields in payload are allowed (forward-compatible)
 */

import { LEDGER_SCHEMA_VERSION } from './types.js';
import type { LedgerStage, LedgerRecordType } from './types.js';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Known enum values ────────────────────────────────────────────────────────

const VALID_STAGES: Set<string> = new Set<LedgerStage>([
  'knowledge', 'eco', 'classification', 'strategy',
  'pre_tool_guard', 'implementation', 'validation',
  'post_tool_trace', 'stop', 'override', 'outcome', 'execution', 'confidence', 'replay', 'analysis', 'steering',
]);

const VALID_RECORD_TYPES: Set<string> = new Set<LedgerRecordType>([
  'decision', 'trace', 'override', 'outcome', 'refusal', 'deviation',
  'stage_replay', 'stage_rejection', 'correction', 'confidence_snapshot',
  'replay_material', 'replay_attempted', 'replay_verified', 'replay_failed',
  'run_outcome_summary', 'regression_report',
  'steering_evaluated', 'steering_applied', 'steering_rejected',
]);

const VALID_ACTORS = new Set(['system', 'analyst', 'human']);

// ─── Envelope validator ───────────────────────────────────────────────────────

/**
 * Validate a LedgerEntry envelope.
 *
 * Checks:
 * 1. Required fields present and non-empty
 * 2. schema_version === '1.0.0'
 * 3. stage ∈ LedgerStage
 * 4. record_type ∈ LedgerRecordType
 * 5. actor ∈ LedgerActor
 * 6. payload.kind === record_type (hard invariant)
 * 7. Payload-specific structural validation
 */
export function validateLedgerEntry(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (entry === null || typeof entry !== 'object') {
    return { valid: false, errors: ['entry must be a non-null object'] };
  }

  const e = entry as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ['schema_version', 'ledger_id', 'trace_id', 'request_id', 'stage', 'record_type', 'actor'];
  for (const field of requiredStrings) {
    if (!e[field] || typeof e[field] !== 'string') {
      errors.push(`missing or invalid required field: ${field}`);
    }
  }

  // payload required (any truthy value)
  if (e.payload === undefined || e.payload === null) {
    errors.push('missing required field: payload');
  }

  // Early exit — can't do further checks without the core fields
  if (errors.length > 0) return { valid: false, errors };

  // schema_version check
  if (e.schema_version !== LEDGER_SCHEMA_VERSION) {
    errors.push(`schema_version must be '${LEDGER_SCHEMA_VERSION}', got '${e.schema_version}'`);
  }

  // stage enum
  if (!VALID_STAGES.has(e.stage as string)) {
    errors.push(`unknown stage: '${e.stage}'. Valid stages: ${[...VALID_STAGES].join(', ')}`);
  }

  // record_type enum
  if (!VALID_RECORD_TYPES.has(e.record_type as string)) {
    errors.push(`unknown record_type: '${e.record_type}'. Valid types: ${[...VALID_RECORD_TYPES].join(', ')}`);
  }

  // actor enum
  if (!VALID_ACTORS.has(e.actor as string)) {
    errors.push(`unknown actor: '${e.actor}'. Valid actors: system, analyst, human`);
  }

  // kind ↔ record_type invariant — HARD check
  if (e.payload && typeof e.payload === 'object') {
    const payload = e.payload as Record<string, unknown>;
    if (payload.kind !== e.record_type) {
      errors.push(
        `kind/record_type mismatch: payload.kind='${payload.kind}' but record_type='${e.record_type}'. ` +
        `record_type must equal payload.kind.`
      );
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  // Payload structural validation
  const payloadResult = validatePayload(e.record_type as string, e.payload);
  if (!payloadResult.valid) {
    errors.push(...payloadResult.errors.map(err => `payload: ${err}`));
  }

  return { valid: errors.length === 0, errors };
}

// ─── Payload dispatcher ───────────────────────────────────────────────────────

export function validatePayload(recordType: string, payload: unknown): ValidationResult {
  switch (recordType) {
    case 'decision':  return validateDecisionRecord(payload);
    case 'override':  return validateOverrideRecord(payload);
    case 'outcome':   return validateOutcomeRecord(payload);
    case 'refusal':   return validateRefusalRecord(payload);
    case 'deviation': return validateDeviationRecord(payload);
    case 'trace':           return validateTraceAdapterRecord(payload);
    case 'stage_replay':    return validateStageReplayRecord(payload);
    case 'stage_rejection': return validateStageRejectionRecord(payload);
    case 'correction':          return validateCorrectionRecord(payload);
    case 'confidence_snapshot': return validateConfidenceSnapshotRecord(payload);
    case 'replay_material':     return validateReplayMaterialRecord(payload);
    case 'replay_attempted':    return validateReplayAttemptedRecord(payload);
    case 'replay_verified':     return validateReplayVerifiedRecord(payload);
    case 'replay_failed':         return validateReplayFailedRecord(payload);
    case 'run_outcome_summary':   return validateRunOutcomeSummaryRecord(payload);
    case 'regression_report':     return validateRegressionReportRecord(payload);
    case 'steering_evaluated':    return validateSteeringEvaluatedRecord(payload);
    case 'steering_applied':      return validateSteeringAppliedRecord(payload);
    case 'steering_rejected':     return validateSteeringRejectedRecord(payload);
    default:
      return { valid: false, errors: [`unknown record_type for payload validation: '${recordType}'`] };
  }
}

// ─── Per-kind validators ──────────────────────────────────────────────────────

const VALID_DECISION_STATUSES = new Set(['pass', 'warn', 'escalate', 'block', 'refuse']);

export function validateDecisionRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.decision_name || typeof r.decision_name !== 'string') {
    errors.push('missing or invalid: decision_name');
  }
  if (!r.decision_code || typeof r.decision_code !== 'string') {
    errors.push('missing or invalid: decision_code');
  }
  if (r.input_refs === undefined || typeof r.input_refs !== 'object') {
    errors.push('missing or invalid: input_refs');
  }
  if (!r.result || typeof r.result !== 'object') {
    errors.push('missing or invalid: result');
  } else {
    const res = r.result as Record<string, unknown>;
    if (!res.status || !VALID_DECISION_STATUSES.has(res.status as string)) {
      errors.push(`invalid result.status: '${res.status}'. Valid: ${[...VALID_DECISION_STATUSES].join(', ')}`);
    }
  }
  if (!r.rationale || typeof r.rationale !== 'object') {
    errors.push('missing or invalid: rationale');
  } else {
    const rat = r.rationale as Record<string, unknown>;
    if (typeof rat.summary !== 'string') errors.push('rationale.summary must be a string');
    if (!Array.isArray(rat.rule_refs))   errors.push('rationale.rule_refs must be an array');
  }

  return { valid: errors.length === 0, errors };
}

const VALID_EFFECTS = new Set(['allow', 'force_lane', 'bypass_guard', 'accept_deviation']);
const VALID_APPROVED_BY = new Set(['human', 'analyst']);

export function validateOverrideRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.override_id || typeof r.override_id !== 'string') errors.push('missing or invalid: override_id');
  if (!r.target_stage || typeof r.target_stage !== 'string') errors.push('missing or invalid: target_stage');
  if (!r.scope || typeof r.scope !== 'object')              errors.push('missing or invalid: scope');
  if (!r.reason || typeof r.reason !== 'string')            errors.push('missing or invalid: reason');
  if (!r.approved_by || !VALID_APPROVED_BY.has(r.approved_by as string)) {
    errors.push(`invalid approved_by: '${r.approved_by}'. Valid: human, analyst`);
  }
  if (!r.effect || !VALID_EFFECTS.has(r.effect as string)) {
    errors.push(`invalid effect: '${r.effect}'. Valid: ${[...VALID_EFFECTS].join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

const VALID_COMPLETION_STATES = new Set(['merged', 'escalated', 'abandoned', 'refused']);

export function validateOutcomeRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.completion_state || !VALID_COMPLETION_STATES.has(r.completion_state as string)) {
    errors.push(`invalid completion_state: '${r.completion_state}'. Valid: ${[...VALID_COMPLETION_STATES].join(', ')}`);
  }
  if (!r.final_disposition_reason || typeof r.final_disposition_reason !== 'string') {
    errors.push('missing or invalid: final_disposition_reason');
  }

  return { valid: errors.length === 0, errors };
}

export function validateRefusalRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.refusal_code || typeof r.refusal_code !== 'string') errors.push('missing or invalid: refusal_code');
  if (!r.refusal_reason || typeof r.refusal_reason !== 'string') errors.push('missing or invalid: refusal_reason');

  return { valid: errors.length === 0, errors };
}

const VALID_DEVIATION_SEVERITIES = new Set(['low', 'medium', 'high']);
const VALID_DISPOSITIONS = new Set(['logged', 'escalated', 'overridden', 'abandoned']);

export function validateDeviationRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.detected_at_stage || typeof r.detected_at_stage !== 'string') errors.push('missing or invalid: detected_at_stage');
  if (!r.observed_summary || typeof r.observed_summary !== 'string')   errors.push('missing or invalid: observed_summary');
  if (!r.severity || !VALID_DEVIATION_SEVERITIES.has(r.severity as string)) {
    errors.push(`invalid severity: '${r.severity}'. Valid: low, medium, high`);
  }
  if (!r.disposition || !VALID_DISPOSITIONS.has(r.disposition as string)) {
    errors.push(`invalid disposition: '${r.disposition}'. Valid: ${[...VALID_DISPOSITIONS].join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

function validateTraceAdapterRecord(p: unknown): ValidationResult {
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;
  if (r.raw === undefined) return { valid: false, errors: ['trace adapter record must have a raw field'] };
  return { valid: true, errors: [] };
}

export function validateStageReplayRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.stage_id || typeof r.stage_id !== 'string') errors.push('missing or invalid: stage_id');
  if (!r.replay_of_execution_key || typeof r.replay_of_execution_key !== 'string') {
    errors.push('missing or invalid: replay_of_execution_key');
  }
  if (!r.original_trace_id || typeof r.original_trace_id !== 'string') {
    errors.push('missing or invalid: original_trace_id');
  }

  return { valid: errors.length === 0, errors };
}

const VALID_CORRECTION_TYPES = new Set(['data_error', 'policy_update', 'supersession']);

export function validateCorrectionRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.supersedes_entry_id || typeof r.supersedes_entry_id !== 'string') {
    errors.push('missing or invalid: supersedes_entry_id');
  }
  if (!r.supersession_reason || typeof r.supersession_reason !== 'string') {
    errors.push('missing or invalid: supersession_reason');
  }
  if (!r.correction_type || !VALID_CORRECTION_TYPES.has(r.correction_type as string)) {
    errors.push(`invalid correction_type: '${r.correction_type}'. Valid: ${[...VALID_CORRECTION_TYPES].join(', ')}`);
  }
  if (!r.corrected_fields_summary || typeof r.corrected_fields_summary !== 'string') {
    errors.push('missing or invalid: corrected_fields_summary');
  }

  return { valid: errors.length === 0, errors };
}

export function validateStageRejectionRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.stage_id || typeof r.stage_id !== 'string') errors.push('missing or invalid: stage_id');
  if (!r.execution_key || typeof r.execution_key !== 'string') errors.push('missing or invalid: execution_key');
  if (!r.rejection_reason || typeof r.rejection_reason !== 'string') errors.push('missing or invalid: rejection_reason');

  return { valid: errors.length === 0, errors };
}

const VALID_CONFIDENCE_BANDS = new Set([
  'high', 'moderate', 'low', 'very_low', 'forced_unknown', 'blocked',
]);

const VALID_TRIGGER_TYPES = new Set([
  'eco_initialized', 'evidence_gate_evaluated', 'conflict_penalty_applied',
  'dimension_scored', 'lane_classified', 'lane_escalated',
  'override_acknowledged', 'final_outcome_sealed',
]);

export function validateConfidenceSnapshotRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (typeof r.snapshot_index !== 'number' || r.snapshot_index < 1) {
    errors.push('missing or invalid: snapshot_index (must be a positive number)');
  }
  if (!r.confidence_model_version || typeof r.confidence_model_version !== 'string') {
    errors.push('missing or invalid: confidence_model_version');
  }
  if (typeof r.computed_confidence !== 'number') {
    errors.push('missing or invalid: computed_confidence (must be a number)');
  }
  if (typeof r.effective_confidence !== 'number') {
    errors.push('missing or invalid: effective_confidence (must be a number)');
  }
  if (!r.confidence_band || !VALID_CONFIDENCE_BANDS.has(r.confidence_band as string)) {
    errors.push(
      `invalid confidence_band: '${r.confidence_band}'. Valid: ${[...VALID_CONFIDENCE_BANDS].join(', ')}`,
    );
  }
  if (!r.stage_name || typeof r.stage_name !== 'string') {
    errors.push('missing or invalid: stage_name');
  }
  if (!r.trigger_type || !VALID_TRIGGER_TYPES.has(r.trigger_type as string)) {
    errors.push(
      `invalid trigger_type: '${r.trigger_type}'. Valid: ${[...VALID_TRIGGER_TYPES].join(', ')}`,
    );
  }
  if (!r.dimensions || typeof r.dimensions !== 'object') {
    errors.push('missing or invalid: dimensions (must be an object)');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Replay record validators ─────────────────────────────────────────────────

const VALID_REPLAYABILITY_STATUSES = new Set([
  'replayable', 'conditionally_replayable', 'non_replayable',
]);

const VALID_EXECUTION_MODES = new Set(['live', 'replay', 're_run']);

function validateReplayMaterialRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.stage_id || typeof r.stage_id !== 'string') errors.push('missing or invalid: stage_id');
  if (!r.execution_mode || !VALID_EXECUTION_MODES.has(r.execution_mode as string)) {
    errors.push(`invalid execution_mode: '${r.execution_mode}'. Valid: ${[...VALID_EXECUTION_MODES].join(', ')}`);
  }
  if (!r.input_hash || typeof r.input_hash !== 'string') errors.push('missing or invalid: input_hash');
  if (!r.output_hash || typeof r.output_hash !== 'string') errors.push('missing or invalid: output_hash');
  if (r.normalized_input === undefined) errors.push('missing: normalized_input');
  if (r.normalized_output === undefined) errors.push('missing: normalized_output');
  if (!r.replayability_status || !VALID_REPLAYABILITY_STATUSES.has(r.replayability_status as string)) {
    errors.push(`invalid replayability_status: '${r.replayability_status}'. Valid: ${[...VALID_REPLAYABILITY_STATUSES].join(', ')}`);
  }
  if (typeof r.dependency_sequence_index !== 'number') {
    errors.push('missing or invalid: dependency_sequence_index (must be a number)');
  }

  return { valid: errors.length === 0, errors };
}

function validateReplayAttemptedRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') errors.push('missing or invalid: run_trace_id');
  if (r.execution_mode !== 'replay') errors.push(`execution_mode must be 'replay', got '${r.execution_mode}'`);
  if (!Array.isArray(r.stages_requested)) errors.push('missing or invalid: stages_requested (must be an array)');

  return { valid: errors.length === 0, errors };
}

function validateReplayVerifiedRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') errors.push('missing or invalid: run_trace_id');
  if (!Array.isArray(r.stages_verified)) errors.push('missing or invalid: stages_verified (must be an array)');
  if (typeof r.verified_count !== 'number') errors.push('missing or invalid: verified_count (must be a number)');

  return { valid: errors.length === 0, errors };
}

function validateReplayFailedRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') errors.push('missing or invalid: run_trace_id');
  if (!r.failure_reason || typeof r.failure_reason !== 'string') errors.push('missing or invalid: failure_reason');

  return { valid: errors.length === 0, errors };
}

// ─── Regression record validators ─────────────────────────────────────────────

const VALID_COMPLETION_STATES_SUMMARY = new Set(['merged', 'escalated', 'abandoned', 'refused']);
const VALID_SUMMARY_LANES = new Set(['A', 'B', 'C']);

export function validateRunOutcomeSummaryRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.summarized_trace_id || typeof r.summarized_trace_id !== 'string') {
    errors.push('missing or invalid: summarized_trace_id');
  }
  if (!r.completion_state || !VALID_COMPLETION_STATES_SUMMARY.has(r.completion_state as string)) {
    errors.push(
      `invalid completion_state: '${r.completion_state}'. Valid: ${[...VALID_COMPLETION_STATES_SUMMARY].join(', ')}`,
    );
  }
  // final_lane may be null or a valid lane
  if (r.final_lane !== null && r.final_lane !== undefined && !VALID_SUMMARY_LANES.has(r.final_lane as string)) {
    errors.push(`invalid final_lane: '${r.final_lane}'. Valid: A, B, C, or null`);
  }
  if (typeof r.had_refusal !== 'boolean')           errors.push('missing or invalid: had_refusal (must be boolean)');
  if (typeof r.had_override !== 'boolean')          errors.push('missing or invalid: had_override (must be boolean)');
  if (typeof r.forced_unknown_applied !== 'boolean') errors.push('missing or invalid: forced_unknown_applied (must be boolean)');
  if (typeof r.evidence_gate_failed !== 'boolean')  errors.push('missing or invalid: evidence_gate_failed (must be boolean)');
  if (typeof r.stages_completed !== 'number')       errors.push('missing or invalid: stages_completed (must be a number)');
  if (!r.run_timestamp || typeof r.run_timestamp !== 'string') {
    errors.push('missing or invalid: run_timestamp');
  }

  return { valid: errors.length === 0, errors };
}

const VALID_OVERALL_SEVERITIES = new Set(['none', 'warn', 'escalate']);

export function validateRegressionReportRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.baseline_window || typeof r.baseline_window !== 'object') {
    errors.push('missing or invalid: baseline_window');
  }
  if (!r.current_window || typeof r.current_window !== 'object') {
    errors.push('missing or invalid: current_window');
  }
  if (typeof r.baseline_run_count !== 'number') errors.push('missing or invalid: baseline_run_count (must be a number)');
  if (typeof r.current_run_count !== 'number')  errors.push('missing or invalid: current_run_count (must be a number)');
  if (!r.baseline_metrics || typeof r.baseline_metrics !== 'object') {
    errors.push('missing or invalid: baseline_metrics');
  }
  if (!r.current_metrics || typeof r.current_metrics !== 'object') {
    errors.push('missing or invalid: current_metrics');
  }
  if (!Array.isArray(r.findings)) errors.push('missing or invalid: findings (must be an array)');
  if (!r.overall_severity || !VALID_OVERALL_SEVERITIES.has(r.overall_severity as string)) {
    errors.push(`invalid overall_severity: '${r.overall_severity}'. Valid: none, warn, escalate`);
  }
  if (!r.generated_at || typeof r.generated_at !== 'string') {
    errors.push('missing or invalid: generated_at');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Steering record validators ───────────────────────────────────────────────

const VALID_STEERING_ACTIONS = new Set([
  'continue', 'modify_parameters', 'redirect_action', 'insert_step',
  'skip_step', 'reclassify_lane', 'pause_for_clarification', 'abort_execution',
]);

const VALID_STEERING_CHECKPOINTS = new Set([
  'before_stage_transition', 'after_stage_result', 'before_tool_call', 'after_tool_call',
]);

export function validateSteeringEvaluatedRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') {
    errors.push('missing or invalid: run_trace_id');
  }
  if (!r.stage_name || typeof r.stage_name !== 'string') {
    errors.push('missing or invalid: stage_name');
  }
  if (!r.checkpoint || !VALID_STEERING_CHECKPOINTS.has(r.checkpoint as string)) {
    errors.push(`invalid checkpoint: '${r.checkpoint}'. Valid: ${[...VALID_STEERING_CHECKPOINTS].join(', ')}`);
  }
  if (!r.action_selected || !VALID_STEERING_ACTIONS.has(r.action_selected as string)) {
    errors.push(`invalid action_selected: '${r.action_selected}'. Valid: ${[...VALID_STEERING_ACTIONS].join(', ')}`);
  }
  if (!r.reason_code || typeof r.reason_code !== 'string') {
    errors.push('missing or invalid: reason_code');
  }
  if (typeof r.rationale !== 'string') {
    errors.push('missing or invalid: rationale');
  }
  if (!Array.isArray(r.policy_refs)) {
    errors.push('missing or invalid: policy_refs (must be an array)');
  }
  if (typeof r.steering_count !== 'number') {
    errors.push('missing or invalid: steering_count (must be a number)');
  }

  return { valid: errors.length === 0, errors };
}

export function validateSteeringAppliedRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') {
    errors.push('missing or invalid: run_trace_id');
  }
  if (!r.stage_name || typeof r.stage_name !== 'string') {
    errors.push('missing or invalid: stage_name');
  }
  if (!r.checkpoint || !VALID_STEERING_CHECKPOINTS.has(r.checkpoint as string)) {
    errors.push(`invalid checkpoint: '${r.checkpoint}'. Valid: ${[...VALID_STEERING_CHECKPOINTS].join(', ')}`);
  }
  if (!r.action || !VALID_STEERING_ACTIONS.has(r.action as string)) {
    errors.push(`invalid action: '${r.action}'. Valid: ${[...VALID_STEERING_ACTIONS].join(', ')}`);
  }
  if (!r.reason_code || typeof r.reason_code !== 'string') {
    errors.push('missing or invalid: reason_code');
  }

  return { valid: errors.length === 0, errors };
}

export function validateSteeringRejectedRecord(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') {
    errors.push('missing or invalid: run_trace_id');
  }
  if (!r.stage_name || typeof r.stage_name !== 'string') {
    errors.push('missing or invalid: stage_name');
  }
  if (!r.checkpoint || !VALID_STEERING_CHECKPOINTS.has(r.checkpoint as string)) {
    errors.push(`invalid checkpoint: '${r.checkpoint}'. Valid: ${[...VALID_STEERING_CHECKPOINTS].join(', ')}`);
  }
  if (!r.attempted_action || !VALID_STEERING_ACTIONS.has(r.attempted_action as string)) {
    errors.push(`invalid attempted_action: '${r.attempted_action}'. Valid: ${[...VALID_STEERING_ACTIONS].join(', ')}`);
  }
  if (!r.rejection_reason || typeof r.rejection_reason !== 'string') {
    errors.push('missing or invalid: rejection_reason');
  }

  return { valid: errors.length === 0, errors };
}
