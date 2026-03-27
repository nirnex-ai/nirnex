/**
 * Regression Detection — Outcome Summary Builder
 *
 * Constructs a normalized RunOutcomeSummaryRecord from an OrchestratorResult.
 * Called by the orchestrator at run completion (when enableOutcomeSummary=true).
 *
 * Design constraints:
 *   - Pure function — no I/O, no side effects
 *   - Derives completion_state from OrchestratorResult fields (priority: blocked > escalated > completed)
 *   - final_confidence comes from optional context (ECO stage output)
 *   - had_refusal is derived from completion_state, not from a separate flag
 */

import type { OrchestratorResult } from '../../pipeline/orchestrator.js';
import type { RunOutcomeSummaryRecord } from './types.js';

// ─── Context for summary construction ────────────────────────────────────────

export interface RunSummaryContext {
  /** trace_id of the orchestrator run being summarized */
  traceId: string;

  /** Final effective confidence score from ECO stage, if available */
  finalConfidence?: number | null;

  /** Whether forced_unknown was applied during evidence gate evaluation */
  forcedUnknownApplied?: boolean;

  /** Whether the evidence gate failed (behavior !== 'pass') */
  evidenceGateFailed?: boolean;

  /** Whether any override was applied during this run */
  hadOverride?: boolean;
}

// ─── buildRunOutcomeSummary ───────────────────────────────────────────────────

/**
 * Build a normalized RunOutcomeSummaryRecord from a completed OrchestratorResult.
 *
 * completion_state derivation (priority order):
 *   blocked      → 'refused'
 *   escalated    → 'escalated'
 *   completed    → 'merged'
 *   otherwise    → 'abandoned'
 */
export function buildRunOutcomeSummary(
  result: OrchestratorResult,
  context: RunSummaryContext,
): RunOutcomeSummaryRecord {
  let completion_state: RunOutcomeSummaryRecord['completion_state'];

  if (result.blocked) {
    completion_state = 'refused';
  } else if (result.escalated) {
    completion_state = 'escalated';
  } else if (result.completed) {
    completion_state = 'merged';
  } else {
    completion_state = 'abandoned';
  }

  const final_lane = (result.finalLane as 'A' | 'B' | 'C' | undefined) ?? null;

  const stages_completed = result.stageResults.filter(r => r.status === 'ok').length;

  return {
    kind:                   'run_outcome_summary',
    summarized_trace_id:    context.traceId,
    completion_state,
    final_lane,
    final_confidence:       context.finalConfidence ?? null,
    had_refusal:            completion_state === 'refused',
    had_override:           context.hadOverride ?? false,
    forced_unknown_applied: context.forcedUnknownApplied ?? false,
    evidence_gate_failed:   context.evidenceGateFailed ?? false,
    stages_completed,
    run_timestamp:          new Date().toISOString(),
  };
}
