/**
 * Evidence Gate — Intent Evidence Policies
 *
 * Declarative per-intent evidence rules. Each policy maps an intent class
 * to a set of RuleCheck functions that evaluate EvidenceGateFacts.
 *
 * Design constraints:
 *   - One policy per intent class — no shared mutable state
 *   - Rules are pure functions — (facts) → RuleResult
 *   - Verdict precedence: refuse > clarify > pass (enforced by evaluator)
 *   - Freshness alone never causes 'refuse' in standard intents
 *   - New intent classes → add a new policy and register in EVIDENCE_RULES_BY_INTENT
 *
 * Decision notes per intent:
 *   bug_fix    — target code path must be findable; mapping ambiguity → clarify
 *   new_feature — scope must be bounded; graph must not be blocking
 *   refactor    — graph coverage is mandatory; ownership ambiguity → clarify
 *   dep_update  — similar to feature; graph coverage required
 *   config_infra — lightest requirements; high conflict still blocks
 *   unknown     — always refuse (no safe execution path)
 */

import type {
  EvidenceGateFacts,
  EvidenceGateReasonCode,
  IntentEvidencePolicy,
  RuleCheck,
  RuleResult,
} from './types.js';

// ─── Rule builder ─────────────────────────────────────────────────────────────

function makeRule(
  code: EvidenceGateReasonCode,
  description: string,
  evaluate: (facts: EvidenceGateFacts) => Omit<RuleResult, 'ruleCode'>,
): RuleCheck {
  return {
    code,
    description,
    evaluate: (facts) => ({ ruleCode: code, ...evaluate(facts) }),
  };
}

function passResult(detail: string, evidenceRefs: string[] = []): Omit<RuleResult, 'ruleCode'> {
  return { passed: true, verdictContribution: null, detail, evidenceRefs };
}

function clarifyResult(detail: string, evidenceRefs: string[] = []): Omit<RuleResult, 'ruleCode'> {
  return { passed: false, verdictContribution: 'clarify', detail, evidenceRefs };
}

function refuseResult(detail: string, evidenceRefs: string[] = []): Omit<RuleResult, 'ruleCode'> {
  return { passed: false, verdictContribution: 'refuse', detail, evidenceRefs };
}

// ─── Shared rules (appear in multiple intent policies) ────────────────────────

/**
 * FORCED_UNKNOWN_HIGH_RISK: forced_unknown=true always refuses.
 * No advisory downgrade — this is a hard safety rule.
 */
const FORCED_UNKNOWN_RULE = makeRule(
  'FORCED_UNKNOWN_HIGH_RISK',
  'forced_unknown=true — high-risk condition; execution is not permitted',
  (facts) =>
    facts.forcedUnknown
      ? refuseResult(
          'The ECO has set forced_unknown=true, indicating a high-risk or policy-sensitive condition. ' +
            'Execution is not permitted. The request must be reclassified or explicitly overridden.',
          ['forcedUnknown'],
        )
      : passResult('forced_unknown is false', ['forcedUnknown']),
);

/**
 * HIGH_CONFLICT_UNRESOLVED: blocking conflicts require refuse; escalated conflicts clarify.
 */
const HIGH_CONFLICT_RULE = makeRule(
  'HIGH_CONFLICT_UNRESOLVED',
  'Unresolved blocking or high-severity conflict prevents safe execution',
  (facts) => {
    if (facts.conflictSeverity === 'block' || facts.hasBlockingConflict) {
      return refuseResult(
        `Conflict dimension is blocking (severity=${facts.conflictSeverity}, ` +
          `hasBlockingConflict=${facts.hasBlockingConflict}). ` +
          'All blocking conflicts must be resolved before execution can proceed.',
        ['conflictSeverity', 'hasBlockingConflict'],
      );
    }
    if (facts.unresolvedHighConflicts > 0 && facts.conflictSeverity === 'escalate') {
      return clarifyResult(
        `${facts.unresolvedHighConflicts} unresolved high-severity conflict(s) detected. ` +
          'Please clarify how these conflicts should be resolved before execution.',
        ['unresolvedHighConflicts', 'conflictSeverity'],
      );
    }
    return passResult(`Conflict severity is acceptable: ${facts.conflictSeverity}`, ['conflictSeverity']);
  },
);

/**
 * AMBIGUOUS_INTENT: composite intent with low confidence, or unknown intent, needs clarification.
 */
