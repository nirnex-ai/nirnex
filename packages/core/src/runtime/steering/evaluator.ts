/**
 * Steering Engine — Evaluator Entry Point
 *
 * Provides the constant cap on steering interventions per run
 * and a single call-site function for invoking the evaluator with
 * action-validation applied.
 */

import { validateSteeringAction } from './actions.js';
import { STAGE_STEERING_CONTRACTS, DEFAULT_STEERING_CONTRACT } from './contracts.js';
import type { SteeringContext, SteeringDecision, SteeringEvaluator, StageSteeringContract } from './types.js';
import type { ActionValidationResult } from './actions.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default maximum number of steering evaluator calls per run. */
export const MAX_STEERING_INTERVENTIONS = 10;

// ─── EvaluationResult ─────────────────────────────────────────────────────────

export interface EvaluationResult {
  decision: SteeringDecision;
  validation: ActionValidationResult;
}

// ─── evaluateSteering ─────────────────────────────────────────────────────────

/**
 * Invoke the steering evaluator and validate the returned decision against
 * the stage's StageSteeringContract.
 *
 * @param context   - current steering context
 * @param evaluator - injected evaluator function
 * @returns         - decision + validation result pair
 */
export function evaluateSteering(
  context: SteeringContext,
  evaluator: SteeringEvaluator,
): EvaluationResult {
  const contract: StageSteeringContract =
    STAGE_STEERING_CONTRACTS[context.stage] ?? DEFAULT_STEERING_CONTRACT;
  const decision = evaluator(context);
  const validation = validateSteeringAction(decision, context.stage, contract);
  return { decision, validation };
}
