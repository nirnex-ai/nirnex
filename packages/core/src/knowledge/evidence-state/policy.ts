/**
 * Evidence State — Policy Application
 *
 * Distinct policy behavior for each epistemic state.
 * This is the enforcement layer that ensures absence and conflict are handled
 * differently by the policy engine — not collapsed into one escalation path.
 *
 * Policy rules (release):
 *
 *   absent:
 *     - adds 'evidence_absence:{target}' to escalation_reasons
 *     - high-risk intents: escalates forced_lane_minimum to ≥ B
 *
 *   conflicted:
 *     - adds 'evidence_conflict:{contradiction_type}' to escalation_reasons
 *     - low severity:    escalates to ≥ B
 *     - medium severity: escalates to ≥ B
 *     - high severity:   escalates to ≥ C
 *
 *   mixed:
 *     - applies absence rules AND conflict rules
 *     - strictest result wins
 *
 *   sufficient:
 *     - no evidence-state escalation
 *
 * Design constraints:
 *   - Pure side-effect on the eco object (intentionally mutates)
 *   - Does not alter confidence_score (that is the scoring layer's job)
 *   - Absence and conflict escalation paths are fully separate code branches
 */

import type { EvidenceAssessment } from './types.js';

const LANE_ORDER = ['A', 'B', 'C', 'D', 'E'] as const;

const HIGH_RISK_INTENTS = new Set([
  'bug_fix',
  'new_feature',
  'refactor',
  'dep_update',
  'config_infra',
  'quick_fix',
]);

function escalateLane(
  eco: { forced_lane_minimum: string },
  minimum: string,
): void {
  const currentIdx = LANE_ORDER.indexOf(eco.forced_lane_minimum as typeof LANE_ORDER[number]);
  const minIdx     = LANE_ORDER.indexOf(minimum as typeof LANE_ORDER[number]);
  if (minIdx > currentIdx) {
    eco.forced_lane_minimum = minimum;
  }
}

// ─── applyEvidenceStatePolicy ─────────────────────────────────────────────────

/**
 * Apply distinct policy reactions for the classified evidence state.
 * Mutates eco.escalation_reasons and eco.forced_lane_minimum as needed.
 *
 * The critical invariant: absence and conflict escalation reasons use different
 * prefixes so they are independently auditable:
 *   evidence_absence:*  — triggered by absent/mixed state
 *   evidence_conflict:* — triggered by conflicted/mixed state
 *
 * @param assessment - the structured evidence assessment
 * @param intent     - primary intent string
 * @param eco        - ECO object to mutate
 */
export function applyEvidenceStatePolicy(params: {
  assessment: EvidenceAssessment;
  intent:     string;
  eco: {
    forced_lane_minimum: string;
    escalation_reasons:  string[];
  };
}): void {
  const { assessment, intent, eco } = params;
  const isHighRisk = HIGH_RISK_INTENTS.has(intent);

  // ── Absence branch ───────────────────────────────────────────────────────
  if (assessment.availability.status === 'absent' ||
      assessment.availability.status === 'partial') {
    const missing = assessment.availability.missing_targets;
    if (missing.length > 0) {
      eco.escalation_reasons.push(
        `evidence_absence:${missing.join(',')}`,
      );
      if (isHighRisk) {
        escalateLane(eco, 'B');
      }
    }
  }

  // ── Conflict branch ──────────────────────────────────────────────────────
  if (assessment.conflict.status === 'present') {
    const groups   = assessment.conflict.groups;
    const severity = assessment.conflict.severity;

    // One escalation reason per distinct contradiction type
    const types = [...new Set(groups.map(g => g.contradiction_type))].sort();
    for (const type of types) {
      eco.escalation_reasons.push(`evidence_conflict:${type}`);
    }

    // Lane escalation based on conflict severity
    if (severity === 'high') {
      escalateLane(eco, 'C');
    } else {
      // low and medium both escalate to at least B
      escalateLane(eco, 'B');
    }
  }
}