const AMBIGUOUS_INTENT_RULE = makeRule(
  'AMBIGUOUS_INTENT',
  'Composite or low-confidence intent requires clarification',
  (facts) => {
    if (facts.intentComposite && facts.intentConfidence === 'low') {
      return clarifyResult(
        `Intent is composite with low confidence (primary='${facts.intentPrimary}'). ` +
          'Please clarify which intent takes priority to enable correct evidence evaluation.',
        ['intentComposite', 'intentConfidence', 'intentPrimary'],
      );
    }
    return passResult(
      `Intent is clear: ${facts.intentPrimary} (composite=${facts.intentComposite}, confidence=${facts.intentConfidence})`,
      ['intentPrimary', 'intentComposite', 'intentConfidence'],
    );
  },
);

/**
 * LOW_COVERAGE: coverage=block refuses; coverage=escalate clarifies.
 * 'warn' and 'pass' are acceptable for all standard intents.
 */
const COVERAGE_RULE = makeRule(
  'LOW_COVERAGE',
  'Coverage dimension too low for safe execution',
  (facts) => {
    if (facts.coverageSeverity === 'block') {
      return refuseResult(
        'Coverage dimension is blocking — no sufficient evidence was retrieved for the required scope. ' +
          'The system cannot proceed without evidence of the target area.',
        ['coverageSeverity'],
      );
    }
    if (facts.coverageSeverity === 'escalate') {
      return clarifyResult(
        'Coverage dimension is escalated — only partial evidence was retrieved. ' +
          'Please provide a more specific scope, file path, or module name.',
        ['coverageSeverity'],
      );
    }
    return passResult(`Coverage is acceptable: ${facts.coverageSeverity}`, ['coverageSeverity']);
  },
);

/**
 * STALE_FRESHNESS (shared, soft): freshness=block → clarify (not refuse) for standard intents.
 * freshness='warn'|'escalate' → pass (annotated warning only; not a gate condition).
 */
const FRESHNESS_RULE = makeRule(
  'LOW_COVERAGE',  // closest standard reason code for index staleness
  'Index freshness degraded — evidence may reflect a stale codebase state',
  (facts) => {
    if (facts.freshnessSeverity === 'block') {
      return clarifyResult(
        'Index freshness is severely degraded. Evidence retrieved may reflect an outdated state of the codebase. ' +
          'Consider re-indexing before proceeding, or confirm that the stale files are not in scope.',
        ['freshnessSeverity'],
      );
    }
    return passResult(
      `Freshness is acceptable: ${facts.freshnessSeverity} (non-blocking)`,
      ['freshnessSeverity'],
    );
  },
);

// ─── Bug Fix rules ────────────────────────────────────────────────────────────

const LOW_MAPPING_BUG_FIX = makeRule(
  'LOW_MAPPING_CONFIDENCE',
  'Mapping ambiguity on bug fix — target code path is unclear',
  (facts) => {
    if (facts.mappingSeverity === 'block') {
      return refuseResult(
        'Mapping dimension is blocking — the target code path cannot be identified for this bug fix. ' +
          'The system cannot safely proceed without a concrete target area.',
        ['mappingSeverity', 'mappingPattern'],
      );
    }
    if (facts.mappingSeverity === 'escalate' || facts.mappingPattern === 'ambiguous') {
      return clarifyResult(
        `Mapping is ambiguous for bug fix (pattern='${facts.mappingPattern}', severity=${facts.mappingSeverity}). ` +
          'Please provide more details: which module, class, or function is affected? ' +
          'A stack trace, file path, or reproduction steps would help.',
        ['mappingSeverity', 'mappingPattern'],
      );
    }
    return passResult(
      `Mapping is acceptable for bug fix: pattern=${facts.mappingPattern}`,
      ['mappingPattern', 'mappingSeverity'],
    );
  },
);

const MISSING_EXECUTION_PATH_BUG_FIX = makeRule(
  'MISSING_EXECUTION_PATH',
  'No concrete code path identified for bug fix',
  (facts) => {
    if (facts.modulesTouchedCount === 0 && !facts.hasTargetFiles) {
      return clarifyResult(
        'No code paths or files identified for this bug fix. ' +
          'Please provide a stack trace, reproduction steps, the specific file/function affected, ' +
          'or an expected-vs-actual description that anchors to the codebase.',
        ['modulesTouchedCount', 'hasTargetFiles'],
      );
    }
    return passResult(
      `${facts.modulesTouchedCount} module(s) / files identified`,
      ['modulesTouchedCount', 'hasTargetFiles'],
    );
  },
);

