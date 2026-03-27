/**
 * Stage Timeout Configuration — Default Budgets and Policies
 *
 * Declarative configuration table for per-stage timeout enforcement.
 * The orchestrator reads this to build per-stage StageTimeoutConfig
 * values via getStageTimeoutConfig().
 *
 * Design rationale per stage:
 *   INTENT_DETECT    — lightweight NLP/regex; 15s is generous, degrade to unknown
 *   ECO_BUILD        — heavy knowledge graph + dimension scoring; 60s budget
 *   SUFFICIENCY_GATE — pure in-memory policy evaluation; 10s max, critical/fail
 *   TEE_BUILD        — constraint compilation; 30s, degrade to empty constraints
 *   CLASSIFY_LANE    — fast policy lookup; 5s, degrade to lane C
 *
 * Invariants (tested):
 *   - ECO_BUILD > CLASSIFY_LANE  (knowledge build > policy eval)
 *   - SUFFICIENCY_GATE < ECO_BUILD  (pure policy, no I/O)
 *   - SUFFICIENCY_GATE is the only critical stage (isCritical=true, onTimeout='fail')
 *   - All other stages use onTimeout='degrade' (pipeline continues)
 */

import type { StageId } from '../pipeline/types.js';
import type { StageTimeoutConfig } from '../pipeline/timeout.js';

// ─── Default timeout budgets (milliseconds) ───────────────────────────────────

export const DEFAULT_STAGE_TIMEOUTS: Record<StageId, number> = Object.freeze({
  INTENT_DETECT:    15_000,   // 15 s — lightweight classification
  ECO_BUILD:        60_000,   // 60 s — full knowledge graph + scoring
  SUFFICIENCY_GATE:  10_000,  // 10 s — in-memory policy evaluation only
  TEE_BUILD:        30_000,   // 30 s — constraint compilation
  CLASSIFY_LANE:     5_000,   //  5 s — fast rule lookup
} as const);

// ─── Timeout policies ─────────────────────────────────────────────────────────

/**
 * Per-stage timeout policy:
 *   'fail'    → timeout blocks the pipeline (critical stages only)
 *   'degrade' → timeout continues pipeline with fallback output
 */
export const STAGE_TIMEOUT_POLICY: Record<StageId, 'fail' | 'degrade'> = Object.freeze({
  INTENT_DETECT:    'degrade',
  ECO_BUILD:        'degrade',
  SUFFICIENCY_GATE: 'fail',
  TEE_BUILD:        'degrade',
  CLASSIFY_LANE:    'degrade',
} as const);

/**
 * Whether a stage is critical (timeout → pipeline halted).
 * Only SUFFICIENCY_GATE is critical: a gate verdict cannot be safely
 * approximated by a fallback — the pipeline must halt and report the failure.
 */
export const STAGE_IS_CRITICAL: Record<StageId, boolean> = Object.freeze({
  INTENT_DETECT:    false,
  ECO_BUILD:        false,
  SUFFICIENCY_GATE: true,
  TEE_BUILD:        false,
  CLASSIFY_LANE:    false,
} as const);

// ─── Config factory ───────────────────────────────────────────────────────────

/**
 * Build a StageTimeoutConfig for a given stage, applying any caller-supplied
 * timeout override for that stage.
 *
 * @param stageId   - the stage to build config for
 * @param overrides - optional map of stage → timeoutMs overrides (e.g. from
 *                    OrchestratorInput.stageTimeoutOverrides)
 */
export function getStageTimeoutConfig(
  stageId: StageId,
  overrides?: Partial<Record<StageId, number>>,
): StageTimeoutConfig {
  return {
    stageId,
    timeoutMs:  overrides?.[stageId] ?? DEFAULT_STAGE_TIMEOUTS[stageId],
    onTimeout:  STAGE_TIMEOUT_POLICY[stageId],
    isCritical: STAGE_IS_CRITICAL[stageId],
  };
}
