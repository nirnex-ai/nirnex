/**
 * Mapping Quality — Types
 *
 * Canonical types for the quantitative mapping quality metric.
 *
 * Design constraints:
 *   - MappingQualityResult is the single output contract from scoreMappingQuality()
 *   - MappingQualityInput is the normalized signal input (built from DimensionSignals)
 *   - PrimaryMappingPath and AlternateMappingPath are evidence for analyst review
 *   - hard_block is a boolean guard that overrides the weighted score
 *   - All numeric scores are integers 0..100 for uniform ledger comparison
 */

// ─── Output types ─────────────────────────────────────────────────────────────

export interface PrimaryMappingPath {
  /**
   * Top-level entry files / module paths that anchor the mapping.
   * Derived from knownScopePaths or scopedCandidateCount evidence.
   */
  entrypoints: string[];
  /**
   * Files or module identifiers that fall within the requested scope.
   * These are the confirmed in-scope targets.
   */
  scoped_targets: string[];
  /**
   * Intermediate structural nodes linking entrypoints to scoped_targets.
   * Empty when the mapping is a direct 1:1 without traversal.
   */
  bridge_nodes: string[];
  /**
   * IDs of the evidence items (source refs) that support this path.
   * Enables ledger traceability back to retrieval.
   */
  supporting_evidence_ids: string[];
  /**
   * Confidence 0..1 derived from primaryCandidateScore.
   * 1.0 = the primary candidate completely dominates; 0 = unknown.
   */
  path_confidence: number;
}

export interface AlternateMappingPath {
  /** Target identifiers for this alternate candidate. */
  targets: string[];
  /** Normalized score 0..1 relative to the primary. */
  score: number;
  /** Why this alternate exists and why it was not selected as primary. */
  reason: string;
}

export interface MappingQualityBreakdown {
  /** 0..100: evidence overlap with requested scope. Weight: 0.35 */
  scope_alignment: number;
  /** 0..100: evidence forms a coherent chain vs disconnected fragments. Weight: 0.30 */
  structural_coherence: number;
  /** 0..100: primary candidate clearly dominates vs scattered candidates. Weight: 0.20 */
  evidence_concentration: number;
  /** 0..100: evidence type and pattern match the intent class. Weight: 0.15 */
  intent_alignment: number;
}

export interface MappingQualityResult {
  /**
   * Composite mapping quality score 0..100.
   * = scope_alignment*0.35 + structural_coherence*0.30 + evidence_concentration*0.20 + intent_alignment*0.15
   * Clamped to 0–100. When hard_block=true, score is ≤ 54 regardless of formula.
   */
  score: number;
  /**
   * Severity classification derived from score thresholds.
   * pass: ≥90  |  warn: 75–89  |  escalate: 55–74  |  block: <55
   * hard_block=true always produces 'block'.
   */
  level: 'pass' | 'warn' | 'escalate' | 'block';
  /**
   * True when a hard-block condition is met, regardless of weighted score.
   * Hard-block conditions:
   *   - No scoped evidence (all candidates out of scope)
   *   - 1:scattered pattern with zero primary candidate
   *   - All candidate scores are zero (completely blind)
   *   - Structural coherence at minimum floor (scattered + many clusters)
   */
  hard_block: boolean;
  /** Per-sub-metric breakdown for analyst review and calibration. */
  breakdown: MappingQualityBreakdown;
  /** Human-readable reasons, at least one per weak sub-metric. */
  reasons: string[];
  /**
   * The primary mapping path — present when a primary candidate exists.
   * Used for analyst review and deviation detection.
   */
  primary_mapping?: PrimaryMappingPath;
  /**
   * Alternate candidates that were considered but not selected.
   * Present when alternateCandidateScore > 0.30.
   */
  alternates?: AlternateMappingPath[];
}

// ─── Normalized input ─────────────────────────────────────────────────────────

/**
 * Normalized signal input to scoreMappingQuality.
 * Built from DimensionSignals by buildMappingQualityInput().
 *
 * All fields have safe defaults — scoring must never throw on missing input.
 */
export interface MappingQualityInput {
  /** Primary intent string (e.g. 'bug_fix', 'new_feature'). */
  intent: string;
  /** Detected mapping pattern. */
  mappingPattern: '1:1' | '1:chain' | '1:scattered' | 'ambiguous' | 'unknown';
  /** Normalized score 0..1 of the strongest candidate. */
  primaryCandidateScore: number;
  /** Normalized score 0..1 of the second-strongest candidate. */
  alternateCandidateScore: number;
  /** All candidate scores [0..1], sorted descending by score. */
  allCandidateScores: number[];
  /** Scope units matched by retrieved evidence. */
  matchedScopeCount: number;
  /** Scope units required for this request. Minimum 1. */
  requestedScopeCount: number;
  /** Candidate count whose targets fall within the requested scope. */
  scopedCandidateCount: number;
  /** Candidate count whose targets fall outside the requested scope. */
  outOfScopeCandidateCount: number;
  /** Number of disconnected evidence clusters in the graph. 0 = unknown / not fragmented. */
  disconnectedClusterCount: number;
  /** Evidence source types actually retrieved (e.g. ['code', 'spec']). */
  retrievedEvidenceClasses: string[];
  /** Mandatory evidence source types for this intent. */
  requiredEvidenceClasses: string[];
  /** Symbol resolution: resolved count. */
  symbolsResolved: number;
  /** Symbol resolution: unresolved count. */
  symbolsUnresolved: number;
  /** Optional: concrete file/module paths known to be in scope (from retrieval). */
  knownScopePaths?: string[];
}
