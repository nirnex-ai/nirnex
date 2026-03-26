/**
 * Failure Policy — Stage failure semantics
 *
 * Maps each StageId to its failure mode, and provides applyFailureMode
 * to build a StageResult when a stage fails.
 *
 * Design constraints:
 *   - FAILURE_POLICY is a sealed, immutable record
 *   - applyFailureMode is a pure function — no side effects
 *   - BLOCK returns no output (pipeline halts)
 *   - ESCALATE + DEGRADE return fallback output so pipeline can continue
 */

import type { StageId, FailureMode, StageResult, BoundTrace } from "./types.js";
import { bindTrace } from "./trace-binder.js";

// ─── Stage failure mode policy ────────────────────────────────────────────────

/**
 * Canonical failure mode per stage.
 * Immutable — stages must not override this at runtime.
 */
export const FAILURE_POLICY: Record<StageId, FailureMode> = Object.freeze({
  INTENT_DETECT:    "DEGRADE",
  ECO_BUILD:        "ESCALATE",
  SUFFICIENCY_GATE: "BLOCK",
  TEE_BUILD:        "DEGRADE",
  CLASSIFY_LANE:    "ESCALATE",
} as const);

// ─── Default fallback outputs per stage ───────────────────────────────────────

const FALLBACK_OUTPUTS: Record<StageId, unknown> = {
  INTENT_DETECT: { primary: "unknown", composite: false },
  ECO_BUILD: {
    intent: { primary: "unknown", composite: false },
    eco_dimensions: {
      coverage:  { severity: "pass", detail: "" },
      freshness: { severity: "pass", detail: "" },
      mapping:   { severity: "pass", detail: "" },
      conflict:  { severity: "pass", detail: "", conflict_payload: null },
      graph:     { severity: "pass", detail: "" },
    },
    confidence_score: 0,
  },
  SUFFICIENCY_GATE: undefined, // BLOCK — no fallback needed
  TEE_BUILD: {
    blocked_paths: [],
    blocked_symbols: [],
    clarification_questions: [],
    proceed_warnings: ["TEE_BUILD failed — degraded mode"],
  },
  CLASSIFY_LANE: { lane: "C", set_by: "P1", reason: "CLASSIFY_LANE failed — escalated to C" },
};

// ─── applyFailureMode ─────────────────────────────────────────────────────────

/**
 * Build a StageResult for a failed stage according to its failure policy.
 *
 * @param mode     - failure mode to apply (overrides FAILURE_POLICY when provided externally)
 * @param stage    - which stage failed
 * @param error    - the caught error
 * @param fallback - optional caller-supplied fallback; uses default when omitted
 */
export function applyFailureMode(
  mode: FailureMode,
  stage: StageId,
  error: Error,
  fallback?: unknown,
): StageResult {
  const output = fallback !== undefined ? fallback : FALLBACK_OUTPUTS[stage];

  const status: StageResult["status"] =
    mode === "BLOCK"    ? "blocked"  :
    mode === "ESCALATE" ? "escalated" :
    /* DEGRADE */         "degraded";

  const trace = bindTrace(stage, undefined, output, status, error);

  return {
    stage,
    status,
    output: mode === "BLOCK" ? undefined : output,
    error,
    trace,
  };
}
