/**
 * Steering Engine — Types
 *
 * Defines the canonical types for mid-execution checkpoint steering.
 *
 * Design constraints:
 *   - Steering happens only at defined checkpoints, never inside active tool calls
 *   - Actions are strictly typed — no freeform action generation
 *   - Every decision is validated against stage contracts before application
 *   - Steering is deterministic: same context + same policy → same decision
 *
 * Distinction:
 *   Guard  = "may this happen?" (block or allow)
 *   Steer  = "should this be shaped differently?" (modify, redirect, skip, reclassify)
 */

// ─── Checkpoint types ──────────────────────────────────────────────────────────

/**
 * Points in the execution lifecycle where steering may be evaluated.
 * Steering happens at checkpoints only — never inside an active stage.
 */
export type CheckpointType =
  | 'before_stage_transition'
  | 'after_stage_result'
  | 'before_tool_call'
  | 'after_tool_call';

// ─── Steering actions ──────────────────────────────────────────────────────────

/**
 * Typed steering action set.
 * No freeform actions — every action maps to a well-defined execution consequence.
 *
 *   continue              — proceed as planned (no change)
 *   modify_parameters     — adjust allowed parameter values before execution
 *   redirect_action       — execute an approved alternate step instead
 *   insert_step           — inject a required intermediate step before the next one
 *   skip_step             — omit the current step from execution
 *   reclassify_lane       — update the execution lane classification
 *   pause_for_clarification — halt and surface ambiguity for human review
 *   abort_execution       — halt the run immediately (when no safe path exists)
 */
export type SteeringAction =
  | 'continue'
  | 'modify_parameters'
  | 'redirect_action'
  | 'insert_step'
  | 'skip_step'
  | 'reclassify_lane'
  | 'pause_for_clarification'
  | 'abort_execution';

// ─── Steering triggers ────────────────────────────────────────────────────────

/**
 * The class of evidence that caused a steering decision.
 * Must be recorded with every steering decision for audit.
 */
export type SteeringTrigger =
  | 'new_conflict_detected'
  | 'confidence_drop'
  | 'parameter_out_of_bounds'
  | 'better_alternate_available'
  | 'insufficient_evidence_for_step'
  | 'new_required_dependency_found'
  | 'lane_escalation_required'
  | 'tool_result_invalidates_next_step'
  | 'policy_rule_triggered'
  | 'no_trigger';

// ─── Step spec ────────────────────────────────────────────────────────────────

/**
 * Specification for a single execution step.
 * Used in queue management and as part of steering decisions.
 */
export interface StepSpec {
  stage_id: string;
  type: 'stage';
  parameters?: Record<string, unknown>;
  /** true when this step was inserted by steering (not part of original plan) */
  is_inserted?: boolean;
  /** stage_id that this step supersedes, if it was inserted as a replacement */
  superseded_by?: string;
}

// ─── Step history entry ───────────────────────────────────────────────────────

export interface StepHistoryEntry {
  stage_id: string;
  status: 'completed' | 'skipped' | 'aborted';
  steering_applied?: SteeringAction;
}

// ─── Stage steering contract ──────────────────────────────────────────────────

/**
 * Per-stage contract declaring what steering operations are permitted.
 *
 * Design rule: if a stage does not declare a steering contract, treat it as
 * DEFAULT_STEERING_CONTRACT (steering_allowed=false, only continue or abort).
 */
export interface StageSteeringContract {
  /** Whether steering may act on this stage at all */
  steering_allowed: boolean;

  /** Which steering actions are permitted for this stage */
  steering_modes: SteeringAction[];

  /** Parameter names that steering may mutate (for modify_parameters) */
  allowed_parameter_mutations: string[];

  /** Stage IDs that steering may redirect to (for redirect_action) */
  allowed_alternate_actions: string[];

  /** Whether the step may be deferred to a later point in execution */
  can_be_deferred: boolean;

  /** Whether the step may be skipped entirely */
  can_be_skipped: boolean;

  /** Whether a parameter mutation requires explicit re-approval before execution */
  requires_reapproval_on_mutation: boolean;
}

// ─── Steering context ─────────────────────────────────────────────────────────

/**
 * Full context provided to the steering evaluator at each checkpoint.
 * The evaluator must make its decision solely from this context
 * (no external calls, no side effects).
 */
export interface SteeringContext {
  /** Which checkpoint triggered this evaluation */
  checkpoint: CheckpointType;

  /** Pipeline stage being evaluated */
  stage: string;

  /** trace_id of the current orchestrator run */
  run_trace_id: string;

  /** Latest effective confidence score (from ECO stage), if available */
  current_confidence?: number;

  /** Current lane classification, if determined */
  current_lane?: string;

  /** Output of the stage just completed (available at after_stage_result) */
  stage_result?: unknown;

  /** Spec of the step about to execute (available at before_stage_transition) */
  step_spec?: StepSpec;

  /** History of steps executed in this run so far */
  run_history: StepHistoryEntry[];

  /** Number of steering interventions already applied in this run */
  steering_count: number;
}

// ─── Steering decision ────────────────────────────────────────────────────────

/**
 * The steering evaluator's decision at a checkpoint.
 * Must be validated against the stage's StageSteeringContract before application.
 */
export interface SteeringDecision {
  /** What to do */
  action: SteeringAction;

  /** What triggered this decision */
  reason_code: SteeringTrigger;

  /** Human-readable explanation (for audit) */
  rationale: string;

  /** For modify_parameters: the new parameter values (validated against contract) */
  modified_parameters?: Record<string, unknown>;

  /** For redirect_action or insert_step: the alternate/injected step */
  alternate_step?: StepSpec;

  /** For reclassify_lane: the new lane */
  new_lane?: string;

  /** Policy rule IDs that justify this decision */
  policy_refs: string[];

  /** Whether this decision affects confidence posture */
  affects_confidence?: boolean;

  /** Whether this decision affects lane classification */
  affects_lane?: boolean;
}

// ─── Steering evaluator type ──────────────────────────────────────────────────

/**
 * Type of the steering evaluator function injected into the orchestrator.
 * Must be pure — same context always produces same decision.
 */
export type SteeringEvaluator = (context: SteeringContext) => SteeringDecision;

// ─── Ledger record types ──────────────────────────────────────────────────────

/**
 * Written to the ledger at every steering checkpoint evaluation.
 * Records what the steering engine decided, regardless of whether action was applied.
 */
export type SteeringEvaluatedRecord = {
  kind: 'steering_evaluated';
  run_trace_id: string;
  stage_name: string;
  checkpoint: CheckpointType;
  action_selected: SteeringAction;
  reason_code: SteeringTrigger;
  rationale: string;
  policy_refs: string[];
  steering_count: number;
};

/**
 * Written to the ledger when a non-continue steering action is applied.
 * Records the before/after step specs and governance impact.
 */
export type SteeringAppliedRecord = {
  kind: 'steering_applied';
  run_trace_id: string;
  stage_name: string;
  checkpoint: CheckpointType;
  action: SteeringAction;
  reason_code: SteeringTrigger;
  previous_step_spec?: StepSpec;
  new_step_spec?: StepSpec;
  affects_confidence?: boolean;
  affects_lane?: boolean;
};

/**
 * Written to the ledger when a steering action fails contract validation.
 * The steering action is rejected and execution continues as-is.
 */
export type SteeringRejectedRecord = {
  kind: 'steering_rejected';
  run_trace_id: string;
  stage_name: string;
  checkpoint: CheckpointType;
  attempted_action: SteeringAction;
  rejection_reason: string;
};
