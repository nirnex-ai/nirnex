/**
 * Evidence Gate — Sufficiency Evaluator
 *
 * Deterministic gate: evaluates whether the system has sufficient evidence
 * to proceed beyond the Knowledge Layer for the current intent.
 *
 * Replaces the unconditional-pass stub that previously lived at
 * packages/core/src/checkpoints.ts.
 *
 * Design constraints:
 *   - Pure function: same input always yields same verdict
 *   - No LLM dependency — all decisions are rule-table driven
 *   - Strict verdict precedence: refuse > clarify > pass
 *   - forced_unknown always overrides to refuse (non-overrideable)
 *   - All rule results are recorded in perRuleResults for audit/replay
 *
 * Evaluation order:
 *   1. Extract normalized EvidenceGateFacts from EcoBuildOutput
 *   2. Resolve per-intent IntentEvidencePolicy from rules table
 *   3. Run each rule; accumulate worst verdict (refuse wins over clarify wins over pass)
 *   4. Build EvidenceGateDecision with full provenance
 */

import type { SufficiencyGateInput } from '../../pipeline/types.js';
import type {
  EvidenceGateDecision,
  EvidenceGateFacts,
  EvidenceGateReasonCode,
  EvidenceGateVerdict,
  RuleResult,
} from './types.js';
import { getEvidencePolicy } from './rules.js';

// ─── Fact extraction ──────────────────────────────────────────────────────────

/**
 * Extract normalized EvidenceGateFacts from the ECO output.
 *
 * All field accesses are safe — missing fields get conservative defaults.
 * Rules read exclusively from these facts; never from raw ECO fields.
 */
export function extractEvidenceFacts(eco: SufficiencyGateInput): EvidenceGateFacts {
  const ecoAny = eco as Record<string, unknown>;

  // ── Intent ────────────────────────────────────────────────────────────────
  const intent = eco.intent;
  const intentPrimary    = (intent?.primary as string | undefined) ?? 'unknown';
  const intentComposite  = (intent?.composite as boolean | undefined) ?? false;
  const intentConfidence = (intent?.confidence as string | undefined) ?? 'unknown';

  // ── ECO dimension severities ──────────────────────────────────────────────
  const dims = eco.eco_dimensions;
  const coverageSeverity  = (dims?.coverage?.severity  as string | undefined) ?? 'block';
  const freshnessSeverity = (dims?.freshness?.severity as string | undefined) ?? 'pass';
  const mappingSeverity   = (dims?.mapping?.severity   as string | undefined) ?? 'block';
  const conflictSeverity  = (dims?.conflict?.severity  as string | undefined) ?? 'pass';
  const graphSeverity     = (dims?.graph?.severity     as string | undefined) ?? 'block';

  // ── Conflict detail ───────────────────────────────────────────────────────
  const conflicts = (ecoAny['conflicts'] as Array<Record<string, unknown>> | undefined) ?? [];

  const hasBlockingConflict =
    conflictSeverity === 'block' ||
    conflicts.some(
      c =>
        c['severity'] === 'block' ||
        c['resolution_hint'] === 'must_block',
    );

  const unresolvedHighConflicts = conflicts.filter(
    c =>
      (c['severity'] === 'high' || c['severity'] === 'block') &&
      c['resolution_hint'] !== 'can_proceed_with_warning',
  ).length;

  const conflictDominantTypes = Array.from(
    new Set(
      conflicts
        .map(c => c['type'] as string | undefined)
        .filter((t): t is string => typeof t === 'string'),
    ),
  );

  // ── Scope / mapping ───────────────────────────────────────────────────────
  const mappingObj      = ecoAny['mapping'] as Record<string, unknown> | undefined;
  const mappingPattern  = (mappingObj?.['pattern'] as string | undefined) ?? 'unknown';
  const modulesTouched  = (ecoAny['modules_touched'] as string[] | undefined) ?? [];
  const modulesTouchedCount = modulesTouched.length;

  const rootsRanked = Array.isArray(mappingObj?.['roots_ranked'])
    ? (mappingObj['roots_ranked'] as unknown[])
    : [];
  const hasTargetFiles = modulesTouchedCount > 0 || rootsRanked.length > 0;

  // ── Forced / override states ──────────────────────────────────────────────
  const forcedUnknown = (ecoAny['forced_unknown'] as boolean | undefined) ?? false;
  const ecoBlocked    = (ecoAny['blocked']        as boolean | undefined) ?? false;

  // ── Confidence ────────────────────────────────────────────────────────────
  const confidenceScore = typeof eco.confidence_score === 'number' ? eco.confidence_score : 0;

  // ── Reclassification (extension point) ───────────────────────────────────
  const reclassObj            = ecoAny['reclassification'] as Record<string, unknown> | null | undefined;
  const hasReclassification   = reclassObj != null;
  const reclassificationRequired =
    hasReclassification && reclassObj?.['required'] === true;

  return {
    intentPrimary,
    intentComposite,
    intentConfidence,
    coverageSeverity,
    freshnessSeverity,
    mappingSeverity,
    conflictSeverity,
    graphSeverity,
    hasBlockingConflict,
    unresolvedHighConflicts,
    conflictDominantTypes,
    mappingPattern,
    modulesTouchedCount,
    hasTargetFiles,
    forcedUnknown,
    ecoBlocked,
    confidenceScore,
    hasReclassification,
    reclassificationRequired,
  };
}

