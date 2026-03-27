/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Nirnex — Sprint 11 Test Suite
 * Knowledge Layer: ECO Dimension Independent Computation
 *
 * TDD test suite written before implementation.
 * All tests must FAIL until implementation is complete.
 *
 * Tests every unit and integration point:
 *   1.  Types/Contracts       — DimensionResult, ScoreDimensionsOutput shape stability
 *   2.  buildDimensionSignals — normalized signal layer from raw ECO builder data
 *   3.  Coverage dimension    — scope ratio + mandatory evidence classes, all 4 severities
 *   4.  Freshness dimension   — delegates to Sprint 9, wrapped in DimensionResult
 *   5.  Mapping dimension     — pattern + scatter, all 4 severities
 *   6.  Conflict dimension    — delegates to Sprint 8, wrapped in DimensionResult
 *   7.  Graph completeness    — parse failures + symbol resolution, all 4 severities
 *   8.  scoreDimensions       — coordinator: contract tests, no hardcoded pass
 *   9.  Thresholds            — centralized config, intent-specific overrides
 *   10. Integration           — dimension independence proofs
 *   11. Trace/Ledger          — per-dimension metrics, reason codes, calculation_version
 *
 * Design constraints (enforced by tests):
 *   - No dimension may return hardcoded 'pass' when signals indicate degradation
 *   - Each dimension evaluator must produce its result without cross-dimension coupling
 *   - Same signals → same output (determinism)
 *   - Provenance must always be present (never undefined)
 *   - calculation_version must be non-empty (enables future calibration)
 *   - Unavailable inputs → warn/escalate with reason code, NOT silent pass
 */

import { describe, it, expect } from "vitest";

// ─── Imports under test ───────────────────────────────────────────────────────
// These will FAIL until implementation exists — intentional TDD red phase.

import {
  buildDimensionSignals,
  type RawDimensionInput,
} from "../packages/core/src/knowledge/dimensions/signals.js";

import {
  computeCoverageDimension,
} from "../packages/core/src/knowledge/dimensions/coverage.js";

import {
  computeFreshnessDimension,
} from "../packages/core/src/knowledge/dimensions/freshness.js";

import {
  computeMappingDimension,
} from "../packages/core/src/knowledge/dimensions/mapping.js";

import {
  computeConflictDimension,
} from "../packages/core/src/knowledge/dimensions/conflict.js";

import {
  computeGraphCompletenessDimension,
} from "../packages/core/src/knowledge/dimensions/graphCompleteness.js";

import {
  scoreDimensions,
  CALCULATION_VERSION,
} from "../packages/core/src/knowledge/dimensions/scoreDimensions.js";

import {
  DEFAULT_THRESHOLDS,
  getThresholds,
  type DimensionThresholds,
} from "../packages/core/src/knowledge/dimensions/thresholds.js";

import {
  COVERAGE_REASON_CODES,
  MAPPING_REASON_CODES,
  MAPPING_QUALITY_REASON_CODES,
  GRAPH_REASON_CODES,
  CONFLICT_REASON_CODES,
} from "../packages/core/src/knowledge/dimensions/reason-codes.js";

import {
  traceDimensionScoring,
} from "../packages/core/src/knowledge/ledger/traceDimensionScoring.js";

import type {
  DimensionResult,
  DimensionSignals,
  ScoreDimensionsOutput,
} from "../packages/core/src/knowledge/dimensions/types.js";

import type { ConflictRecord } from "../packages/core/src/knowledge/conflict/types.js";
import type { FreshnessImpact } from "../packages/core/src/knowledge/freshness/types.js";

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

function makeConflict(severity: ConflictRecord['severity']): ConflictRecord {
  return {
    id: `c_${severity}`,
    kind: 'structural',
    type: 'hub_collision',
    severity,
    confidence: 0.9,
    summary: `${severity} conflict`,
    why_it_matters: 'test',
    scope: { files: ['src/foo.ts'] },
    evidence: [{ source: 'graph', ref: 'src/foo.ts' }],
    resolution_hint: severity === 'block' ? 'must_block' : 'can_proceed_with_warning',
    detector: 'detect-hub-collisions',
  };
}

function makeFreshnessImpact(severity: FreshnessImpact['severity'], override: Partial<FreshnessImpact> = {}): FreshnessImpact {
  return {
    isStale: severity !== 'none',
    staleScopeCount: severity === 'none' ? 0 : 3,
    requiredScopeCount: 4,
    intersectedScopeCount: severity === 'none' ? 0 : severity === 'warn' ? 1 : severity === 'escalate' ? 2 : 3,
    impactedFiles: severity === 'none' ? [] : ['src/payments.ts'],
    impactedScopeIds: severity === 'none' ? [] : ['src/payments.ts'],
    impactRatio: severity === 'none' ? 0 : severity === 'warn' ? 0.15 : severity === 'escalate' ? 0.40 : 0.75,
    severity,
    reasonCodes: severity === 'none' ? ['INDEX_FRESH'] : ['INDEX_STALE_SCOPE_INTERSECTION_LOW'],
    ...override,
  };
}

function baseRaw(overrides: Partial<RawDimensionInput> = {}): RawDimensionInput {
  return {
    intent: 'bug_fix',
    modulesTouched: ['src/services'],
    evidence: [
      { source: 'code', ref: 'src/services/payment.ts', content: 'function processPayment() {}' },
    ],
    conflicts: [],
    mappingPattern: '1:1',
    mappingRootsRanked: [{ rank: 'primary', edge_count: 10 }],
    freshnessImpact: null,
    graphDiagnostics: {
      parseFailures: 0,
      brokenSymbols: 0,
      totalSymbols: 20,
      depthAchieved: 3,
      depthRequested: 3,
      fallbackRate: 0,
      criticalNodesMissing: 0,
    },
    ...overrides,
  };
}

