/**
 * Steering Engine — Stage Contracts
 *
 * Declares what steering operations are permitted for each pipeline stage.
 *
 * Design constraints:
 *   - Each stage declares which steering actions are allowed (steering_modes)
 *   - Only explicitly listed parameter names may be mutated (allowed_parameter_mutations)
 *   - Only explicitly listed stage IDs may be redirected to (allowed_alternate_actions)
 *   - Unknown stages use DEFAULT_STEERING_CONTRACT (steering_allowed=false)
 *
 * Release rule:
 *   If a stage is not in this table, treat it as DEFAULT_STEERING_CONTRACT:
 *   only 'continue' or 'abort_execution' are allowed, no parameter mutations.
 */

import type { StageSteeringContract } from './types.js';

/**
 * Default contract for stages not listed in STAGE_STEERING_CONTRACTS.
 * Non-steerable: only continue or hard abort allowed.
 */
export const DEFAULT_STEERING_CONTRACT: StageSteeringContract = {
  steering_allowed: false,
  steering_modes: ['continue', 'abort_execution'],
  allowed_parameter_mutations: [],
  allowed_alternate_actions: [],
  can_be_deferred: false,
  can_be_skipped: false,
  requires_reapproval_on_mutation: true,
};

/**
 * Per-stage steering contracts for the canonical pipeline stages.
 *
 * INTENT_DETECT: intent is foundational — cannot skip or mutate parameters.
 *   Only clarification or abort as steering responses.
 *
 * ECO_BUILD: ECO is the confidence source — cannot skip.
 *   Pause or abort when evidence is unavailable.
 *
 * SUFFICIENCY_GATE: the gate verdict can be lane-reclassified by steering.
 *   Skippable with policy approval (e.g., re-run scenarios).
 *
 * TEE_BUILD: tool execution envelope — parameters (scope/depth) may be narrowed.
 *   Skippable in deferred execution scenarios.
 *
 * CLASSIFY_LANE: lane decision may be overridden by steering via reclassify_lane.
 *   Cannot be skipped — terminal lane assignment is required.
 */
export const STAGE_STEERING_CONTRACTS: Record<string, StageSteeringContract> = {
  INTENT_DETECT: {
    steering_allowed: true,
    steering_modes: ['continue', 'pause_for_clarification', 'abort_execution'],
    allowed_parameter_mutations: [],
    allowed_alternate_actions: [],
    can_be_deferred: false,
    can_be_skipped: false,
    requires_reapproval_on_mutation: true,
  },

  ECO_BUILD: {
    steering_allowed: true,
    steering_modes: ['continue', 'pause_for_clarification', 'abort_execution'],
    allowed_parameter_mutations: [],
    allowed_alternate_actions: [],
    can_be_deferred: false,
    can_be_skipped: false,
    requires_reapproval_on_mutation: true,
  },

  SUFFICIENCY_GATE: {
    steering_allowed: true,
    steering_modes: ['continue', 'skip_step', 'reclassify_lane', 'pause_for_clarification', 'abort_execution'],
    allowed_parameter_mutations: ['behavior'],
    allowed_alternate_actions: [],
    can_be_deferred: false,
    can_be_skipped: true,
    requires_reapproval_on_mutation: true,
  },

  TEE_BUILD: {
    steering_allowed: true,
    steering_modes: ['continue', 'skip_step', 'modify_parameters', 'redirect_action', 'pause_for_clarification', 'abort_execution'],
    allowed_parameter_mutations: ['scope', 'depth'],
    allowed_alternate_actions: [],
    can_be_deferred: true,
    can_be_skipped: true,
    requires_reapproval_on_mutation: false,
  },

  CLASSIFY_LANE: {
    steering_allowed: true,
    steering_modes: ['continue', 'skip_step', 'reclassify_lane', 'pause_for_clarification', 'abort_execution'],
    allowed_parameter_mutations: [],
    allowed_alternate_actions: [],
    can_be_deferred: false,
    can_be_skipped: true,
    requires_reapproval_on_mutation: true,
  },
};