// ─── Feature rules ────────────────────────────────────────────────────────────

const INSUFFICIENT_SCOPE_FEATURE = makeRule(
  'INSUFFICIENT_SCOPE_BINDING',
  'Feature intent lacks a bounded target scope',
  (facts) => {
    if (facts.coverageSeverity === 'block') {
      return refuseResult(
        'No target scope identified for the new feature. ' +
          'Cannot proceed without a bounded implementation area.',
        ['coverageSeverity'],
      );
    }
    if (facts.coverageSeverity === 'escalate' && facts.modulesTouchedCount === 0) {
      return clarifyResult(
        'Target scope for the new feature is unclear. ' +
          'Please specify which module, component, or area of the codebase this feature belongs to, ' +
          'or provide acceptance criteria that bound the implementation surface.',
        ['coverageSeverity', 'modulesTouchedCount'],
      );
    }
    return passResult(
      `Feature scope identified: ${facts.modulesTouchedCount} module(s)`,
      ['modulesTouchedCount', 'coverageSeverity'],
    );
  },
);

const GRAPH_INCOMPLETE_FEATURE = makeRule(
  'GRAPH_INCOMPLETE',
  'Dependency graph incomplete — cannot safely identify insertion point',
  (facts) => {
    if (facts.graphSeverity === 'block') {
      return refuseResult(
        'Dependency graph is blocking — cannot identify a safe insertion point for the new feature.',
        ['graphSeverity'],
      );
    }
    if (facts.graphSeverity === 'escalate') {
      return clarifyResult(
        'Dependency graph is incomplete — the insertion point for the new feature is uncertain. ' +
          'Please clarify dependencies, entry points, or which existing modules this feature extends.',
        ['graphSeverity'],
      );
    }
    return passResult(`Graph completeness acceptable: ${facts.graphSeverity}`, ['graphSeverity']);
  },
);

// ─── Refactor rules ───────────────────────────────────────────────────────────

const GRAPH_INCOMPLETE_REFACTOR = makeRule(
  'GRAPH_INCOMPLETE',
  'Dependency graph incomplete — refactor cannot be safely scoped',
  (facts) => {
    if (facts.graphSeverity === 'block') {
      return refuseResult(
        'Dependency graph is blocking — cannot safely refactor without complete dependency coverage. ' +
          'Cross-module effects of the refactor cannot be determined.',
        ['graphSeverity'],
      );
    }
    if (facts.graphSeverity === 'escalate') {
      return clarifyResult(
        'Dependency graph is incomplete for the refactor scope. ' +
          'Cross-module effects cannot be reliably determined. ' +
          'Please confirm the exact modules being touched and their downstream consumers.',
        ['graphSeverity'],
      );
    }
    return passResult(
      `Graph coverage acceptable for refactor: ${facts.graphSeverity}`,
      ['graphSeverity'],
    );
  },
);

const AMBIGUOUS_OWNERSHIP_REFACTOR = makeRule(
  'INSUFFICIENT_SCOPE_BINDING',
  'Ambiguous cross-module ownership detected in refactor scope',
  (facts) => {
    const hasOwnershipConflict = facts.conflictDominantTypes.includes('ownership_overlap');
    if (hasOwnershipConflict && facts.conflictSeverity !== 'pass') {
      return clarifyResult(
        'Cross-module ownership overlap detected in the refactor scope. ' +
          'Clarify which module owns the code being refactored to avoid split-ownership risk.',
        ['conflictDominantTypes', 'conflictSeverity'],
      );
    }
    return passResult('No ambiguous cross-module ownership detected', ['conflictDominantTypes']);
  },
);

// ─── Unknown intent rule ──────────────────────────────────────────────────────

const MISSING_TARGET_FILES_UNKNOWN = makeRule(
  'MISSING_TARGET_FILES',
  'Unknown intent — insufficient information to proceed safely',
  (facts) =>
    facts.intentPrimary === 'unknown'
      ? refuseResult(
          "Intent could not be classified (primary='unknown'). " +
            'The system cannot evaluate evidence requirements without knowing what is being asked. ' +
            'Please provide a clearer description of the change.',
          ['intentPrimary'],
        )
      : passResult('Intent is classified (not unknown)', ['intentPrimary']),
);