// ─── Verdict precedence ───────────────────────────────────────────────────────

const VERDICT_PRECEDENCE: Record<EvidenceGateVerdict, number> = {
  refuse:  3,
  clarify: 2,
  pass:    1,
};

function dominantVerdict(
  a: EvidenceGateVerdict,
  b: EvidenceGateVerdict,
): EvidenceGateVerdict {
  return VERDICT_PRECEDENCE[a] >= VERDICT_PRECEDENCE[b] ? a : b;
}

// ─── Gate evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate evidence sufficiency for the given EcoBuildOutput.
 *
 * Evaluation flow:
 *   extract facts → select policy → run all rules → accumulate worst verdict → build decision
 *
 * Verdict precedence (strict — no override possible):
 *   1. forced_unknown → refuse   (hardest rule; always evaluated first by policy)
 *   2. Missing mandatory evidence → refuse
 *   3. Conflict / mapping / graph blockers → refuse or clarify
 *   4. Clarification-worthy ambiguity → clarify
 *   5. Pass
 *
 * @returns EvidenceGateDecision — typed verdict with full provenance
 */
export function evaluateEvidenceGate(eco: SufficiencyGateInput): EvidenceGateDecision {
  const facts  = extractEvidenceFacts(eco);
  const policy = getEvidencePolicy(facts.intentPrimary);

  const perRuleResults: RuleResult[]            = [];
  const reasonCodes: EvidenceGateReasonCode[]   = [];
  const clarificationQuestions: string[]        = [];
  const blockedDimensions: string[]             = [];

  let currentVerdict: EvidenceGateVerdict = 'pass';

  // ── Run all rules; accumulate worst verdict ────────────────────────────────
  for (const rule of policy.rules) {
    const result = rule.evaluate(facts);
    perRuleResults.push(result);

    if (!result.passed && result.verdictContribution != null) {
      currentVerdict = dominantVerdict(currentVerdict, result.verdictContribution);

      // Deduplicate reason codes
      if (!reasonCodes.includes(result.ruleCode)) {
        reasonCodes.push(result.ruleCode);
      }

      if (result.verdictContribution === 'clarify') {
        clarificationQuestions.push(result.detail);
      }

      // Track which ECO dimensions contributed (for refusal payload)
      for (const ref of result.evidenceRefs) {
        if (ref.endsWith('Severity')) {
          const dim = ref.replace('Severity', '');
          if (!blockedDimensions.includes(dim)) blockedDimensions.push(dim);
        }
      }
    }
  }

  // ── Reclassification override ─────────────────────────────────────────────
  if (facts.reclassificationRequired && currentVerdict === 'pass') {
    currentVerdict = 'clarify';
    if (!reasonCodes.includes('RECLASSIFICATION_REQUIRED')) {
      reasonCodes.push('RECLASSIFICATION_REQUIRED');
    }
    clarificationQuestions.push(
      'Reclassification is required before execution can proceed. ' +
        'The system detected that the intent classification should be reconsidered.',
    );
  }

  // ── Build decision ────────────────────────────────────────────────────────
  const summary = buildSummary(currentVerdict, reasonCodes, facts);

  const refusalDetail =
    currentVerdict === 'refuse'
      ? {
          why:              summary,
          failedRules:      reasonCodes,
          blockedDimensions,
          // forced_unknown is never overrideable; other refusals may be
          overrideable: !facts.forcedUnknown,
        }
      : null;

  return {
    verdict:               currentVerdict,
    reasonCodes,
    summary,
    perRuleResults,
    provenance: {
      dimensionsRead: {
        coverage:  facts.coverageSeverity,
        freshness: facts.freshnessSeverity,
        mapping:   facts.mappingSeverity,
        conflict:  facts.conflictSeverity,
        graph:     facts.graphSeverity,
      },
      intentClass:          facts.intentPrimary,
      forcedUnknownApplied: facts.forcedUnknown,
      ecoBlockApplied:      facts.ecoBlocked,
    },
    clarificationQuestions,
    refusalDetail,
  };
}

// ─── Summary builder ──────────────────────────────────────────────────────────

function buildSummary(
  verdict: EvidenceGateVerdict,
  reasonCodes: EvidenceGateReasonCode[],
  facts: EvidenceGateFacts,
): string {
  switch (verdict) {
    case 'pass':
      return (
        `Evidence gate passed for intent '${facts.intentPrimary}'. ` +
        `Confidence: ${facts.confidenceScore}/100.`
      );
    case 'clarify':
      return (
        `Evidence gate requires clarification for intent '${facts.intentPrimary}': ` +
        `${reasonCodes.join(', ')}.`
      );
    case 'refuse':
      return (
        `Evidence gate refused execution for intent '${facts.intentPrimary}': ` +
        `${reasonCodes.join(', ')}.`
      );
  }
}
