/**
 * Mapping Quality — Scoring Engine
 *
 * Implements the deterministic 4-sub-metric scoring model:
 *
 *   mapping_quality_score =
 *     scope_alignment_score      * 0.35 +
 *     structural_coherence_score * 0.30 +
 *     evidence_concentration_score * 0.20 +
 *     intent_alignment_score     * 0.15
 *
 * Hard-block conditions override the weighted score unconditionally.
 *
 * Design constraints:
 *   - Pure functions — no I/O, no side effects
 *   - All sub-scores in [0, 100] — clamped before return
 *   - Deterministic — same input → same output
 *   - No LLM dependency — all scoring is rule-based
 */

import type {
  MappingQualityInput,
  MappingQualityResult,
  MappingQualityBreakdown,
  PrimaryMappingPath,
  AlternateMappingPath,
} from './types.js';
import { SUB_METRIC_WEIGHTS, getMappingThresholds } from './thresholds.js';
import { generateMappingReasons } from './explain.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Scope alignment sub-score ────────────────────────────────────────────────

/**
 * Measures evidence overlap with the requested execution scope.
 *
 * High when:
 *   - Retrieved scope covers the requested scope (matchedScopeCount / requestedScopeCount)
 *   - Most candidates land within the requested scope
 *
 * Low when:
 *   - Coverage is thin
 *   - Most candidates are outside scope
 *   - Pattern indicates scatter ('1:scattered')
 */
export function computeScopeAlignmentScore(opts: {
  matchedScopeCount: number;
  requestedScopeCount: number;
  scopedCandidateCount: number;
  outOfScopeCandidateCount: number;
  mappingPattern: string;
}): number {
  const { matchedScopeCount, requestedScopeCount, scopedCandidateCount, outOfScopeCandidateCount, mappingPattern } = opts;

  // Coverage ratio — how much of the requested scope has evidence
  const coverageRatio = requestedScopeCount > 0
    ? matchedScopeCount / requestedScopeCount
    : 0;

  // Candidate scope ratio — of all candidates, what fraction is in scope?
  const totalCandidates = scopedCandidateCount + outOfScopeCandidateCount;
  const candidateScopeRatio = totalCandidates > 0
    ? scopedCandidateCount / totalCandidates
    : coverageRatio;   // fall back to coverage ratio when no candidate data

  const outOfScopeRatio = totalCandidates > 0
    ? outOfScopeCandidateCount / totalCandidates
    : 0;

  // Base score: weighted blend of scope coverage and candidate alignment
  let score = (coverageRatio * 50) + (candidateScopeRatio * 40) + 10;

  // Penalty for out-of-scope evidence (evidence that points away from scope)
  score -= outOfScopeRatio * 30;

  // Pattern-based penalty — scattered always indicates poor scope alignment
  if (mappingPattern === '1:scattered') {
    score -= 35;
  } else if (mappingPattern === 'ambiguous') {
    score -= 10;
  } else if (mappingPattern === 'unknown') {
    score -= 5;
  }

  return clamp(score);
}

// ─── Structural coherence sub-score ──────────────────────────────────────────

/**
 * Measures whether evidence forms a coherent dependency chain.
 *
 * High when:
 *   - Pattern is '1:1' or '1:chain' (evidence is structurally connected)
 *   - No disconnected clusters
 *   - Primary candidate is strong
 *
 * Low when:
 *   - Pattern is '1:scattered' or 'ambiguous'
 *   - Many disconnected clusters
 *   - No primary target
 */
export function computeStructuralCoherenceScore(opts: {
  mappingPattern: string;
  disconnectedClusterCount: number;
  primaryCandidateScore: number;
  graphDepthAchieved: number;
}): number {
  const { mappingPattern, disconnectedClusterCount, primaryCandidateScore, graphDepthAchieved } = opts;

  // Pattern base score
  const PATTERN_BASE: Record<string, number> = {
    '1:1':         95,
    '1:chain':     82,
    'ambiguous':   48,
    '1:scattered': 12,
    'unknown':     40,
  };
  let score = PATTERN_BASE[mappingPattern] ?? 40;

  // Cluster penalty — each disconnected cluster degrades coherence
  // Capped at 45 pts total penalty
  const clusterPenalty = Math.min(disconnectedClusterCount * 12, 45);
  score -= clusterPenalty;

  // Weak primary candidate degrades structural confidence
  if (primaryCandidateScore === 0) {
    score -= 30;
  } else if (primaryCandidateScore < 0.3) {
    score -= 15;
  }

  // Graph depth bonus (up to 10 pts) — deeper traversal = more coherent context
  const depthBonus = graphDepthAchieved > 0 ? Math.min(graphDepthAchieved * 2, 10) : 0;
  score += depthBonus;

  return clamp(score);
}

