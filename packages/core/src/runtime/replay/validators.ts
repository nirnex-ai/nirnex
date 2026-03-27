/**
 * Replay Engine — Validators
 *
 * Runtime validators for replay record families.
 * All return ValidationResult — never throw.
 */

import type { ValidationResult } from '../ledger/validators.js';

const VALID_REPLAYABILITY_STATUSES = new Set([
  'replayable', 'conditionally_replayable', 'non_replayable',
]);

const VALID_EXECUTION_MODES = new Set(['live', 'replay', 're_run']);

export function validateReplayMaterial(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.stage_id || typeof r.stage_id !== 'string') {
    errors.push('missing or invalid: stage_id');
  }
  if (!r.execution_mode || !VALID_EXECUTION_MODES.has(r.execution_mode as string)) {
    errors.push(`invalid execution_mode: '${r.execution_mode}'. Valid: ${[...VALID_EXECUTION_MODES].join(', ')}`);
  }
  if (!r.input_hash || typeof r.input_hash !== 'string') {
    errors.push('missing or invalid: input_hash');
  }
  if (!r.output_hash || typeof r.output_hash !== 'string') {
    errors.push('missing or invalid: output_hash');
  }
  if (r.normalized_input === undefined) {
    errors.push('missing: normalized_input');
  }
  if (r.normalized_output === undefined) {
    errors.push('missing: normalized_output');
  }
  if (!r.replayability_status || !VALID_REPLAYABILITY_STATUSES.has(r.replayability_status as string)) {
    errors.push(
      `invalid replayability_status: '${r.replayability_status}'. Valid: ${[...VALID_REPLAYABILITY_STATUSES].join(', ')}`,
    );
  }
  if (typeof r.dependency_sequence_index !== 'number') {
    errors.push('missing or invalid: dependency_sequence_index (must be a number)');
  }

  return { valid: errors.length === 0, errors };
}

export function validateReplayAttempted(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') errors.push('missing or invalid: run_trace_id');
  if (r.execution_mode !== 'replay') errors.push(`execution_mode must be 'replay', got '${r.execution_mode}'`);
  if (!Array.isArray(r.stages_requested)) errors.push('missing or invalid: stages_requested (must be an array)');

  return { valid: errors.length === 0, errors };
}

export function validateReplayVerified(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') errors.push('missing or invalid: run_trace_id');
  if (!Array.isArray(r.stages_verified)) errors.push('missing or invalid: stages_verified (must be an array)');
  if (typeof r.verified_count !== 'number') errors.push('missing or invalid: verified_count (must be a number)');

  return { valid: errors.length === 0, errors };
}

export function validateReplayFailed(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['payload must be an object'] };
  const r = p as Record<string, unknown>;

  if (!r.run_trace_id || typeof r.run_trace_id !== 'string') errors.push('missing or invalid: run_trace_id');
  if (!r.failure_reason || typeof r.failure_reason !== 'string') errors.push('missing or invalid: failure_reason');

  return { valid: errors.length === 0, errors };
}