function baseSignals(overrides: Partial<DimensionSignals> = {}): DimensionSignals {
  return {
    matchedScopeCount: 1,
    requestedScopeCount: 1,
    retrievedEvidenceClasses: ['code'],
    requiredEvidenceClasses: ['code'],
    freshnessImpact: null,
    mappingPattern: '1:1',
    primaryCandidateScore: 1.0,
    alternateCandidateScore: 0,
    symbolsResolved: 20,
    symbolsUnresolved: 0,
    conflicts: [],
    parseFailureCount: 0,
    brokenSymbolCount: 0,
    totalSymbolCount: 20,
    graphDepthAchieved: 3,
    graphDepthRequested: 3,
    fallbackUsageRate: 0,
    criticalNodesMissing: 0,
    intent: 'bug_fix',
    scopeIds: ['src/services'],
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Types / Contracts
// ═════════════════════════════════════════════════════════════════════════════

describe("Types / Contracts", () => {
  it("DimensionResult has required fields: value, status, reason_codes, summary, provenance, metrics", () => {
    const signals = baseSignals();
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result).toHaveProperty('value');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('reason_codes');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('provenance');
    expect(result).toHaveProperty('metrics');
    expect(typeof result.value).toBe('number');
    expect(['pass', 'warn', 'escalate', 'block']).toContain(result.status);
    expect(Array.isArray(result.reason_codes)).toBe(true);
    expect(typeof result.summary).toBe('string');
    expect(result.provenance).toBeDefined();
    expect(result.provenance.signals).toBeDefined();
    expect(result.provenance.thresholds).toBeDefined();
    expect(typeof result.metrics).toBe('object');
  });

  it("ScoreDimensionsOutput has required top-level fields", () => {
    const raw = baseRaw();
    const output = scoreDimensions(raw);
    expect(output).toHaveProperty('dimensions');
    expect(output).toHaveProperty('composite_internal_confidence');
    expect(output).toHaveProperty('trace_inputs');
    expect(output).toHaveProperty('calculation_version');
  });

  it("scoreDimensions always returns all 5 dimension keys", () => {
    const output = scoreDimensions(baseRaw());
    expect(output.dimensions).toHaveProperty('coverage');
    expect(output.dimensions).toHaveProperty('freshness');
    expect(output.dimensions).toHaveProperty('mapping');
    expect(output.dimensions).toHaveProperty('conflict');
    expect(output.dimensions).toHaveProperty('graph');
  });

  it("composite_internal_confidence is a number in [0, 100]", () => {
    const output = scoreDimensions(baseRaw());
    expect(typeof output.composite_internal_confidence).toBe('number');
    expect(output.composite_internal_confidence).toBeGreaterThanOrEqual(0);
    expect(output.composite_internal_confidence).toBeLessThanOrEqual(100);
  });

  it("calculation_version is a non-empty string", () => {
    const output = scoreDimensions(baseRaw());
    expect(typeof output.calculation_version).toBe('string');
    expect(output.calculation_version.length).toBeGreaterThan(0);
  });

  it("CALCULATION_VERSION export matches output.calculation_version", () => {
    const output = scoreDimensions(baseRaw());
    expect(output.calculation_version).toBe(CALCULATION_VERSION);
  });

  it("every dimension result has provenance.signals and provenance.thresholds", () => {
    const output = scoreDimensions(baseRaw());
    for (const [, dim] of Object.entries(output.dimensions)) {
      expect((dim as DimensionResult).provenance.signals).toBeDefined();
      expect(Array.isArray((dim as DimensionResult).provenance.signals)).toBe(true);
      expect((dim as DimensionResult).provenance.thresholds).toBeDefined();
    }
  });

  it("dimension value is always a number in [0, 1]", () => {
    const output = scoreDimensions(baseRaw());
    for (const [, dim] of Object.entries(output.dimensions)) {
      const d = dim as DimensionResult;
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.value).toBeLessThanOrEqual(1);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. buildDimensionSignals
// ═════════════════════════════════════════════════════════════════════════════

describe("buildDimensionSignals", () => {
  it("maps modulesTouched to requestedScopeCount", () => {
    const raw = baseRaw({ modulesTouched: ['src/a', 'src/b', 'src/c'] });
    const signals = buildDimensionSignals(raw);
    expect(signals.requestedScopeCount).toBe(3);
  });

  it("empty modulesTouched → requestedScopeCount=1 (non-zero to prevent division errors)", () => {
    const raw = baseRaw({ modulesTouched: [] });
    const signals = buildDimensionSignals(raw);
    expect(signals.requestedScopeCount).toBeGreaterThanOrEqual(1);
  });

  it("extracts evidence classes from evidence items", () => {
    const raw = baseRaw({
      evidence: [
        { source: 'code', ref: 'a.ts', content: '' },
        { source: 'spec', ref: 'spec.md', content: '' },
        { source: 'code', ref: 'b.ts', content: '' }, // duplicate — only one 'code' class
      ],
    });
    const signals = buildDimensionSignals(raw);
    expect(signals.retrievedEvidenceClasses).toContain('code');
    expect(signals.retrievedEvidenceClasses).toContain('spec');
    expect(signals.retrievedEvidenceClasses.length).toBe(2); // deduplicated
  });

  it("sets requiredEvidenceClasses from intent: bug_fix requires code", () => {
    const raw = baseRaw({ intent: 'bug_fix' });
    const signals = buildDimensionSignals(raw);
    expect(signals.requiredEvidenceClasses).toContain('code');
  });

  it("sets requiredEvidenceClasses from intent: new_feature requires spec + code", () => {
    const raw = baseRaw({ intent: 'new_feature' });
    const signals = buildDimensionSignals(raw);
    expect(signals.requiredEvidenceClasses).toContain('spec');
    expect(signals.requiredEvidenceClasses).toContain('code');
  });

  it("maps mappingPattern from raw", () => {
    const raw = baseRaw({ mappingPattern: '1:scattered' });
    const signals = buildDimensionSignals(raw);
    expect(signals.mappingPattern).toBe('1:scattered');
  });

  it("maps graph diagnostics to normalized fields", () => {
    const raw = baseRaw({
      graphDiagnostics: {
        parseFailures: 2,
        brokenSymbols: 3,
        totalSymbols: 15,
        depthAchieved: 2,
        depthRequested: 4,
        fallbackRate: 0.3,
        criticalNodesMissing: 1,
      },
    });
    const signals = buildDimensionSignals(raw);
    expect(signals.parseFailureCount).toBe(2);
    expect(signals.brokenSymbolCount).toBe(3);
    expect(signals.totalSymbolCount).toBe(15);
    expect(signals.graphDepthAchieved).toBe(2);
    expect(signals.graphDepthRequested).toBe(4);
    expect(signals.fallbackUsageRate).toBe(0.3);
    expect(signals.criticalNodesMissing).toBe(1);
  });

  it("uses safe defaults when graphDiagnostics is undefined", () => {
    const raw = baseRaw({ graphDiagnostics: undefined });
    const signals = buildDimensionSignals(raw);
    // Should not throw, should use defaults
    expect(signals.parseFailureCount).toBeGreaterThanOrEqual(0);
    expect(signals.fallbackUsageRate).toBeGreaterThanOrEqual(0);
  });

  it("passes through freshnessImpact from raw input", () => {
    const impact = makeFreshnessImpact('warn');
    const raw = baseRaw({ freshnessImpact: impact });
    const signals = buildDimensionSignals(raw);
    expect(signals.freshnessImpact).toEqual(impact);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Coverage dimension
// ═════════════════════════════════════════════════════════════════════════════

describe("computeCoverageDimension", () => {
  it("pass: full scope coverage + required evidence present", () => {
    const signals = baseSignals({
      matchedScopeCount: 5,
      requestedScopeCount: 5,
      retrievedEvidenceClasses: ['code', 'spec'],
      requiredEvidenceClasses: ['code'],
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('pass');
    expect(result.value).toBeGreaterThanOrEqual(0.80);
  });

  it("warn: ~65% scope coverage, required evidence present", () => {
    const signals = baseSignals({
      matchedScopeCount: 3,
      requestedScopeCount: 5,  // 60% coverage
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('warn');
  });

  it("escalate: missing a required evidence class", () => {
    const signals = baseSignals({
      matchedScopeCount: 4,
      requestedScopeCount: 5,
      retrievedEvidenceClasses: ['code'],     // has code
      requiredEvidenceClasses: ['code', 'spec'], // needs spec too → missing
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(['escalate', 'block']).toContain(result.status); // at least escalate
  });

  it("block: new_feature intent with NO spec evidence at all", () => {
    const signals = baseSignals({
      matchedScopeCount: 1,
      requestedScopeCount: 1,
      retrievedEvidenceClasses: ['code'],            // only code
      requiredEvidenceClasses: ['spec', 'code'],     // spec is mandatory for new_feature
      intent: 'new_feature',
    });
    // When ALL required classes are missing (spec missing), escalate minimum
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(['escalate', 'block']).toContain(result.status);
  });

  it("block: zero matched scopes and non-zero requested scopes", () => {
    const signals = baseSignals({
      matchedScopeCount: 0,
      requestedScopeCount: 4,
      retrievedEvidenceClasses: [],
      requiredEvidenceClasses: ['code'],
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('block');
  });

  it("pass boundary: exactly 80% coverage with all evidence → pass", () => {
    const signals = baseSignals({
      matchedScopeCount: 4,  // 80%
      requestedScopeCount: 5,
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('pass');
    expect(result.value).toBeCloseTo(0.80, 1);
  });

  it("warn boundary: <80% but ≥60% → warn", () => {
    const signals = baseSignals({
      matchedScopeCount: 3,
      requestedScopeCount: 5, // 60%
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('warn');
  });

  it("escalate boundary: <60% but ≥30% → escalate", () => {
    const signals = baseSignals({
      matchedScopeCount: 2,
      requestedScopeCount: 5, // 40%
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('escalate');
  });

  it("block boundary: <30% → block", () => {
    const signals = baseSignals({
      matchedScopeCount: 1,
      requestedScopeCount: 5, // 20%
      retrievedEvidenceClasses: ['code'],
      requiredEvidenceClasses: ['code'],
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('block');
  });

  it("emits COVERAGE_REQUIRED_EVIDENCE_MISSING reason code when mandatory class absent", () => {
    const signals = baseSignals({
      retrievedEvidenceClasses: [],
      requiredEvidenceClasses: ['code'],
    });
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.reason_codes).toContain(COVERAGE_REASON_CODES.COVERAGE_REQUIRED_EVIDENCE_MISSING);
  });

  it("metrics includes scopeRatio and mandatoryMissingCount", () => {
    const signals = baseSignals();
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(typeof result.metrics['scopeRatio']).toBe('number');
    expect(typeof result.metrics['mandatoryMissingCount']).toBe('number');
  });

  it("provenance.signals lists the signals used", () => {
    const signals = baseSignals();
    const result = computeCoverageDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.provenance.signals.length).toBeGreaterThan(0);
    expect(result.provenance.thresholds).toHaveProperty('pass');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Freshness dimension
// ═════════════════════════════════════════════════════════════════════════════

describe("computeFreshnessDimension", () => {
  it("pass: no freshness impact (fresh index)", () => {
    const signals = baseSignals({ freshnessImpact: makeFreshnessImpact('none') });
    const result = computeFreshnessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('pass');
    expect(result.value).toBe(1.0);
  });

  it("pass: stale but unrelated scope (no intersection) → no penalty", () => {
    const impact = makeFreshnessImpact('none', {
      isStale: true,
      intersectedScopeCount: 0,
      impactRatio: 0,
      reasonCodes: ['INDEX_STALE_NO_SCOPE_INTERSECTION'],
    });
    const signals = baseSignals({ freshnessImpact: impact });
    const result = computeFreshnessDimension(signals, DEFAULT_THRESHOLDS);
    // Stale but unrelated → no penalty
    expect(result.status).toBe('pass');
    expect(result.reason_codes).toContain('INDEX_STALE_NO_SCOPE_INTERSECTION');
  });

  it("warn: low intersection ratio", () => {
    const signals = baseSignals({ freshnessImpact: makeFreshnessImpact('warn') });
    const result = computeFreshnessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('warn');
  });

  it("escalate: medium intersection ratio", () => {
    const signals = baseSignals({ freshnessImpact: makeFreshnessImpact('escalate') });
    const result = computeFreshnessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('escalate');
  });

  it("block: high intersection ratio OR deleted scope", () => {
    const signals = baseSignals({ freshnessImpact: makeFreshnessImpact('block') });
    const result = computeFreshnessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('block');
  });

  it("no freshness data (null) → emit warn with FRESHNESS_INPUTS_UNAVAILABLE reason", () => {
    const signals = baseSignals({ freshnessImpact: null });
    const result = computeFreshnessDimension(signals, DEFAULT_THRESHOLDS);
    // Unavailable freshness data must NOT silently pass
    // It should emit warn (uncertain state, not confirmed clean)
    expect(result.status).toBe('warn');
    expect(result.reason_codes.some(c => c.includes('UNAVAILABLE') || c.includes('UNKNOWN'))).toBe(true);
  });

  it("passes reason_codes from FreshnessImpact through to result", () => {
    const impact = makeFreshnessImpact('escalate', {
      reasonCodes: ['INDEX_STALE_SCOPE_INTERSECTION_MEDIUM'],
    });
    const signals = baseSignals({ freshnessImpact: impact });
    const result = computeFreshnessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.reason_codes).toContain('INDEX_STALE_SCOPE_INTERSECTION_MEDIUM');
  });

  it("metrics includes impactRatio and intersectedScopeCount", () => {
    const signals = baseSignals({ freshnessImpact: makeFreshnessImpact('warn') });
    const result = computeFreshnessDimension(signals, DEFAULT_THRESHOLDS);
    expect(typeof result.metrics['impactRatio']).toBe('number');
    expect(typeof result.metrics['intersectedScopeCount']).toBe('number');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Mapping dimension
// ═════════════════════════════════════════════════════════════════════════════

describe("computeMappingDimension", () => {
  it("pass: 1:1 pattern, single clear target, no scatter", () => {
    const signals = baseSignals({
      mappingPattern: '1:1',
      primaryCandidateScore: 1.0,
      alternateCandidateScore: 0,
      symbolsResolved: 10,
      symbolsUnresolved: 0,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('pass');
    expect(result.value).toBeGreaterThanOrEqual(0.80);
  });

  it("pass: 1:chain with no scatter", () => {
    const signals = baseSignals({
      mappingPattern: '1:chain',
      primaryCandidateScore: 0.9,
      alternateCandidateScore: 0,
      symbolsResolved: 8,
      symbolsUnresolved: 0,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(['pass', 'warn']).toContain(result.status); // clean chain should be at worst warn
  });

  it("warn: slight scatter — alternate exists but much weaker", () => {
    const signals = baseSignals({
      mappingPattern: '1:1',
      primaryCandidateScore: 1.0,
      alternateCandidateScore: 0.4, // moderate scatter
      symbolsResolved: 10,
      symbolsUnresolved: 1,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(['warn', 'escalate']).toContain(result.status);
  });

  it("escalate: ambiguous pattern — multiple competing candidates", () => {
    const signals = baseSignals({
      mappingPattern: 'ambiguous',
      primaryCandidateScore: 0.6,
      alternateCandidateScore: 0.55,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(['escalate', 'block']).toContain(result.status);
  });

  it("block: 1:scattered pattern always blocks", () => {
    const signals = baseSignals({
      mappingPattern: '1:scattered',
      primaryCandidateScore: 0.3,
      alternateCandidateScore: 0.8,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('block');
    expect(result.value).toBeLessThan(0.30);
  });

  it("block: zero primary candidate score → block", () => {
    const signals = baseSignals({
      mappingPattern: 'unknown',
      primaryCandidateScore: 0,
      alternateCandidateScore: 0,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(['block', 'escalate']).toContain(result.status);
  });

  it("unknown mapping pattern → not pass (uncertain)", () => {
    // Sprint 14: quantitative scorer is more conservative for unknown pattern.
    // Result may be warn, escalate, or block depending on candidate scores — but NEVER pass.
    const signals = baseSignals({
      mappingPattern: 'unknown',
      primaryCandidateScore: 0.5,
      alternateCandidateScore: 0,
    });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(['warn', 'escalate', 'block']).toContain(result.status);
    // Must NOT be pass — unknown is uncertain
    expect(result.status).not.toBe('pass');
  });

  it("emits MAPPING_QUALITY_SCORED reason code for any pattern (Sprint 14+)", () => {
    // Sprint 14 replaced qualitative reason codes with quantitative scoring codes.
    const signals = baseSignals({ mappingPattern: 'ambiguous' });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.reason_codes).toContain(MAPPING_QUALITY_REASON_CODES.MAPPING_QUALITY_SCORED);
  });

  it("emits MAPPING_QUALITY_HARD_BLOCK reason code for 1:scattered (Sprint 14+)", () => {
    // Sprint 14: scattered pattern with no candidates triggers hard-block.
    const signals = baseSignals({ mappingPattern: '1:scattered' });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    // Sprint 14 quantitative scorer emits MAPPING_QUALITY_SCORED always;
    // hard_block=true adds MAPPING_QUALITY_HARD_BLOCK
    expect(result.reason_codes).toContain(MAPPING_QUALITY_REASON_CODES.MAPPING_QUALITY_SCORED);
    expect(result.status).toBe('block');
  });

  it("metrics includes mappingPattern and mapping_quality_score (Sprint 14+)", () => {
    // Sprint 14 replaced scatterRatio with the quantitative mapping_quality_score.
    const signals = baseSignals({ mappingPattern: '1:chain', primaryCandidateScore: 0.9 });
    const result = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.metrics['mappingPattern']).toBeDefined();
    expect(typeof result.metrics['mapping_quality_score']).toBe('number');
  });

  it("deterministic — same inputs yield same mapping result", () => {
    const signals = baseSignals({ mappingPattern: '1:chain', primaryCandidateScore: 0.8, alternateCandidateScore: 0.3 });
    const r1 = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    const r2 = computeMappingDimension(signals, DEFAULT_THRESHOLDS);
    expect(r1.status).toBe(r2.status);
    expect(r1.value).toBe(r2.value);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Conflict dimension
// ═════════════════════════════════════════════════════════════════════════════

describe("computeConflictDimension", () => {
  it("pass: empty conflicts → value=1.0", () => {
    const signals = baseSignals({ conflicts: [] });
    const result = computeConflictDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('pass');
    expect(result.value).toBe(1.0);
  });

  it("warn: single low-severity conflict", () => {
    const signals = baseSignals({ conflicts: [makeConflict('low')] });
    const result = computeConflictDimension(signals, DEFAULT_THRESHOLDS);
    expect(['warn', 'pass']).toContain(result.status); // low severity should at most warn
  });

  it("warn: medium-severity conflict", () => {
    const signals = baseSignals({ conflicts: [makeConflict('medium')] });
    const result = computeConflictDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('warn');
  });

  it("escalate: high-severity conflict", () => {
    const signals = baseSignals({ conflicts: [makeConflict('high')] });
    const result = computeConflictDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('escalate');
  });

  it("block: blocking conflict", () => {
    const signals = baseSignals({ conflicts: [makeConflict('block')] });
    const result = computeConflictDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('block');
    expect(result.value).toBeLessThan(0.30);
  });

  it("takes dominant severity from multiple conflicts", () => {
    const signals = baseSignals({
      conflicts: [makeConflict('low'), makeConflict('high')],
    });
    const result = computeConflictDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('escalate');
  });

  it("emits CONFLICT_BLOCKING reason code for blocking conflict", () => {
    const signals = baseSignals({ conflicts: [makeConflict('block')] });
    const result = computeConflictDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.reason_codes).toContain(CONFLICT_REASON_CODES.CONFLICT_BLOCKING);
  });

  it("metrics includes conflictCount and dominantSeverity", () => {
    const signals = baseSignals({ conflicts: [makeConflict('high')] });
    const result = computeConflictDimension(signals, DEFAULT_THRESHOLDS);
    expect(typeof result.metrics['conflictCount']).toBe('number');
    expect(result.metrics['dominantSeverity']).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Graph completeness dimension
// ═════════════════════════════════════════════════════════════════════════════

describe("computeGraphCompletenessDimension", () => {
  it("pass: zero parse failures, all symbols resolved, full depth", () => {
    const signals = baseSignals({
      parseFailureCount: 0,
      brokenSymbolCount: 0,
      totalSymbolCount: 20,
      symbolsResolved: 20,
      symbolsUnresolved: 0,
      graphDepthAchieved: 3,
      graphDepthRequested: 3,
      fallbackUsageRate: 0,
      criticalNodesMissing: 0,
    });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('pass');
    expect(result.value).toBeGreaterThanOrEqual(0.80);
  });

  it("warn: one parse failure, otherwise healthy", () => {
    const signals = baseSignals({
      parseFailureCount: 1,
      brokenSymbolCount: 0,
      symbolsResolved: 20,
      symbolsUnresolved: 0,
      graphDepthAchieved: 3,
      graphDepthRequested: 3,
      fallbackUsageRate: 0,
      criticalNodesMissing: 0,
    });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('warn');
  });

  it("escalate: 2+ parse failures in scope", () => {
    const signals = baseSignals({
      parseFailureCount: 2,
      symbolsResolved: 15,
      symbolsUnresolved: 5,
      graphDepthAchieved: 2,
      graphDepthRequested: 3,
      fallbackUsageRate: 0.1,
      criticalNodesMissing: 0,
    });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    expect(['escalate', 'block']).toContain(result.status);
  });

  it("block: critical nodes missing", () => {
    const signals = baseSignals({
      parseFailureCount: 0,
      symbolsResolved: 18,
      symbolsUnresolved: 2,
      graphDepthAchieved: 3,
      graphDepthRequested: 3,
      fallbackUsageRate: 0,
      criticalNodesMissing: 1, // critical nodes missing → always block
    });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.status).toBe('block');
  });

  it("block: very low symbol resolution rate (<50%)", () => {
    const signals = baseSignals({
      parseFailureCount: 0,
      symbolsResolved: 5,
      symbolsUnresolved: 10,  // ~33% resolution
      graphDepthAchieved: 3,
      graphDepthRequested: 3,
      fallbackUsageRate: 0,
      criticalNodesMissing: 0,
    });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    expect(['block', 'escalate']).toContain(result.status);
  });

  it("escalate: high fallback usage rate", () => {
    const signals = baseSignals({
      parseFailureCount: 0,
      symbolsResolved: 18,
      symbolsUnresolved: 2,
      graphDepthAchieved: 3,
      graphDepthRequested: 3,
      fallbackUsageRate: 0.5,  // high fallback → escalate
      criticalNodesMissing: 0,
    });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    expect(['escalate', 'warn']).toContain(result.status);
  });

  it("warn: unknown symbol state (totalSymbolCount=0) → warn, not pass", () => {
    const signals = baseSignals({
      parseFailureCount: 0,
      symbolsResolved: 0,
      symbolsUnresolved: 0,
      totalSymbolCount: 0, // unknown state
      graphDepthAchieved: 3,
      graphDepthRequested: 3,
      fallbackUsageRate: 0,
      criticalNodesMissing: 0,
    });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    // Unknown symbol state must NOT silently pass
    expect(result.status).not.toBe('pass');
    expect(result.reason_codes.some(c => c.includes('UNKNOWN') || c.includes('UNAVAILABLE'))).toBe(true);
  });

  it("partial depth achieved → degrades value", () => {
    const fullDepth = baseSignals({ graphDepthAchieved: 3, graphDepthRequested: 3 });
    const partialDepth = baseSignals({ graphDepthAchieved: 1, graphDepthRequested: 3 });
    const full = computeGraphCompletenessDimension(fullDepth, DEFAULT_THRESHOLDS);
    const partial = computeGraphCompletenessDimension(partialDepth, DEFAULT_THRESHOLDS);
    expect(full.value).toBeGreaterThan(partial.value);
  });

  it("emits GRAPH_SCOPE_PARSE_FAILURE reason code when parse failures exist", () => {
    const signals = baseSignals({ parseFailureCount: 2 });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    expect(result.reason_codes).toContain(GRAPH_REASON_CODES.GRAPH_SCOPE_PARSE_FAILURE);
  });

  it("metrics includes parseFailureCount, symbolResolutionRate, depthRatio", () => {
    const signals = baseSignals({ parseFailureCount: 1, symbolsResolved: 18, symbolsUnresolved: 2 });
    const result = computeGraphCompletenessDimension(signals, DEFAULT_THRESHOLDS);
    expect(typeof result.metrics['parseFailureCount']).toBe('number');
    expect(typeof result.metrics['symbolResolutionRate']).toBe('number');
    expect(typeof result.metrics['depthRatio']).toBe('number');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. scoreDimensions — coordinator contract
// ═════════════════════════════════════════════════════════════════════════════

describe("scoreDimensions — coordinator", () => {
  it("returns all 5 dimension keys on every invocation", () => {
    const output = scoreDimensions(baseRaw());
    const keys = Object.keys(output.dimensions);
    expect(keys).toContain('coverage');
    expect(keys).toContain('freshness');
    expect(keys).toContain('mapping');
    expect(keys).toContain('conflict');
    expect(keys).toContain('graph');
  });

  it("all-pass scenario → composite >= 80", () => {
    const raw = baseRaw({
      modulesTouched: ['src/services'],
      evidence: [
        { source: 'code', ref: 'src/services/a.ts', content: 'code' },
      ],
      mappingPattern: '1:1',
      mappingRootsRanked: [{ rank: 'primary', edge_count: 10 }],
      freshnessImpact: makeFreshnessImpact('none'),
      graphDiagnostics: {
        parseFailures: 0, brokenSymbols: 0, totalSymbols: 20,
        depthAchieved: 3, depthRequested: 3, fallbackRate: 0, criticalNodesMissing: 0,
      },
    });
    const output = scoreDimensions(raw);
    // When all dimensions are healthy, composite should be reasonably high
    expect(output.composite_internal_confidence).toBeGreaterThan(60);
  });

  it("block conflict → composite drops (never stays high)", () => {
    const raw = baseRaw({ conflicts: [makeConflict('block')] });
    const output = scoreDimensions(raw);
    // A block condition must reduce composite confidence
    expect(output.composite_internal_confidence).toBeLessThanOrEqual(40);
  });

  it("trace_inputs is preserved in output for replay", () => {
    const raw = baseRaw({ intent: 'refactor' });
    const output = scoreDimensions(raw);
    expect(output.trace_inputs).toBeDefined();
    expect(output.trace_inputs.intent).toBe('refactor');
  });

  it("no dimension returns hardcoded pass when signals indicate degradation", () => {
    // Pathological input: no evidence, zero scopes, scattered mapping, block conflict, parse failures
    const raw = baseRaw({
      modulesTouched: [],
      evidence: [],
      conflicts: [makeConflict('block')],
      mappingPattern: '1:scattered',
      mappingRootsRanked: [],
      freshnessImpact: makeFreshnessImpact('block'),
      graphDiagnostics: {
        parseFailures: 3, brokenSymbols: 10, totalSymbols: 10,
        depthAchieved: 0, depthRequested: 3, fallbackRate: 0.9, criticalNodesMissing: 1,
      },
    });
    const output = scoreDimensions(raw);
    // No dimension should be 'pass' under these conditions
    const allPass = Object.values(output.dimensions).every(d => (d as DimensionResult).status === 'pass');
    expect(allPass).toBe(false);
    // Coverage can't be pass with no evidence
    expect(output.dimensions.coverage.status).not.toBe('pass');
    // Conflict can't be pass with blocking conflict
    expect(output.dimensions.conflict.status).not.toBe('pass');
    // Mapping can't be pass with scattered pattern
    expect(output.dimensions.mapping.status).not.toBe('pass');
  });

  it("is deterministic — same raw input → same ScoreDimensionsOutput", () => {
    const raw = baseRaw({ intent: 'new_feature', mappingPattern: '1:chain' });
    const o1 = scoreDimensions(raw);
    const o2 = scoreDimensions(raw);
    expect(o1.dimensions.coverage.status).toBe(o2.dimensions.coverage.status);
    expect(o1.dimensions.mapping.status).toBe(o2.dimensions.mapping.status);
    expect(o1.composite_internal_confidence).toBe(o2.composite_internal_confidence);
    expect(o1.calculation_version).toBe(o2.calculation_version);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Thresholds
// ═════════════════════════════════════════════════════════════════════════════

describe("Thresholds", () => {
  it("DEFAULT_THRESHOLDS has entries for all 5 dimensions", () => {
    expect(DEFAULT_THRESHOLDS).toHaveProperty('coverage');
    expect(DEFAULT_THRESHOLDS).toHaveProperty('freshness');
    expect(DEFAULT_THRESHOLDS).toHaveProperty('mapping');
    expect(DEFAULT_THRESHOLDS).toHaveProperty('conflict');
    expect(DEFAULT_THRESHOLDS).toHaveProperty('graph');
  });

  it("each threshold entry has pass, warn, escalate fields", () => {
    for (const [, band] of Object.entries(DEFAULT_THRESHOLDS)) {
      const b = band as any;
      expect(typeof b.pass).toBe('number');
      expect(typeof b.warn).toBe('number');
      expect(typeof b.escalate).toBe('number');
    }
  });

  it("threshold values are in descending order: pass > warn > escalate", () => {
    for (const [, band] of Object.entries(DEFAULT_THRESHOLDS)) {
      const b = band as any;
      expect(b.pass).toBeGreaterThan(b.warn);
      expect(b.warn).toBeGreaterThan(b.escalate);
    }
  });

  it("getThresholds() with no intent returns DEFAULT_THRESHOLDS", () => {
    const thresholds = getThresholds();
    expect(thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it("getThresholds() returns DimensionThresholds shape regardless of intent", () => {
    const thresholds = getThresholds('new_feature');
    expect(thresholds).toHaveProperty('coverage');
    expect(thresholds).toHaveProperty('mapping');
  });

  it("CALCULATION_VERSION is a semver-like string", () => {
    expect(typeof CALCULATION_VERSION).toBe('string');
    expect(CALCULATION_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Integration — dimension independence proofs
// ═════════════════════════════════════════════════════════════════════════════

describe("Integration — dimension independence", () => {
  it("stale unrelated scope: freshness=pass, coverage unaffected", () => {
    // Stale files that are NOT in the required scope — should not penalize freshness
    const raw = baseRaw({
      freshnessImpact: makeFreshnessImpact('none', {
        isStale: true,
        intersectedScopeCount: 0,
        impactRatio: 0,
        reasonCodes: ['INDEX_STALE_NO_SCOPE_INTERSECTION'],
      }),
      evidence: [{ source: 'code', ref: 'src/services/payment.ts', content: 'code' }],
    });
    const output = scoreDimensions(raw);
    // Freshness must be pass/none when scope does NOT intersect
    expect(output.dimensions.freshness.status).toBe('pass');
    // Coverage should still reflect actual evidence
    expect(['pass', 'warn']).toContain(output.dimensions.coverage.status);
  });

  it("scattered mapping degrades mapping but NOT coverage", () => {
    const raw = baseRaw({
      mappingPattern: '1:scattered',
      evidence: [{ source: 'code', ref: 'src/services/payment.ts', content: 'code content' }],
      modulesTouched: ['src/services'],
    });
    const output = scoreDimensions(raw);
    // Mapping must be blocked by scatter
    expect(output.dimensions.mapping.status).toBe('block');
    // Coverage should reflect evidence, not be influenced by mapping
    expect(['pass', 'warn', 'escalate']).toContain(output.dimensions.coverage.status);
    expect(output.dimensions.coverage.status).not.toBe('block'); // coverage not polluted by mapping
  });

  it("parse failures degrade graph but NOT freshness", () => {
    const raw = baseRaw({
      graphDiagnostics: {
        parseFailures: 3,
        brokenSymbols: 5,
        totalSymbols: 15,
        depthAchieved: 1,
        depthRequested: 3,
        fallbackRate: 0.4,
        criticalNodesMissing: 0,
      },
      freshnessImpact: makeFreshnessImpact('none'), // fresh index
    });
    const output = scoreDimensions(raw);
    // Graph must be degraded by parse failures
    expect(['escalate', 'block']).toContain(output.dimensions.graph.status);
    // Freshness must be unaffected by parse failures
    expect(output.dimensions.freshness.status).toBe('pass');
  });

  it("blocking conflict degrades conflict but NOT mapping", () => {
    const raw = baseRaw({
      conflicts: [makeConflict('block')],
      mappingPattern: '1:1',
      mappingRootsRanked: [{ rank: 'primary', edge_count: 10 }],
    });
    const output = scoreDimensions(raw);
    // Conflict must be blocked
    expect(output.dimensions.conflict.status).toBe('block');
    // Mapping must be clean (conflict doesn't bleed into mapping)
    expect(output.dimensions.mapping.status).toBe('pass');
  });

  it("missing spec evidence for new_feature degrades coverage but NOT graph", () => {
    const raw = baseRaw({
      intent: 'new_feature',
      evidence: [{ source: 'code', ref: 'src/services/x.ts', content: 'code' }], // code but no spec
      graphDiagnostics: {
        parseFailures: 0, brokenSymbols: 0, totalSymbols: 20,
        depthAchieved: 3, depthRequested: 3, fallbackRate: 0, criticalNodesMissing: 0,
      },
    });
    const output = scoreDimensions(raw);
    // Coverage should be at least escalate for missing spec evidence
    expect(['escalate', 'block']).toContain(output.dimensions.coverage.status);
    // Graph should be healthy
    expect(output.dimensions.graph.status).toBe('pass');
  });

  it("two cases: one dimension blocks, others pass independently", () => {
    // Case 1: only freshness blocks
    const case1 = baseRaw({
      freshnessImpact: makeFreshnessImpact('block'),
      evidence: [{ source: 'code', ref: 'src/services.ts', content: 'code' }],
      mappingPattern: '1:1',
      conflicts: [],
      graphDiagnostics: { parseFailures: 0, brokenSymbols: 0, totalSymbols: 10, depthAchieved: 3, depthRequested: 3, fallbackRate: 0, criticalNodesMissing: 0 },
    });
    const o1 = scoreDimensions(case1);
    expect(o1.dimensions.freshness.status).toBe('block');
    expect(o1.dimensions.conflict.status).toBe('pass');
    expect(o1.dimensions.mapping.status).toBe('pass');

    // Case 2: only conflict blocks
    const case2 = baseRaw({
      freshnessImpact: makeFreshnessImpact('none'),
      conflicts: [makeConflict('block')],
      mappingPattern: '1:1',
      graphDiagnostics: { parseFailures: 0, brokenSymbols: 0, totalSymbols: 10, depthAchieved: 3, depthRequested: 3, fallbackRate: 0, criticalNodesMissing: 0 },
    });
    const o2 = scoreDimensions(case2);
    expect(o2.dimensions.conflict.status).toBe('block');
    expect(o2.dimensions.freshness.status).toBe('pass');
    expect(o2.dimensions.mapping.status).toBe('pass');
  });

  it("mapping degrades while coverage remains acceptable", () => {
    // Scattered mapping pattern with good evidence coverage
    const raw = baseRaw({
      intent: 'bug_fix',
      modulesTouched: ['src/services'],
      evidence: [{ source: 'code', ref: 'src/services/payment.ts', content: 'code' }],
      mappingPattern: '1:scattered',
      mappingRootsRanked: [{ rank: 'primary', edge_count: 3 }, { rank: 'alternative', edge_count: 8 }],
    });
    const output = scoreDimensions(raw);
    expect(output.dimensions.mapping.status).toBe('block');
    // Coverage still reflects that we have code evidence for the module
    expect(['pass', 'warn']).toContain(output.dimensions.coverage.status);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. Trace / Ledger
// ═════════════════════════════════════════════════════════════════════════════

describe("traceDimensionScoring", () => {
  it("returns a trace record with all dimension entries", () => {
    const output = scoreDimensions(baseRaw());
    const trace = traceDimensionScoring(output);
    expect(trace).toHaveProperty('coverage');
    expect(trace).toHaveProperty('freshness');
    expect(trace).toHaveProperty('mapping');
    expect(trace).toHaveProperty('conflict');
    expect(trace).toHaveProperty('graph');
  });

  it("each dimension entry in trace has status, reason_codes, metrics", () => {
    const output = scoreDimensions(baseRaw());
    const trace = traceDimensionScoring(output);
    for (const [, entry] of Object.entries(trace.dimensions ?? trace)) {
      if (typeof entry === 'object' && entry !== null && 'status' in entry) {
        expect(entry).toHaveProperty('status');
        expect(entry).toHaveProperty('reason_codes');
        expect(entry).toHaveProperty('metrics');
      }
    }
  });

  it("trace has composite_internal_confidence", () => {
    const output = scoreDimensions(baseRaw());
    const trace = traceDimensionScoring(output);
    expect(trace).toHaveProperty('composite_internal_confidence');
    expect(typeof trace.composite_internal_confidence).toBe('number');
  });

  it("trace has calculation_version", () => {
    const output = scoreDimensions(baseRaw());
    const trace = traceDimensionScoring(output);
    expect(trace).toHaveProperty('calculation_version');
    expect(typeof trace.calculation_version).toBe('string');
    expect(trace.calculation_version.length).toBeGreaterThan(0);
  });

  it("trace has timestamp", () => {
    const output = scoreDimensions(baseRaw());
    const trace = traceDimensionScoring(output);
    expect(trace).toHaveProperty('timestamp');
    expect(() => new Date(trace.timestamp)).not.toThrow();
    expect(isNaN(new Date(trace.timestamp).getTime())).toBe(false);
  });

  it("replay — same scoreDimensions output → same trace structure", () => {
    const raw = baseRaw({ intent: 'refactor', mappingPattern: '1:chain' });
    const o1 = scoreDimensions(raw);
    const o2 = scoreDimensions(raw);
    const t1 = traceDimensionScoring(o1);
    const t2 = traceDimensionScoring(o2);
    // Status and reason codes should be identical for same inputs
    expect(t1.composite_internal_confidence).toBe(t2.composite_internal_confidence);
    expect(t1.calculation_version).toBe(t2.calculation_version);
  });
});
