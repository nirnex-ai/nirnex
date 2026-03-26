/**
 * Evidence Gate — Types
 *
 * Strict runtime contracts for the Evidence Sufficiency Gate.
 * The gate consumes ECO output and produces a typed verdict with provenance.
 *
 * Design constraints:
 *   - EvidenceGateVerdict is the internal verdict type (maps to SufficiencyGateOutput.behavior)
 *   - All rule checks are deterministic — no LLM dependency
 *   - Provenance is always present on every verdict
 *   - No cross-rule state — each rule is evaluated independently
 *   - RuleCheck.evaluate is a pure function: (facts) → RuleResult
 */

// ─── Core verdict ─────────────────────────────────────────────────────────────

export type EvidenceGateVerdict = 'pass' | 'clarify' | 'refuse';

// ─── Reason codes ─────────────────────────────────────────────────────────────

export type EvidenceGateReasonCode =
  | 'INSUFFICIENT_SCOPE_BINDING'
  | 'INSUFFICIENT_CODE_EVIDENCE'
  | 'INSUFFICIENT_SPEC_EVIDENCE'
  | 'INSUFFICIENT_AC_BINDING'
  | 'HIGH_CONFLICT_UNRESOLVED'
  | 'LOW_MAPPING_CONFIDENCE'
  | 'LOW_COVERAGE'
  | 'GRAPH_INCOMPLETE'
  | 'FORCED_UNKNOWN_HIGH_RISK'
  | 'MISSING_TARGET_FILES'
  | 'MISSING_EXECUTION_PATH'
  | 'AMBIGUOUS_INTENT'
  | 'RECLASSIFICATION_REQUIRED';

// ─── Extracted evidence facts ─────────────────────────────────────────────────

/**
 * Normalized facts extracted from EcoBuildOutput for rule evaluation.
 * Rules MUST only read from EvidenceGateFacts — never from raw EcoBuildOutput.
 * This boundary prevents coupling rules to evolving ECO internals.
 */
export type EvidenceGateFacts = {
  // Intent classification
  intentPrimary: string;
  intentComposite: boolean;
  intentConfidence: string;     // 'low' | 'medium' | 'high' | 'unknown'

  // ECO dimension severities  (normalized: 'pass' | 'warn' | 'escalate' | 'block')
  coverageSeverity: string;
  freshnessSeverity: string;
  mappingSeverity: string;
  conflictSeverity: string;
  graphSeverity: string;

  // Conflict detail
  hasBlockingConflict: boolean;     // any conflict with severity='block' or resolution_hint='must_block'
  unresolvedHighConflicts: number;  // count of high/block unresolved
  conflictDominantTypes: string[];  // e.g. ['ownership_overlap', 'circular_dependency']

  // Scope / mapping
  mappingPattern: string;           // '1:1' | '1:chain' | '1:scattered' | 'ambiguous' | 'unknown'
  modulesTouchedCount: number;
  hasTargetFiles: boolean;          // at least one concrete file/module identified

  // Forced / override states
  forcedUnknown: boolean;
  ecoBlocked: boolean;              // eco.blocked === true

  // Confidence
  confidenceScore: number;          // 0..100

  // Reclassification (extension point — may be absent)
  hasReclassification: boolean;
  reclassificationRequired: boolean;
};

// ─── Individual rule result ───────────────────────────────────────────────────

export type RuleResult = {
  ruleCode: EvidenceGateReasonCode;
  passed: boolean;
  /**
   * Verdict contribution from this rule.
   * null = rule passed (no verdict contribution).
   * 'clarify' | 'refuse' = this rule recommends stopping with that verdict.
   */
  verdictContribution: EvidenceGateVerdict | null;
  detail: string;
  /** Facts read during evaluation — for provenance/audit. */
  evidenceRefs: string[];
};

// ─── Evidence provenance ──────────────────────────────────────────────────────

export type EvidenceProvenance = {
  /** ECO dimension severities read during evaluation. */
  dimensionsRead: Record<string, string>;
  /** Intent class used for policy lookup. */
  intentClass: string;
  /** Whether forced_unknown triggered the verdict. */
  forcedUnknownApplied: boolean;
  /** Whether ECO-level blocking affected the verdict. */
  ecoBlockApplied: boolean;
};

// ─── Full gate decision (internal) ───────────────────────────────────────────

export type EvidenceGateDecision = {
  verdict: EvidenceGateVerdict;
  reasonCodes: EvidenceGateReasonCode[];
  summary: string;
  perRuleResults: RuleResult[];
  provenance: EvidenceProvenance;
  /** Clarification questions — populated when verdict = 'clarify'. */
  clarificationQuestions: string[];
  /** Refusal detail — populated when verdict = 'refuse'. */
  refusalDetail: {
    why: string;
    failedRules: EvidenceGateReasonCode[];
    blockedDimensions: string[];
    /** false when forced_unknown is the cause (non-overrideable). */
    overrideable: boolean;
  } | null;
};

// ─── Per-intent evidence policy ───────────────────────────────────────────────

export type RuleCheck = {
  code: EvidenceGateReasonCode;
  description: string;
  /**
   * Pure evaluation function.
   * Returns { passed: true } when the rule is satisfied.
   * Returns { passed: false, verdictContribution } otherwise.
   */
  evaluate: (facts: EvidenceGateFacts) => RuleResult;
};

export type IntentEvidencePolicy = {
  intentClass: string;
  description: string;
  /** Ordered rules — all are evaluated; worst verdict wins. */
  rules: RuleCheck[];
  /**
   * When true, freshness=block causes 'refuse' instead of 'clarify'.
   * Should only be set for unknown/high-risk intents.
   */
  freshnessBlockIsRefusal: boolean;
};
