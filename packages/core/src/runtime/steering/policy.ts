/**
 * Steering Engine — Policy Rules
 *
 * Defines the PolicyRule interface and the evaluateWithPolicy() function.
 *
 * Design constraints:
 *   - Rules are evaluated in order — first matching rule wins
 *   - No rule → action='continue', reason_code='no_trigger'
 *   - Rules are pure functions: condition(ctx) and decision(ctx) have no side effects
 *   - Deterministic: same context + same rule set → same decision always
 */

import type { SteeringContext, SteeringDecision } from './types.js';

// ─── PolicyRule ───────────────────────────────────────────────────────────────

/**
 * A single declarative steering rule.
 * Rules are evaluated in array order. First match applies.
 */
export interface PolicyRule {
  /** Unique rule identifier for audit references */
  id: string;

  /** Human-readable description of what this rule does */
  description: string;

  /** Pure predicate: returns true when this rule should fire */
  condition: (context: SteeringContext) => boolean;

  /** Pure decision producer: returns the SteeringDecision to apply */
  decision: (context: SteeringContext) => SteeringDecision;
}

// ─── evaluateWithPolicy ───────────────────────────────────────────────────────

/**
 * Evaluate a steering context against an ordered list of policy rules.
 *
 * Evaluation is first-match: rules are checked in array order.
 * If no rule matches, returns a continue decision with reason_code='no_trigger'.
 *
 * @param context - current execution snapshot
 * @param rules   - ordered list of policy rules to evaluate
 * @returns       - SteeringDecision (continue if no rule matches)
 */
export function evaluateWithPolicy(
  context: SteeringContext,
  rules: PolicyRule[],
): SteeringDecision {
  for (const rule of rules) {
    if (rule.condition(context)) {
      return rule.decision(context);
    }
  }

  return {
    action:      'continue',
    reason_code: 'no_trigger',
    rationale:   'No policy rules triggered — proceeding as planned',
    policy_refs: [],
  };
}