// ─── Evidence concentration sub-score ────────────────────────────────────────

/**
 * Measures whether evidence is concentrated around one primary target.
 *
 * High when:
 *   - One candidate clearly dominates the pool
 *   - Large gap between primary and secondary
 *
 * Low when:
 *   - Many similarly-scored candidates (entropy high)
 *   - No candidates at all
 */
export function computeEvidenceConcentrationScore(opts: {
  allCandidateScores: number[];
  primaryCandidateScore: number;
  alternateCandidateScore: number;
}): number {
  const { allCandidateScores, primaryCandidateScore, alternateCandidateScore } = opts;

  if (allCandidateScores.length === 0 || primaryCandidateScore === 0) {
    return 0;
  }

  if (allCandidateScores.length === 1) {
    // Perfect concentration — single uncontested candidate
    return Math.round(primaryCandidateScore * 100);
  }

  const scores = [...allCandidateScores].sort((a, b) => b - a);
  const total  = scores.reduce((s, v) => s + v, 0);

  if (total === 0) return 0;

  // Dominance ratio: how much of the total does the top candidate hold?
  const dominanceRatio = scores[0]! / total;

  // Primary vs. alternate gap (0..1): how much stronger is primary vs second?
  const gapRatio = primaryCandidateScore > 0
    ? Math.max(0, (primaryCandidateScore - alternateCandidateScore) / primaryCandidateScore)
    : 0;

  // Normalized entropy penalty: [0..1] where 1 = fully uniform distribution
  // Using Gini coefficient approximation for determinism without Math.log
  const mean = total / scores.length;
  const deviationSum = scores.reduce((s, v) => s + Math.abs(v - mean), 0);
  const giniLike = mean > 0 ? deviationSum / (2 * scores.length * mean) : 0;
  const concentrationBonus = giniLike; // high gini = concentrated distribution

  const score = dominanceRatio * 65 + gapRatio * 25 + concentrationBonus * 10;
  return clamp(Math.round(score));
}

// ─── Intent alignment sub-score ───────────────────────────────────────────────

/**
 * Measures whether retrieved evidence type and pattern match the intent.
 *
 * Intent → expected evidence classes:
 *   bug_fix:     code required, graph helpful
 *   new_feature: spec + code required, graph helpful
 *   refactor:    code + graph required
 *   dep_update:  code + graph required
 *   config_infra:code required, spec helpful
 *   unknown:     no expectation (score = 0)
 *
 * Intent → good patterns:
 *   bug_fix:     1:1 or 1:chain (targeted fix)
 *   new_feature: 1:chain (insertion point in existing chain)
 *   refactor:    1:chain (touching a chain of dependent modules)
 *   dep_update:  1:chain
 *   config_infra:1:1 (targeted config change)
 */

const INTENT_IDEAL_CLASSES: Record<string, string[]> = {
  bug_fix:      ['code'],
  new_feature:  ['spec', 'code'],
  refactor:     ['code', 'graph'],
  dep_update:   ['code', 'graph'],
  config_infra: ['code', 'spec'],
  quick_fix:    ['code'],
  unknown:      [],
};

// Pattern alignment multiplier per intent [0..1]
const PATTERN_ALIGNMENT: Record<string, Record<string, number>> = {
  bug_fix: {
    '1:1': 1.00, '1:chain': 0.88, 'ambiguous': 0.45, '1:scattered': 0.10, 'unknown': 0.35,
  },
  new_feature: {
    '1:1': 0.85, '1:chain': 1.00, 'ambiguous': 0.55, '1:scattered': 0.15, 'unknown': 0.35,
  },
  refactor: {
    '1:1': 0.70, '1:chain': 1.00, 'ambiguous': 0.45, '1:scattered': 0.10, 'unknown': 0.35,
  },
  dep_update: {
    '1:1': 0.80, '1:chain': 0.95, 'ambiguous': 0.40, '1:scattered': 0.05, 'unknown': 0.35,
  },
  config_infra: {
    '1:1': 1.00, '1:chain': 0.80, 'ambiguous': 0.50, '1:scattered': 0.05, 'unknown': 0.45,
  },
  quick_fix: {
    '1:1': 1.00, '1:chain': 0.90, 'ambiguous': 0.45, '1:scattered': 0.10, 'unknown': 0.35,
  },
};

