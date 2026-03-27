/**
 * Steering Engine — Action Validation
 *
 * Validates a SteeringDecision against a stage's StageSteeringContract
 * before the decision is applied to the execution queue.
 *
 * Design constraints:
 *   - 'continue' and 'abort_execution' are always validated (never silently accepted
 *     for non-steerable stages — abort_execution is still allowed there)
 *   - Unknown stages use DEFAULT_STEERING_CONTRACT (only continue/abort)
 *   - Validation is synchronous and pure — no I/O
 *   - Rejected actions are logged to the Decision Ledger as steering_rejected
 */

import type { SteeringDecision, StageSteeringContract } from './types.js';

// ─── ActionValidationResult ───────────────────────────────────────────────────

export interface ActionValidationResult {
  valid: boolean;
  rejection_reason?: string;
}

// ─── validateSteeringAction ───────────────────────────────────────────────────

/**
 * Validate a steering decision against the stage's contract.
 *
 * Checks (in order):
 *   1. If stage is non-steerable, only continue and abort_execution are allowed
 *   2. Action must be in contract.steering_modes
 *   3. For modify_parameters: each param must be in allowed_parameter_mutations
 *   4. For redirect_action: alternate target must be in allowed_alternate_actions
 *
 * @param decision - the steering decision to validate
 * @param stageId  - the stage being steered (for error messages)
 * @param contract - the stage's steering contract
 * @returns        - validation result with optional rejection reason
 */
export function validateSteeringAction(
  decision: SteeringDecision,
  stageId: string,
  contract: StageSteeringContract,
): ActionValidationResult {
  // Non-steerable stages: only continue or abort_execution
  if (!contract.steering_allowed) {
    if (decision.action === 'continue' || decision.action === 'abort_execution') {
      return { valid: true };
    }
    return {
      valid: false,
      rejection_reason:
        `Stage '${stageId}' is not steerable — only 'continue' or 'abort_execution' allowed`,
    };
  }

  // Action must be in the stage's allowed steering_modes
  if (!contract.steering_modes.includes(decision.action)) {
    return {
      valid: false,
      rejection_reason:
        `Action '${decision.action}' is not in the allowed steering_modes for stage '${stageId}'. ` +
        `Allowed: ${contract.steering_modes.join(', ')}`,
    };
  }

  // modify_parameters: each mutated parameter must be explicitly allowed
  if (decision.action === 'modify_parameters' && decision.modified_parameters) {
    for (const param of Object.keys(decision.modified_parameters)) {
      if (!contract.allowed_parameter_mutations.includes(param)) {
        return {
          valid: false,
          rejection_reason:
            `Parameter '${param}' is not in allowed_parameter_mutations for stage '${stageId}'. ` +
            `Allowed: ${contract.allowed_parameter_mutations.join(', ') || '(none)'}`,
        };
      }
    }
  }

  // redirect_action: target stage must be in allowed_alternate_actions
  if (decision.action === 'redirect_action' && decision.alternate_step) {
    const target = decision.alternate_step.stage_id;
    if (!contract.allowed_alternate_actions.includes(target)) {
      return {
        valid: false,
        rejection_reason:
          `Redirect target '${target}' is not in allowed_alternate_actions for stage '${stageId}'. ` +
          `Allowed: ${contract.allowed_alternate_actions.join(', ') || '(none)'}`,
      };
    }
  }

  return { valid: true };
}
