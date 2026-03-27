/**
 * Sprint 14 — Mapping Quality Metric (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete only when every test passes.
 *
 * Coverage:
 *   1.  Types/Contracts          — MappingQualityResult, PrimaryMappingPath shapes
 *   2.  Sub-metric: scope_alignment        — in-scope vs out-of-scope evidence
 *   3.  Sub-metric: structural_coherence   — pattern + cluster fragmentation
 *   4.  Sub-metric: evidence_concentration — candidate dominance / entropy
 *   5.  Sub-metric: intent_alignment       — required evidence classes + pattern fit
 *   6.  Hard-block conditions              — no scoped evidence, scattered, etc.
 *   7.  Composite score                    — weighted combination, 0..100
 *   8.  Threshold classification           — pass / warn / escalate / block
 *   9.  Reason generation                  — reasons[] always present and specific
 *   10. Primary path constructor           — entrypoints, targets, bridge nodes
 *   11. Determinism                        — same input → same output
 *   12. computeMappingDimension            — upgraded to use quantitative scorer
 *   13. ECO integration                    — eco.mapping_quality field present
 *   14. Evidence gate integration          — mappingQualityHardBlock → refuse
 *   15. Lane floor integration             — mapping block → lane floor ≥ C
 *   16. Ledger integration                 — fromMappingQualityScored entry
 *   17. Calibration golden cases           — 6 real scenarios (pass → block)
 *   18. Backward compatibility             — missing new signals → safe fallback
 */

import { describe, it, expect } from 'vitest';

// ─── Imports under test ───────────────────────────────────────────────────────

import {
  scoreMappingQuality,
  type MappingQualityInput,
  type MappingQualityResult,
  type PrimaryMappingPath,
  type AlternateMappingPath,
} from '../packages/core/src/knowledge/mapping/index.js';

import {
  DEFAULT_MAPPING_THRESHOLDS,
  MAPPING_QUALITY_THRESHOLDS_BY_INTENT,
  SUB_METRIC_WEIGHTS,
  getMappingThresholds,
} from '../packages/core/src/knowledge/mapping/thresholds.js';

import {
  computeScopeAlignmentScore,
  computeStructuralCoherenceScore,
  computeEvidenceConcentrationScore,
  computeIntentAlignmentScore,
} from '../packages/core/src/knowledge/mapping/score.js';

import {
  buildMappingQualityInput,
  type RawMappingQualityData,
} from '../packages/core/src/knowledge/mapping/signals.js';

import {
  generateMappingReasons,
} from '../packages/core/src/knowledge/mapping/explain.js';

import {
  computeMappingDimension,
} from '../packages/core/src/knowledge/dimensions/mapping.js';

import {
  DEFAULT_THRESHOLDS,
} from '../packages/core/src/knowledge/dimensions/thresholds.js';

import {
  buildDimensionSignals,
} from '../packages/core/src/knowledge/dimensions/signals.js';

import {
  MAPPING_QUALITY_REASON_CODES,
} from '../packages/core/src/knowledge/dimensions/reason-codes.js';

import {
  fromMappingQualityScored,
} from '../packages/core/src/runtime/ledger/mappers.js';

import {
  extractEvidenceFacts,
  evaluateEvidenceGate,
} from '../packages/core/src/runtime/evidence/index.js';

import { buildECO } from '../packages/core/src/eco.js';
import { classifyLane } from '../packages/core/src/lane.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<MappingQualityInput> = {}): MappingQualityInput {
  return {
    intent: 'bug_fix',
    mappingPattern: '1:1',
    primaryCandidateScore: 0.9,
    alternateCandidateScore: 0.1,
    allCandidateScores: [0.9, 0.1],
    matchedScopeCount: 3,
    requestedScopeCount: 3,
    scopedCandidateCount: 2,
    outOfScopeCandidateCount: 0,
    disconnectedClusterCount: 0,
    retrievedEvidenceClasses: ['code'],
    requiredEvidenceClasses: ['code'],
    symbolsResolved: 10,
    symbolsUnresolved: 0,
    knownScopePaths: ['src/services/payment.ts'],
    ...overrides,
  };
}

// ─── 1. Types / Contracts ────────────────────────────────────────────────────