export function computeIntentAlignmentScore(opts: {
  intent: string;
  mappingPattern: string;
  retrievedEvidenceClasses: string[];
  requiredEvidenceClasses: string[];
}): number {
  const { intent, mappingPattern, retrievedEvidenceClasses, requiredEvidenceClasses } = opts;

  if (intent === 'unknown') return 0;

  // Required evidence coverage ratio
  const requiredCoverage = requiredEvidenceClasses.length > 0
    ? requiredEvidenceClasses.filter(c => retrievedEvidenceClasses.includes(c)).length /
      requiredEvidenceClasses.length
    : 0.5;  // no requirements = neutral

  // Ideal evidence class alignment
  const idealClasses = INTENT_IDEAL_CLASSES[intent] ?? [];
  const idealCoverage = idealClasses.length > 0
    ? idealClasses.filter(c => retrievedEvidenceClasses.includes(c)).length / idealClasses.length
    : 0.5;

  // Pattern alignment multiplier for this intent
  const patternMap  = PATTERN_ALIGNMENT[intent] ?? {};
  const patternMult = patternMap[mappingPattern] ?? 0.40;

  const score = requiredCoverage * 40 + idealCoverage * 30 + patternMult * 30;
  return clamp(Math.round(score));
}

// ─── Hard-block detection ─────────────────────────────────────────────────────

/**
 * Evaluate hard-block conditions.
 *
 * Any hard-block condition forces level='block', regardless of weighted score.
 * These conditions indicate the system is effectively blind for this request.
 *
 * Returns { hardBlock: boolean; reason?: string }
 */
function checkHardBlock(input: MappingQualityInput): { hardBlock: boolean; reason?: string } {
  const { mappingPattern, primaryCandidateScore, allCandidateScores,
          scopedCandidateCount, outOfScopeCandidateCount, disconnectedClusterCount } = input;

  // 1. Completely blind: no candidates at all
  if (allCandidateScores.length === 0 && primaryCandidateScore === 0) {
    return { hardBlock: true, reason: 'No mapping candidates retrieved — system is blind for this request.' };
  }

  // 2. Scattered pattern with no primary candidate
  if (mappingPattern === '1:scattered' && primaryCandidateScore === 0) {
    return { hardBlock: true, reason: 'Scattered pattern with no primary candidate — no safe execution target.' };
  }

  // 3. All evidence is outside the requested scope (and there is a scope to match)
  if (outOfScopeCandidateCount > 0 && scopedCandidateCount === 0 && input.requestedScopeCount > 0) {
    return {
      hardBlock: true,
      reason: `All ${outOfScopeCandidateCount} candidate(s) are outside the requested scope — no scoped evidence found.`,
    };
  }

  // 4. Scattered pattern with maximum fragmentation (> 3 clusters)
  if (mappingPattern === '1:scattered' && disconnectedClusterCount > 3) {
    return {
      hardBlock: true,
      reason: `Scattered pattern with ${disconnectedClusterCount} disconnected clusters — structural coherence at minimum floor.`,
    };
  }

  return { hardBlock: false };
}

// ─── Primary path builder ─────────────────────────────────────────────────────

function buildPrimaryPath(input: MappingQualityInput): PrimaryMappingPath | undefined {
  if (input.primaryCandidateScore === 0 && input.allCandidateScores.length === 0) {
    return undefined;
  }

  const paths = input.knownScopePaths ?? [];
  const entrypoints = paths.slice(0, 2);
  const scoped_targets = paths.length > 0 ? paths : input.retrievedEvidenceClasses.map(c => `[${c}]`);

  return {
    entrypoints,
    scoped_targets,
    bridge_nodes: [],
    supporting_evidence_ids: input.retrievedEvidenceClasses.map(c => `evidence:${c}`),
    path_confidence: Math.min(1, input.primaryCandidateScore),
  };
}