// ─── Policy definitions ───────────────────────────────────────────────────────

const bugFixPolicy: IntentEvidencePolicy = {
  intentClass: 'bug_fix',
  description:
    'Bug fix requires a bounded target area, concrete code path, and a reproducible failure signal',
  rules: [
    FORCED_UNKNOWN_RULE,
    AMBIGUOUS_INTENT_RULE,
    HIGH_CONFLICT_RULE,
    COVERAGE_RULE,
    LOW_MAPPING_BUG_FIX,
    MISSING_EXECUTION_PATH_BUG_FIX,
    FRESHNESS_RULE,
  ],
  freshnessBlockIsRefusal: false,
};

const featurePolicy: IntentEvidencePolicy = {
  intentClass: 'new_feature',
  description:
    'Feature intent requires bounded scope, dependency path, and a behavioral target (acceptance criteria)',
  rules: [
    FORCED_UNKNOWN_RULE,
    AMBIGUOUS_INTENT_RULE,
    HIGH_CONFLICT_RULE,
    INSUFFICIENT_SCOPE_FEATURE,
    GRAPH_INCOMPLETE_FEATURE,
    FRESHNESS_RULE,
  ],
  freshnessBlockIsRefusal: false,
};

const refactorPolicy: IntentEvidencePolicy = {
  intentClass: 'refactor',
  description:
    'Refactor requires bounded scope, graph coverage of touched area, and no ambiguous ownership',
  rules: [
    FORCED_UNKNOWN_RULE,
    AMBIGUOUS_INTENT_RULE,
    HIGH_CONFLICT_RULE,
    COVERAGE_RULE,
    GRAPH_INCOMPLETE_REFACTOR,
    AMBIGUOUS_OWNERSHIP_REFACTOR,
    FRESHNESS_RULE,
  ],
  freshnessBlockIsRefusal: false,
};

const depUpdatePolicy: IntentEvidencePolicy = {
  intentClass: 'dep_update',
  description:
    'Dependency update requires the target dependency identified and graph coverage of affected consumers',
  rules: [
    FORCED_UNKNOWN_RULE,
    AMBIGUOUS_INTENT_RULE,
    HIGH_CONFLICT_RULE,
    COVERAGE_RULE,
    GRAPH_INCOMPLETE_FEATURE,
    FRESHNESS_RULE,
  ],
  freshnessBlockIsRefusal: false,
};

const configInfraPolicy: IntentEvidencePolicy = {
  intentClass: 'config_infra',
  description:
    'Config/infra change requires the target config area and no cross-module conflict',
  rules: [
    FORCED_UNKNOWN_RULE,
    AMBIGUOUS_INTENT_RULE,
    HIGH_CONFLICT_RULE,
    COVERAGE_RULE,
    FRESHNESS_RULE,
  ],
  freshnessBlockIsRefusal: false,
};

const unknownPolicy: IntentEvidencePolicy = {
  intentClass: 'unknown',
  description: 'Unknown intent — always requires clarification before any execution',
  rules: [
    FORCED_UNKNOWN_RULE,
    MISSING_TARGET_FILES_UNKNOWN,
    AMBIGUOUS_INTENT_RULE,
  ],
  freshnessBlockIsRefusal: true,
};

// ─── Policy registry ──────────────────────────────────────────────────────────

/**
 * Declarative policy table: intent class → evidence policy.
 *
 * Extension: add a new key/value pair. The evaluator picks it up automatically.
 * Do not add logic to the evaluator — put it in the policy's rules instead.
 */
export const EVIDENCE_RULES_BY_INTENT: Record<string, IntentEvidencePolicy> = {
  bug_fix:      bugFixPolicy,
  new_feature:  featurePolicy,
  refactor:     refactorPolicy,
  dep_update:   depUpdatePolicy,
  config_infra: configInfraPolicy,
  unknown:      unknownPolicy,
};

/**
 * Resolve the evidence policy for a given intent class.
 * Falls back to unknownPolicy when the intent is not registered.
 */
export function getEvidencePolicy(intentPrimary: string): IntentEvidencePolicy {
  return EVIDENCE_RULES_BY_INTENT[intentPrimary] ?? unknownPolicy;
}