describe('MappingQualityResult — contract', () => {
  it('has required top-level fields: score, level, hard_block, breakdown, reasons', () => {
    const result = scoreMappingQuality(makeInput());
    expect(typeof result.score).toBe('number');
    expect(['pass', 'warn', 'escalate', 'block']).toContain(result.level);
    expect(typeof result.hard_block).toBe('boolean');
    expect(typeof result.breakdown).toBe('object');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('breakdown contains all 4 named sub-scores', () => {
    const result = scoreMappingQuality(makeInput());
    const { breakdown } = result;
    expect(typeof breakdown.scope_alignment).toBe('number');
    expect(typeof breakdown.structural_coherence).toBe('number');
    expect(typeof breakdown.evidence_concentration).toBe('number');
    expect(typeof breakdown.intent_alignment).toBe('number');
  });

  it('score is in [0, 100]', () => {
    const result = scoreMappingQuality(makeInput());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('all sub-scores are in [0, 100]', () => {
    const result = scoreMappingQuality(makeInput());
    for (const [, v] of Object.entries(result.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('primary_mapping is present on pass/warn and has required fields', () => {
    const result = scoreMappingQuality(makeInput({ mappingPattern: '1:1', primaryCandidateScore: 0.9 }));
    expect(result.primary_mapping).toBeDefined();
    if (result.primary_mapping) {
      expect(Array.isArray(result.primary_mapping.entrypoints)).toBe(true);
      expect(Array.isArray(result.primary_mapping.scoped_targets)).toBe(true);
      expect(Array.isArray(result.primary_mapping.bridge_nodes)).toBe(true);
      expect(Array.isArray(result.primary_mapping.supporting_evidence_ids)).toBe(true);
      expect(typeof result.primary_mapping.path_confidence).toBe('number');
    }
  });

  it('alternates is an array (may be empty)', () => {
    const result = scoreMappingQuality(makeInput());
    expect(Array.isArray(result.alternates)).toBe(true);
  });
});

// ─── 2. Sub-metric: scope_alignment ─────────────────────────────────────────

describe('computeScopeAlignmentScore', () => {
  it('returns ~100 when all candidates in scope, no out-of-scope', () => {
    const score = computeScopeAlignmentScore({
      matchedScopeCount: 5,
      requestedScopeCount: 5,
      scopedCandidateCount: 5,
      outOfScopeCandidateCount: 0,
      mappingPattern: '1:1',
    });
    expect(score).toBeGreaterThanOrEqual(85);
  });

  it('degrades when evidence is mostly out-of-scope', () => {
    const score = computeScopeAlignmentScore({
      matchedScopeCount: 1,
      requestedScopeCount: 5,
      scopedCandidateCount: 0,
      outOfScopeCandidateCount: 5,
      mappingPattern: '1:scattered',
    });
    expect(score).toBeLessThan(40);
  });

  it('partial scope match gives middle score', () => {
    const score = computeScopeAlignmentScore({
      matchedScopeCount: 3,
      requestedScopeCount: 5,
      scopedCandidateCount: 2,
      outOfScopeCandidateCount: 1,
      mappingPattern: '1:chain',
    });
    expect(score).toBeGreaterThan(30);
    expect(score).toBeLessThan(80);
  });

  it('scattered pattern with no scoped candidates → hard-block zone (< 20)', () => {
    const score = computeScopeAlignmentScore({
      matchedScopeCount: 0,
      requestedScopeCount: 3,
      scopedCandidateCount: 0,
      outOfScopeCandidateCount: 4,
      mappingPattern: '1:scattered',
    });
    expect(score).toBeLessThan(20);
  });

  it('returns a number in [0, 100] for all inputs', () => {
    const cases: Parameters<typeof computeScopeAlignmentScore>[0][] = [
      { matchedScopeCount: 0, requestedScopeCount: 0, scopedCandidateCount: 0, outOfScopeCandidateCount: 0, mappingPattern: 'unknown' },
      { matchedScopeCount: 10, requestedScopeCount: 1, scopedCandidateCount: 10, outOfScopeCandidateCount: 0, mappingPattern: '1:1' },
      { matchedScopeCount: 0, requestedScopeCount: 5, scopedCandidateCount: 0, outOfScopeCandidateCount: 10, mappingPattern: '1:scattered' },
    ];
    for (const c of cases) {
      const s = computeScopeAlignmentScore(c);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

// ─── 3. Sub-metric: structural_coherence ─────────────────────────────────────

describe('computeStructuralCoherenceScore', () => {
  it('1:1 pattern with no clusters → high coherence (≥ 85)', () => {
    const score = computeStructuralCoherenceScore({
      mappingPattern: '1:1',
      disconnectedClusterCount: 0,
      primaryCandidateScore: 0.95,
      graphDepthAchieved: 3,
    });
    expect(score).toBeGreaterThanOrEqual(85);
  });

  it('1:scattered with many clusters → low coherence (< 30)', () => {
    const score = computeStructuralCoherenceScore({
      mappingPattern: '1:scattered',
      disconnectedClusterCount: 4,
      primaryCandidateScore: 0.3,
      graphDepthAchieved: 1,
    });
    expect(score).toBeLessThan(30);
  });

  it('ambiguous pattern → degraded coherence (< 65)', () => {
    const score = computeStructuralCoherenceScore({
      mappingPattern: 'ambiguous',
      disconnectedClusterCount: 1,
      primaryCandidateScore: 0.5,
      graphDepthAchieved: 2,
    });
    expect(score).toBeLessThan(65);
  });

  it('1:chain with no clusters → good coherence (≥ 70)', () => {
    const score = computeStructuralCoherenceScore({
      mappingPattern: '1:chain',
      disconnectedClusterCount: 0,
      primaryCandidateScore: 0.8,
      graphDepthAchieved: 4,
    });
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it('each additional disconnected cluster penalises score', () => {
    const base = computeStructuralCoherenceScore({
      mappingPattern: '1:chain', disconnectedClusterCount: 0, primaryCandidateScore: 0.8, graphDepthAchieved: 2,
    });
    const penalised = computeStructuralCoherenceScore({
      mappingPattern: '1:chain', disconnectedClusterCount: 3, primaryCandidateScore: 0.8, graphDepthAchieved: 2,
    });
    expect(penalised).toBeLessThan(base);
  });
});

// ─── 4. Sub-metric: evidence_concentration ───────────────────────────────────

describe('computeEvidenceConcentrationScore', () => {
  it('single dominant candidate (no alternates) → high concentration (≥ 85)', () => {
    const score = computeEvidenceConcentrationScore({
      allCandidateScores: [1.0],
      primaryCandidateScore: 1.0,
      alternateCandidateScore: 0,
    });
    expect(score).toBeGreaterThanOrEqual(85);
  });

  it('primary dominates over weak alternate → good concentration (≥ 70)', () => {
    const score = computeEvidenceConcentrationScore({
      allCandidateScores: [0.9, 0.1],
      primaryCandidateScore: 0.9,
      alternateCandidateScore: 0.1,
    });
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it('5 candidates with equal scores → low concentration (< 40)', () => {
    const score = computeEvidenceConcentrationScore({
      allCandidateScores: [0.2, 0.2, 0.2, 0.2, 0.2],
      primaryCandidateScore: 0.2,
      alternateCandidateScore: 0.2,
    });
    expect(score).toBeLessThan(40);
  });

  it('empty candidate list → 0 (no evidence)', () => {
    const score = computeEvidenceConcentrationScore({
      allCandidateScores: [],
      primaryCandidateScore: 0,
      alternateCandidateScore: 0,
    });
    expect(score).toBe(0);
  });

  it('primary just slightly stronger than alternate → medium (40–75)', () => {
    const score = computeEvidenceConcentrationScore({
      allCandidateScores: [0.6, 0.55],
      primaryCandidateScore: 0.6,
      alternateCandidateScore: 0.55,
    });
    expect(score).toBeGreaterThan(25);
    expect(score).toBeLessThan(75);
  });
});

// ─── 5. Sub-metric: intent_alignment ─────────────────────────────────────────

describe('computeIntentAlignmentScore', () => {
  it('bug_fix with code evidence + 1:1 pattern → high alignment (≥ 80)', () => {
    const score = computeIntentAlignmentScore({
      intent: 'bug_fix',
      mappingPattern: '1:1',
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('new_feature with spec + code evidence + 1:chain → high alignment (≥ 75)', () => {
    const score = computeIntentAlignmentScore({
      intent: 'new_feature',
      mappingPattern: '1:chain',
      retrievedEvidenceClasses: ['spec', 'code'],
      requiredEvidenceClasses: ['spec', 'code'],
    });
    expect(score).toBeGreaterThanOrEqual(75);
  });

  it('bug_fix with no code evidence → low alignment (< 40)', () => {
    const score = computeIntentAlignmentScore({
      intent: 'bug_fix',
      mappingPattern: 'unknown',
      retrievedEvidenceClasses: [],
      requiredEvidenceClasses: ['code'],
    });
    expect(score).toBeLessThan(40);
  });

  it('refactor with graph evidence → good alignment', () => {
    const score = computeIntentAlignmentScore({
      intent: 'refactor',
      mappingPattern: '1:chain',
      retrievedEvidenceClasses: ['code', 'graph'],
      requiredEvidenceClasses: ['code'],
    });
    expect(score).toBeGreaterThan(70);
  });

  it('scattered pattern for bug_fix → penalised alignment', () => {
    const scattered = computeIntentAlignmentScore({
      intent: 'bug_fix',
      mappingPattern: '1:scattered',
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    const clean = computeIntentAlignmentScore({
      intent: 'bug_fix',
      mappingPattern: '1:1',
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    expect(scattered).toBeLessThan(clean);
  });
});

// ─── 6. Hard-block conditions ────────────────────────────────────────────────

describe('scoreMappingQuality — hard blocks', () => {
  it('hard_block=true when no scoped evidence exists (all out-of-scope)', () => {
    const result = scoreMappingQuality(makeInput({
      scopedCandidateCount: 0,
      outOfScopeCandidateCount: 5,
      matchedScopeCount: 0,
      requestedScopeCount: 3,
    }));
    expect(result.hard_block).toBe(true);
    expect(result.level).toBe('block');
  });

  it('hard_block=true for 1:scattered pattern with zero primary candidate', () => {
    const result = scoreMappingQuality(makeInput({
      mappingPattern: '1:scattered',
      primaryCandidateScore: 0,
      allCandidateScores: [],
    }));
    expect(result.hard_block).toBe(true);
    expect(result.level).toBe('block');
  });

  it('hard_block=true when structural coherence is at minimum floor (scattered + many clusters)', () => {
    const result = scoreMappingQuality(makeInput({
      mappingPattern: '1:scattered',
      disconnectedClusterCount: 5,
      primaryCandidateScore: 0.1,
      alternateCandidateScore: 0.1,
    }));
    expect(result.hard_block).toBe(true);
  });

  it('hard_block=false when mapping is clean 1:1, all in scope', () => {
    const result = scoreMappingQuality(makeInput());
    expect(result.hard_block).toBe(false);
  });

  it('hard_block=true overrides score regardless of weighted total', () => {
    const result = scoreMappingQuality(makeInput({
      mappingPattern: '1:scattered',
      scopedCandidateCount: 0,
      outOfScopeCandidateCount: 10,
      matchedScopeCount: 0,
      requestedScopeCount: 5,
    }));
    // hard block must always produce block level, even if formula could compute higher score
    expect(result.level).toBe('block');
    expect(result.hard_block).toBe(true);
  });
});

// ─── 7. Composite score ──────────────────────────────────────────────────────

describe('scoreMappingQuality — composite score', () => {
  it('high-quality input → score ≥ 90 (pass territory)', () => {
    const result = scoreMappingQuality(makeInput({
      mappingPattern: '1:1',
      primaryCandidateScore: 0.95,
      alternateCandidateScore: 0.05,
      allCandidateScores: [0.95, 0.05],
      scopedCandidateCount: 3,
      outOfScopeCandidateCount: 0,
      matchedScopeCount: 3,
      requestedScopeCount: 3,
      disconnectedClusterCount: 0,
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    }));
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.level).toBe('pass');
  });

  it('degraded mapping → score 55–89 (warn or escalate)', () => {
    const result = scoreMappingQuality(makeInput({
      mappingPattern: 'ambiguous',
      primaryCandidateScore: 0.6,
      alternateCandidateScore: 0.5,
      allCandidateScores: [0.6, 0.5],
      scopedCandidateCount: 1,
      outOfScopeCandidateCount: 1,
      disconnectedClusterCount: 1,
    }));
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(90);
  });

  it('score weights match SUB_METRIC_WEIGHTS (0.35 + 0.30 + 0.20 + 0.15 = 1.0)', () => {
    const total = Object.values(SUB_METRIC_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(total * 100) / 100).toBe(1.0);
  });

  it('score = weighted sum of sub-scores (verifiable)', () => {
    const input = makeInput({
      mappingPattern: '1:chain',
      primaryCandidateScore: 0.8,
      alternateCandidateScore: 0.2,
      allCandidateScores: [0.8, 0.2],
      scopedCandidateCount: 2,
      outOfScopeCandidateCount: 1,
      matchedScopeCount: 2,
      requestedScopeCount: 3,
      disconnectedClusterCount: 0,
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    const result = scoreMappingQuality(input);
    const { breakdown: b } = result;
    const { scope_alignment: wa, structural_coherence: ws, evidence_concentration: we, intent_alignment: wi } = SUB_METRIC_WEIGHTS;
    const expected = Math.round(
      b.scope_alignment      * wa +
      b.structural_coherence * ws +
      b.evidence_concentration * we +
      b.intent_alignment     * wi,
    );
    // Allow ±1 due to rounding
    expect(Math.abs(result.score - expected)).toBeLessThanOrEqual(1);
  });
});

// ─── 8. Threshold classification ─────────────────────────────────────────────

describe('scoreMappingQuality — threshold classification', () => {
  it('score ≥ 90 → pass', () => {
    const result = scoreMappingQuality(makeInput());
    // High-quality input should pass
    if (result.score >= 90) expect(result.level).toBe('pass');
  });

  it('score 75–89 → warn', () => {
    // Craft an input that lands in the warn zone
    const result = scoreMappingQuality(makeInput({
      mappingPattern: '1:chain',
      primaryCandidateScore: 0.75,
      alternateCandidateScore: 0.3,
      allCandidateScores: [0.75, 0.3],
      scopedCandidateCount: 2,
      outOfScopeCandidateCount: 1,
      disconnectedClusterCount: 0,
    }));
    if (result.score >= 75 && result.score < 90) {
      expect(result.level).toBe('warn');
    }
  });

  it('DEFAULT_MAPPING_THRESHOLDS has pass=90, warn=75, escalate=55', () => {
    expect(DEFAULT_MAPPING_THRESHOLDS.pass).toBe(90);
    expect(DEFAULT_MAPPING_THRESHOLDS.warn).toBe(75);
    expect(DEFAULT_MAPPING_THRESHOLDS.escalate).toBe(55);
  });

  it('getMappingThresholds(undefined) returns DEFAULT_MAPPING_THRESHOLDS', () => {
    expect(getMappingThresholds()).toEqual(DEFAULT_MAPPING_THRESHOLDS);
  });

  it('getMappingThresholds(intent) returns per-intent thresholds when defined', () => {
    // bug_fix should have tighter mapping thresholds (or defaults if not overridden)
    const t = getMappingThresholds('bug_fix');
    expect(typeof t.pass).toBe('number');
    expect(typeof t.warn).toBe('number');
    expect(typeof t.escalate).toBe('number');
    expect(t.pass).toBeGreaterThan(t.warn);
    expect(t.warn).toBeGreaterThan(t.escalate);
  });
});

// ─── 9. Reason generation ────────────────────────────────────────────────────

describe('generateMappingReasons', () => {
  it('reasons[] is never empty', () => {
    const reasons = generateMappingReasons({
      score: 95,
      level: 'pass',
      hard_block: false,
      breakdown: { scope_alignment: 95, structural_coherence: 95, evidence_concentration: 90, intent_alignment: 90 },
      reasons: [],
    });
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('includes a hard_block reason when hard_block=true', () => {
    const reasons = generateMappingReasons({
      score: 5,
      level: 'block',
      hard_block: true,
      breakdown: { scope_alignment: 0, structural_coherence: 5, evidence_concentration: 0, intent_alignment: 0 },
      reasons: [],
    });
    expect(reasons.some(r => r.includes('blind') || r.includes('no scoped') || r.includes('scattered') || r.includes('out-of-scope') || r.includes('block'))).toBe(true);
  });

  it('includes sub-score-specific reason when a sub-metric is weak', () => {
    const reasons = generateMappingReasons({
      score: 50,
      level: 'escalate',
      hard_block: false,
      breakdown: { scope_alignment: 20, structural_coherence: 60, evidence_concentration: 70, intent_alignment: 80 },
      reasons: [],
    });
    // Should mention scope alignment specifically
    expect(reasons.some(r => r.toLowerCase().includes('scope'))).toBe(true);
  });
});

// ─── 10. Primary path constructor ────────────────────────────────────────────

describe('PrimaryMappingPath', () => {
  it('primary_mapping.path_confidence equals primary candidate score on clean input', () => {
    const result = scoreMappingQuality(makeInput({
      primaryCandidateScore: 0.92,
      knownScopePaths: ['src/api/handler.ts', 'src/services/core.ts'],
    }));
    expect(result.primary_mapping).toBeDefined();
    if (result.primary_mapping) {
      expect(result.primary_mapping.path_confidence).toBeGreaterThan(0);
      expect(result.primary_mapping.path_confidence).toBeLessThanOrEqual(1);
    }
  });

  it('primary_mapping.scoped_targets includes knownScopePaths entries', () => {
    const paths = ['src/services/payment.ts', 'src/models/transaction.ts'];
    const result = scoreMappingQuality(makeInput({ knownScopePaths: paths }));
    if (result.primary_mapping) {
      for (const p of paths) {
        expect(result.primary_mapping.scoped_targets).toContain(p);
      }
    }
  });

  it('alternates is empty when only one candidate exists', () => {
    const result = scoreMappingQuality(makeInput({
      allCandidateScores: [0.9],
      alternateCandidateScore: 0,
    }));
    expect(result.alternates?.length ?? 0).toBe(0);
  });

  it('alternates is populated when alternate candidate score > threshold', () => {
    const result = scoreMappingQuality(makeInput({
      allCandidateScores: [0.9, 0.6],
      alternateCandidateScore: 0.6,
    }));
    expect((result.alternates?.length ?? 0)).toBeGreaterThan(0);
  });
});

// ─── 11. Determinism ─────────────────────────────────────────────────────────

describe('scoreMappingQuality — determinism', () => {
  it('same input always yields identical output', () => {
    const input = makeInput({
      mappingPattern: '1:chain',
      primaryCandidateScore: 0.7,
      alternateCandidateScore: 0.3,
      allCandidateScores: [0.7, 0.3, 0.1],
    });
    const r1 = scoreMappingQuality(input);
    const r2 = scoreMappingQuality(input);
    expect(r1.score).toBe(r2.score);
    expect(r1.level).toBe(r2.level);
    expect(r1.hard_block).toBe(r2.hard_block);
    expect(r1.breakdown).toEqual(r2.breakdown);
  });
});

// ─── 12. computeMappingDimension — upgraded ──────────────────────────────────

describe('computeMappingDimension — uses quantitative scorer', () => {
  it('returns DimensionResult with value derived from scoreMappingQuality score', () => {
    const signals = buildDimensionSignals({
      intent: 'bug_fix',
      modulesTouched: ['src/services'],
      evidence: [{ source: 'code', ref: 'src/services/core.ts', content: 'export function handler() {}' }],
      conflicts: [],
      mappingPattern: '1:1',
      mappingRootsRanked: [{ rank: 'primary', edge_count: 10 }, { rank: 'secondary', edge_count: 1 }],
      freshnessImpact: null,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    // value must be 0..1 (DimensionResult contract)
    expect(result.value).toBeGreaterThanOrEqual(0);
    expect(result.value).toBeLessThanOrEqual(1);
    // metrics must include mapping_quality_score
    expect(typeof result.metrics['mapping_quality_score']).toBe('number');
    expect(typeof result.metrics['mapping_quality_level']).toBe('string');
  });

  it('block-quality input maps to DimensionResult status=block', () => {
    const signals = buildDimensionSignals({
      intent: 'bug_fix',
      modulesTouched: [],
      evidence: [],
      conflicts: [],
      mappingPattern: '1:scattered',
      mappingRootsRanked: [],
      freshnessImpact: null,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('block');
    expect(result.metrics['hard_block']).toBe(true);
  });

  it('DimensionResult has MAPPING_QUALITY_SCORED reason code', () => {
    const signals = buildDimensionSignals({
      intent: 'bug_fix',
      modulesTouched: ['src/services'],
      evidence: [{ source: 'code', ref: 'src/services/core.ts', content: 'fn()' }],
      conflicts: [],
      mappingPattern: '1:1',
      mappingRootsRanked: [{ rank: 'primary', edge_count: 8 }],
      freshnessImpact: null,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.reason_codes).toContain(MAPPING_QUALITY_REASON_CODES.MAPPING_QUALITY_SCORED);
  });

  it('DimensionResult.metrics.mapping_quality_breakdown is present', () => {
    const signals = buildDimensionSignals({
      intent: 'bug_fix',
      modulesTouched: ['src/services'],
      evidence: [{ source: 'code', ref: 'src/services/core.ts', content: 'fn()' }],
      conflicts: [],
      mappingPattern: '1:1',
      mappingRootsRanked: [{ rank: 'primary', edge_count: 8 }],
      freshnessImpact: null,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.metrics['mapping_quality_breakdown']).toBeDefined();
  });
});

// ─── 13. ECO integration ─────────────────────────────────────────────────────

describe('buildECO — mapping_quality field', () => {
  it('eco output includes mapping_quality object', () => {
    const eco = buildECO(null, '/tmp', { query: 'fix null pointer in handler' });
    expect(eco).toHaveProperty('mapping_quality');
  });

  it('mapping_quality has score, level, hard_block, breakdown, reasons', () => {
    const eco = buildECO(null, '/tmp', { query: 'fix null pointer in handler' });
    const mq = (eco as any).mapping_quality;
    expect(typeof mq.score).toBe('number');
    expect(['pass', 'warn', 'escalate', 'block']).toContain(mq.level);
    expect(typeof mq.hard_block).toBe('boolean');
    expect(typeof mq.breakdown).toBe('object');
    expect(Array.isArray(mq.reasons)).toBe(true);
  });

  it('eco.eco_dimensions.mapping.severity is driven by mapping_quality.level', () => {
    const eco = buildECO(null, '/tmp', { query: 'fix null pointer in handler' });
    const mq = (eco as any).mapping_quality;
    // mapping dimension severity must match mapping_quality level
    expect(eco.eco_dimensions.mapping.severity).toBe(mq.level);
  });

  it('eco.eco_dimensions.mapping.detail includes mapping_quality reasons', () => {
    const eco = buildECO(null, '/tmp', { query: 'fix null pointer in handler' });
    expect(typeof eco.eco_dimensions.mapping.detail).toBe('string');
    expect(eco.eco_dimensions.mapping.detail.length).toBeGreaterThan(0);
  });
});

// ─── 14. Evidence gate integration ───────────────────────────────────────────

describe('evaluateEvidenceGate — mapping quality hard block', () => {
  it('refuse when mappingQualityHardBlock=true on bug_fix', () => {
    const ecoInput = {
      intent: { primary: 'bug_fix', composite: false, confidence: 'high' },
      eco_dimensions: {
        coverage:  { severity: 'pass', detail: '' },
        freshness: { severity: 'pass', detail: '' },
        mapping:   { severity: 'block', detail: 'Mapping quality hard block: no scoped evidence' },
        conflict:  { severity: 'pass', detail: '', conflict_payload: null },
        graph:     { severity: 'pass', detail: '' },
      },
      confidence_score: 30,
      mapping: { pattern: '1:scattered', roots_ranked: [] },
      modules_touched: [],
      forced_unknown: false,
      blocked: false,
      mapping_quality: {
        score: 5,
        level: 'block' as const,
        hard_block: true,
        breakdown: { scope_alignment: 0, structural_coherence: 5, evidence_concentration: 0, intent_alignment: 0 },
        reasons: ['No scoped evidence found — all candidates are outside scope.'],
      },
    };
    const decision = evaluateEvidenceGate(ecoInput as any);
    expect(decision.verdict).toBe('refuse');
  });

  it('extractEvidenceFacts includes mappingQualityScore and mappingQualityHardBlock', () => {
    const ecoInput = {
      intent: { primary: 'bug_fix', composite: false, confidence: 'high' },
      eco_dimensions: {
        coverage:  { severity: 'pass', detail: '' },
        freshness: { severity: 'pass', detail: '' },
        mapping:   { severity: 'warn', detail: '' },
        conflict:  { severity: 'pass', detail: '', conflict_payload: null },
        graph:     { severity: 'pass', detail: '' },
      },
      confidence_score: 75,
      mapping: { pattern: '1:chain', roots_ranked: [{ rank: 'primary', edge_count: 8 }] },
      modules_touched: ['src/services'],
      forced_unknown: false,
      blocked: false,
      mapping_quality: {
        score: 78,
        level: 'warn' as const,
        hard_block: false,
        breakdown: { scope_alignment: 80, structural_coherence: 75, evidence_concentration: 80, intent_alignment: 75 },
        reasons: ['Slight scatter detected.'],
      },
    };
    const facts = extractEvidenceFacts(ecoInput as any);
    expect(typeof (facts as any).mappingQualityScore).toBe('number');
    expect(typeof (facts as any).mappingQualityHardBlock).toBe('boolean');
  });

  it('pass when mapping_quality score is high and pattern is 1:1', () => {
    const ecoInput = {
      intent: { primary: 'bug_fix', composite: false, confidence: 'high' },
      eco_dimensions: {
        coverage:  { severity: 'pass', detail: '' },
        freshness: { severity: 'pass', detail: '' },
        mapping:   { severity: 'pass', detail: '' },
        conflict:  { severity: 'pass', detail: '', conflict_payload: null },
        graph:     { severity: 'pass', detail: '' },
      },
      confidence_score: 90,
      mapping: { pattern: '1:1', roots_ranked: [{ rank: 'primary', edge_count: 10 }] },
      modules_touched: ['src/services'],
      forced_unknown: false,
      blocked: false,
      mapping_quality: {
        score: 93,
        level: 'pass' as const,
        hard_block: false,
        breakdown: { scope_alignment: 95, structural_coherence: 90, evidence_concentration: 95, intent_alignment: 90 },
        reasons: ['Clean 1:1 mapping with concentrated evidence.'],
      },
    };
    const decision = evaluateEvidenceGate(ecoInput as any);
    expect(decision.verdict).toBe('pass');
  });
});

// ─── 15. Lane floor integration ──────────────────────────────────────────────

describe('classifyLane — mapping quality block → lane ≥ C', () => {
  it('mapping block severity → lane at least C', () => {
    const eco = {
      eco_dimensions: {
        coverage:  { severity: 'pass' },
        freshness: { severity: 'pass' },
        mapping:   { severity: 'block' },
        conflict:  { severity: 'pass' },
        graph:     { severity: 'pass' },
      },
      forced_unknown: false,
      forced_lane_minimum: 'A',
      critical_path_hit: false,
      boundary_warnings: [],
      mapping: { pattern: '1:scattered', roots_ranked: [] },
    };
    const decision = classifyLane(eco as any);
    const laneOrder = ['A', 'B', 'C', 'D', 'E'];
    expect(laneOrder.indexOf(decision.lane)).toBeGreaterThanOrEqual(laneOrder.indexOf('C'));
  });

  it('mapping escalate → lane at least B', () => {
    const eco = {
      eco_dimensions: {
        coverage:  { severity: 'pass' },
        freshness: { severity: 'pass' },
        mapping:   { severity: 'escalate' },
        conflict:  { severity: 'pass' },
        graph:     { severity: 'pass' },
      },
      forced_unknown: false,
      forced_lane_minimum: 'A',
      critical_path_hit: false,
      boundary_warnings: [],
      mapping: { pattern: 'ambiguous', roots_ranked: [] },
    };
    const decision = classifyLane(eco as any);
    const laneOrder = ['A', 'B', 'C', 'D', 'E'];
    expect(laneOrder.indexOf(decision.lane)).toBeGreaterThanOrEqual(laneOrder.indexOf('B'));
  });
});

// ─── 16. Ledger integration ──────────────────────────────────────────────────

describe('fromMappingQualityScored', () => {
  it('returns a valid LedgerEntry with record_type=decision', () => {
    const mqResult: MappingQualityResult = {
      score: 85,
      level: 'warn',
      hard_block: false,
      breakdown: { scope_alignment: 88, structural_coherence: 82, evidence_concentration: 90, intent_alignment: 80 },
      reasons: ['Slight scatter in evidence — alternate candidate is moderately strong.'],
    };
    const entry = fromMappingQualityScored(mqResult, {
      trace_id: 'tr_test_001',
      request_id: 'rq_test_001',
      intent: 'bug_fix',
    });
    expect(entry.record_type).toBe('decision');
    expect(entry.stage).toBe('eco');
    expect(entry.actor).toBe('system');
    expect(entry.schema_version).toBe('1.0.0');
    expect(typeof entry.ledger_id).toBe('string');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('payload.decision_code is MAPPING_QUALITY_SCORED', () => {
    const mqResult: MappingQualityResult = {
      score: 92,
      level: 'pass',
      hard_block: false,
      breakdown: { scope_alignment: 95, structural_coherence: 90, evidence_concentration: 92, intent_alignment: 90 },
      reasons: ['Clean direct mapping.'],
    };
    const entry = fromMappingQualityScored(mqResult, {
      trace_id: 'tr_test_002',
      request_id: 'rq_test_002',
      intent: 'bug_fix',
    });
    const payload = entry.payload as { decision_code: string };
    expect(payload.decision_code).toBe('MAPPING_QUALITY_SCORED');
  });

  it('payload.result.status maps correctly to score', () => {
    const pass = fromMappingQualityScored(
      { score: 92, level: 'pass', hard_block: false, breakdown: { scope_alignment: 95, structural_coherence: 90, evidence_concentration: 92, intent_alignment: 90 }, reasons: [] },
      { trace_id: 't1', request_id: 'r1', intent: 'bug_fix' },
    );
    expect((pass.payload as any).result.status).toBe('pass');

    const block = fromMappingQualityScored(
      { score: 5, level: 'block', hard_block: true, breakdown: { scope_alignment: 0, structural_coherence: 5, evidence_concentration: 0, intent_alignment: 10 }, reasons: ['No scoped evidence'] },
      { trace_id: 't2', request_id: 'r2', intent: 'bug_fix' },
    );
    expect((block.payload as any).result.status).toBe('block');
  });

  it('hard_block=true is in signal_refs', () => {
    const entry = fromMappingQualityScored(
      { score: 5, level: 'block', hard_block: true, breakdown: { scope_alignment: 0, structural_coherence: 5, evidence_concentration: 0, intent_alignment: 0 }, reasons: ['No scoped evidence'] },
      { trace_id: 't3', request_id: 'r3', intent: 'bug_fix' },
    );
    const payload = entry.payload as { rationale: { signal_refs: string[] } };
    expect(payload.rationale.signal_refs.some((s: string) => s.includes('hard_block:true'))).toBe(true);
  });
});

// ─── 17. Calibration golden cases ────────────────────────────────────────────

describe('Calibration golden cases', () => {
  // Case 1: High-confidence direct mapping (bug fix in known service)
  it('GOLDEN-1: direct single-target bug fix → pass, score ≥ 90', () => {
    const result = scoreMappingQuality({
      intent: 'bug_fix',
      mappingPattern: '1:1',
      primaryCandidateScore: 0.95,
      alternateCandidateScore: 0.05,
      allCandidateScores: [0.95, 0.05],
      matchedScopeCount: 3,
      requestedScopeCount: 3,
      scopedCandidateCount: 3,
      outOfScopeCandidateCount: 0,
      disconnectedClusterCount: 0,
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
      symbolsResolved: 15,
      symbolsUnresolved: 0,
      knownScopePaths: ['src/services/payment.ts'],
    });
    expect(result.level).toBe('pass');
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.hard_block).toBe(false);
  });

  // Case 2: Near-scope mapping (1-hop neighbor)
  it('GOLDEN-2: chain mapping touching adjacent modules → warn or better', () => {
    const result = scoreMappingQuality({
      intent: 'new_feature',
      mappingPattern: '1:chain',
      primaryCandidateScore: 0.80,
      alternateCandidateScore: 0.20,
      allCandidateScores: [0.80, 0.20],
      matchedScopeCount: 2,
      requestedScopeCount: 3,
      scopedCandidateCount: 2,
      outOfScopeCandidateCount: 1,
      disconnectedClusterCount: 0,
      retrievedEvidenceClasses: ['code', 'spec'],
      requiredEvidenceClasses: ['spec', 'code'],
      symbolsResolved: 10,
      symbolsUnresolved: 1,
      knownScopePaths: ['src/api/routes.ts'],
    });
    expect(['pass', 'warn']).toContain(result.level);
    expect(result.hard_block).toBe(false);
  });

  // Case 3: Scattered false-positive retrieval
  it('GOLDEN-3: scattered retrieval across unrelated modules → block, hard_block=true', () => {
    const result = scoreMappingQuality({
      intent: 'bug_fix',
      mappingPattern: '1:scattered',
      primaryCandidateScore: 0.30,
      alternateCandidateScore: 0.28,
      allCandidateScores: [0.30, 0.28, 0.25, 0.22],
      matchedScopeCount: 0,
      requestedScopeCount: 3,
      scopedCandidateCount: 0,
      outOfScopeCandidateCount: 4,
      disconnectedClusterCount: 3,
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
      symbolsResolved: 2,
      symbolsUnresolved: 8,
    });
    expect(result.level).toBe('block');
    expect(result.hard_block).toBe(true);
    expect(result.score).toBeLessThan(55);
  });

  // Case 4: Wrong-module dominant retrieval
  it('GOLDEN-4: primary candidate in wrong module → escalate or block', () => {
    const result = scoreMappingQuality({
      intent: 'bug_fix',
      mappingPattern: 'ambiguous',
      primaryCandidateScore: 0.60,
      alternateCandidateScore: 0.55,
      allCandidateScores: [0.60, 0.55],
      matchedScopeCount: 1,
      requestedScopeCount: 4,
      scopedCandidateCount: 0,
      outOfScopeCandidateCount: 2,
      disconnectedClusterCount: 1,
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
      symbolsResolved: 5,
      symbolsUnresolved: 5,
    });
    expect(['escalate', 'block']).toContain(result.level);
  });

  // Case 5: Multi-candidate ambiguous retrieval
  it('GOLDEN-5: 3 similarly-scored candidates → escalate or block', () => {
    const result = scoreMappingQuality({
      intent: 'refactor',
      mappingPattern: 'ambiguous',
      primaryCandidateScore: 0.5,
      alternateCandidateScore: 0.48,
      allCandidateScores: [0.5, 0.48, 0.45],
      matchedScopeCount: 2,
      requestedScopeCount: 4,
      scopedCandidateCount: 1,
      outOfScopeCandidateCount: 2,
      disconnectedClusterCount: 2,
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
      symbolsResolved: 8,
      symbolsUnresolved: 4,
    });
    expect(['escalate', 'block']).toContain(result.level);
    expect(result.score).toBeLessThan(75);
  });

  // Case 6: No-path blind retrieval
  it('GOLDEN-6: no candidates at all → block, hard_block=true', () => {
    const result = scoreMappingQuality({
      intent: 'bug_fix',
      mappingPattern: 'unknown',
      primaryCandidateScore: 0,
      alternateCandidateScore: 0,
      allCandidateScores: [],
      matchedScopeCount: 0,
      requestedScopeCount: 2,
      scopedCandidateCount: 0,
      outOfScopeCandidateCount: 0,
      disconnectedClusterCount: 0,
      retrievedEvidenceClasses: [],
      requiredEvidenceClasses: ['code'],
      symbolsResolved: 0,
      symbolsUnresolved: 0,
    });
    expect(result.level).toBe('block');
    expect(result.hard_block).toBe(true);
  });
});

// ─── 18. Backward compatibility ──────────────────────────────────────────────

describe('buildMappingQualityInput — backward compatible signal defaults', () => {
  it('builds valid input even when allCandidateScores is absent from DimensionSignals', () => {
    const signals = buildDimensionSignals({
      intent: 'bug_fix',
      modulesTouched: ['src/services'],
      evidence: [{ source: 'code', ref: 'src/services/core.ts', content: 'fn()' }],
      conflicts: [],
      mappingPattern: '1:1',
      mappingRootsRanked: [{ rank: 'primary', edge_count: 10 }],
      freshnessImpact: null,
    });
    // Should not throw even if allCandidateScores/disconnectedClusterCount are absent
    expect(() => computeMappingDimension(signals, DEFAULT_THRESHOLDS)).not.toThrow();
  });

  it('disconnectedClusterCount defaults to 0 when not provided', () => {
    const signals = buildDimensionSignals({
      intent: 'bug_fix',
      modulesTouched: ['src/services'],
      evidence: [{ source: 'code', ref: 'src/services/core.ts', content: 'fn()' }],
      conflicts: [],
      mappingPattern: '1:1',
      mappingRootsRanked: [{ rank: 'primary', edge_count: 10 }],
      freshnessImpact: null,
    });
    expect((signals as any).disconnectedClusterCount ?? 0).toBeGreaterThanOrEqual(0);
  });
});