function buildAlternates(input: MappingQualityInput): AlternateMappingPath[] {
  if (input.alternateCandidateScore < 0.30 || input.allCandidateScores.length < 2) {
    return [];
  }

  // Report the second candidate as an alternate
  return [{
    targets: [],
    score: input.alternateCandidateScore,
    reason: `Alternate candidate scored ${(input.alternateCandidateScore * 100).toFixed(0)}% relative to primary (${(input.primaryCandidateScore * 100).toFixed(0)}%). Not selected due to lower structural confidence.`,
  }];
}

// ─── scoreMappingQuality ──────────────────────────────────────────────────────

/**
 * Compute the quantitative mapping quality result.
 *
 * @param input  - Normalized MappingQualityInput (from buildMappingQualityInput)
 * @returns      MappingQualityResult with score, level, hard_block, breakdown, reasons
 */
export function scoreMappingQuality(input: MappingQualityInput): MappingQualityResult {
  // ── Hard-block check first ─────────────────────────────────────────────────
  const { hardBlock, reason: hardBlockReason } = checkHardBlock(input);

  // ── Sub-metrics ───────────────────────────────────────────────────────────
  const scopeAlignment = computeScopeAlignmentScore({
    matchedScopeCount:        input.matchedScopeCount,
    requestedScopeCount:      input.requestedScopeCount,
    scopedCandidateCount:     input.scopedCandidateCount,
    outOfScopeCandidateCount: input.outOfScopeCandidateCount,
    mappingPattern:           input.mappingPattern,
  });

  const structuralCoherence = computeStructuralCoherenceScore({
    mappingPattern:           input.mappingPattern,
    disconnectedClusterCount: input.disconnectedClusterCount,
    primaryCandidateScore:    input.primaryCandidateScore,
    graphDepthAchieved:       0,  // not available at this level; evaluator has it via DimensionSignals
  });

  const evidenceConcentration = computeEvidenceConcentrationScore({
    allCandidateScores:      input.allCandidateScores,
    primaryCandidateScore:   input.primaryCandidateScore,
    alternateCandidateScore: input.alternateCandidateScore,
  });

  const intentAlignment = computeIntentAlignmentScore({
    intent:                   input.intent,
    mappingPattern:           input.mappingPattern,
    retrievedEvidenceClasses: input.retrievedEvidenceClasses,
    requiredEvidenceClasses:  input.requiredEvidenceClasses,
  });

  const breakdown: MappingQualityBreakdown = {
    scope_alignment:         clamp(scopeAlignment),
    structural_coherence:    clamp(structuralCoherence),
    evidence_concentration:  clamp(evidenceConcentration),
    intent_alignment:        clamp(intentAlignment),
  };

  // ── Composite score ───────────────────────────────────────────────────────
  const { scope_alignment: wa, structural_coherence: ws, evidence_concentration: we, intent_alignment: wi } = SUB_METRIC_WEIGHTS;
  const rawScore =
    breakdown.scope_alignment      * wa +
    breakdown.structural_coherence * ws +
    breakdown.evidence_concentration * we +
    breakdown.intent_alignment     * wi;

  // Force hard-block score ceiling
  const compositeScore = hardBlock
    ? Math.min(Math.round(rawScore), 54)
    : Math.round(rawScore);

  const score = clamp(compositeScore);

  // ── Level classification ──────────────────────────────────────────────────
  const thresholds = getMappingThresholds(input.intent);

  let level: MappingQualityResult['level'];
  if (hardBlock) {
    level = 'block';
  } else if (score >= thresholds.pass) {
    level = 'pass';
  } else if (score >= thresholds.warn) {
    level = 'warn';
  } else if (score >= thresholds.escalate) {
    level = 'escalate';
  } else {
    level = 'block';
  }

  // ── Reason generation ─────────────────────────────────────────────────────
  const partialResult: Omit<MappingQualityResult, 'reasons' | 'primary_mapping' | 'alternates'> = {
    score,
    level,
    hard_block: hardBlock,
    breakdown,
  };

  const reasons = generateMappingReasons({
    ...partialResult,
    reasons: hardBlockReason ? [hardBlockReason] : [],
  });

  return {
    ...partialResult,
    reasons,
    primary_mapping: buildPrimaryPath(input),
    alternates:      buildAlternates(input),
  };
}
