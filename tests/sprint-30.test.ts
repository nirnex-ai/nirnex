/**
 * Sprint 30 — Confidence-Governance Enforcement (TDD)
 *
 * Addresses the governance weakness identified in the Level 2 validation
 * assessment: when confidence is 0 / band is 'unknown', the system was
 * still producing ALLOW with no audit trail entry for the gap.
 *
 * Root causes fixed here:
 *
 * 1. validate.ts hardcoded `final_confidence: null` in every ledger entry.
 *    Envelope confidence was never surfaced to the ledger or the report.
 *
 * 2. validate.ts had no enforcement path for confidence.score === 0.
 *    The governance gap was only visible as an OPT-004 hint (advisory
 *    observation) — it was never recorded as a ContractViolationDetected
 *    event in the audit trail.
 *
 * 3. OPT-004 treated `band: 'unknown'` (no snapshot data at all) identically
 *    to `band: 'very_low'` (computed but low). These are semantically distinct:
 *    'very_low' means "scored and found weak"; 'unknown' means "no evidence".
 *
 * Fixes:
 *   A. New pure helper `isConfidenceGateUnknown(score)` in confidence-gate.ts
 *   B. New ReasonCode `CONFIDENCE_GATE_UNKNOWN` (advisory)
 *   C. validate.ts emits CONFIDENCE_GATE_UNKNOWN advisory when score === 0
 *   D. validate.ts writes `final_confidence: envelope.confidence.score` to ledger
 *   E. OPT-004 emits a distinct observation when `band === 'unknown'`
 *
 * Coverage:
 *
 * 1. isConfidenceGateUnknown — pure helper
 *    1.1  Returns true when score is 0
 *    1.2  Returns false when score is positive
 *    1.3  Returns false when score is 1 (boundary — not zero)
 *    1.4  Returns true only for exactly 0, not negative (boundary)
 *
 * 2. ReasonCode.CONFIDENCE_GATE_UNKNOWN — type contract
 *    2.1  CONFIDENCE_GATE_UNKNOWN exists in ReasonCode
 *    2.2  Its value is the string literal 'CONFIDENCE_GATE_UNKNOWN'
 *
 * 3. OPT-004 — band-unknown path
 *    3.1  band: 'unknown' produces OPT-004 with 'no confidence data' observation
 *    3.2  band: 'very_low' produces OPT-004 with 'low confidence' observation
 *    3.3  band: 'unknown' observation is distinct from band: 'very_low' observation
 *    3.4  band: 'high' with confidence >= 60 does NOT produce OPT-004
 *    3.5  OPT-004 hint has rule_id 'OPT-004' regardless of band
 */

import { describe, it, expect } from 'vitest';

import { isConfidenceGateUnknown } from '../packages/cli/src/runtime/confidence-gate.js';
import { ReasonCode } from '../packages/cli/src/runtime/types.js';
import { generateOptimisationHints } from '../packages/core/src/runtime/reporting/optimization-rules.js';

import type { RunEvidenceBundle } from '../packages/core/src/runtime/reporting/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBundleWithConfidence(
  overallConfidence: number,
  band: string,
  finalStatus: RunEvidenceBundle['summary']['final_status'] = 'success',
): RunEvidenceBundle {
  return {
    bundle_id: 'bundle-test',
    schema_version: '1.0.0',
    run_id: 'tr_conf_test',
    request_id: 'req_conf_test',
    generated_at: new Date().toISOString(),
    summary: {
      run_id: 'tr_conf_test',
      request_id: 'req_conf_test',
      final_status: finalStatus,
      report_integrity_status: 'valid',
    },
    stages: [],
    failures: [],
    causal_graph: { nodes: [], edges: [], primary_chains: [], secondary_chains: [] },
    confidence: {
      overall_confidence: overallConfidence,
      effective_confidence: overallConfidence,
      band,
      dimensions: {},
      penalties: [],
      checkpoints: [],
    },
    knowledge_health: {
      absent_evidence: [],
      conflicting_evidence: [],
      stale_evidence: [],
      weak_evidence: [],
      dimension_scores: {},
      dimension_statuses: {},
    },
    optimisation_hints: [],
    raw_events: [],
    integrity: {
      valid: true,
      issues: [],
      missing_stages: [],
      broken_causal_refs: [],
      unclassified_failure_codes: [],
    },
  };
}

// ─── 1. isConfidenceGateUnknown ───────────────────────────────────────────────

describe('1. isConfidenceGateUnknown — pure helper', () => {
  it('1.1 returns true when score is 0', () => {
    expect(isConfidenceGateUnknown(0)).toBe(true);
  });

  it('1.2 returns false when score is positive', () => {
    expect(isConfidenceGateUnknown(80)).toBe(false);
  });

  it('1.3 returns false when score is 1 (boundary — not zero)', () => {
    expect(isConfidenceGateUnknown(1)).toBe(false);
  });

  it('1.4 returns false for negative scores (below zero is not "unknown", it is invalid)', () => {
    expect(isConfidenceGateUnknown(-5)).toBe(false);
  });
});

// ─── 2. ReasonCode.CONFIDENCE_GATE_UNKNOWN ────────────────────────────────────

describe('2. ReasonCode.CONFIDENCE_GATE_UNKNOWN — type contract', () => {
  it('2.1 CONFIDENCE_GATE_UNKNOWN exists in ReasonCode', () => {
    expect(ReasonCode.CONFIDENCE_GATE_UNKNOWN).toBeDefined();
  });

  it('2.2 its value is the string literal CONFIDENCE_GATE_UNKNOWN', () => {
    expect(ReasonCode.CONFIDENCE_GATE_UNKNOWN).toBe('CONFIDENCE_GATE_UNKNOWN');
  });
});

// ─── 3. OPT-004 — band-unknown path ──────────────────────────────────────────

describe('3. OPT-004 — band-unknown path', () => {
  it('3.1 band: unknown produces OPT-004 with a "no confidence data" observation', () => {
    const bundle = makeBundleWithConfidence(0, 'unknown', 'success');
    const hints = generateOptimisationHints(bundle);
    const opt004 = hints.find(h => h.rule_id === 'OPT-004');
    expect(opt004).toBeDefined();
    expect(opt004!.observation.toLowerCase()).toMatch(/no confidence data|unknown confidence/);
  });

  it('3.2 band: very_low produces OPT-004 with a "low confidence" observation', () => {
    const bundle = makeBundleWithConfidence(30, 'very_low', 'success');
    const hints = generateOptimisationHints(bundle);
    const opt004 = hints.find(h => h.rule_id === 'OPT-004');
    expect(opt004).toBeDefined();
    expect(opt004!.observation.toLowerCase()).toMatch(/low confidence|succeeded at low/);
  });

  it('3.3 band: unknown and band: very_low produce distinct OPT-004 observations', () => {
    const unknownBundle  = makeBundleWithConfidence(0,  'unknown',  'success');
    const veryLowBundle  = makeBundleWithConfidence(30, 'very_low', 'success');

    const unknownHints  = generateOptimisationHints(unknownBundle);
    const veryLowHints  = generateOptimisationHints(veryLowBundle);

    const unknownObs  = unknownHints.find(h => h.rule_id === 'OPT-004')?.observation ?? '';
    const veryLowObs  = veryLowHints.find(h => h.rule_id === 'OPT-004')?.observation ?? '';

    expect(unknownObs).not.toBe('');
    expect(veryLowObs).not.toBe('');
    expect(unknownObs).not.toBe(veryLowObs);
  });

  it('3.4 band: high with confidence >= 60 does NOT produce OPT-004', () => {
    const bundle = makeBundleWithConfidence(90, 'high', 'success');
    const hints = generateOptimisationHints(bundle);
    const opt004 = hints.find(h => h.rule_id === 'OPT-004');
    expect(opt004).toBeUndefined();
  });

  it('3.5 OPT-004 hint has rule_id OPT-004 regardless of band', () => {
    for (const [confidence, band] of [[0, 'unknown'], [30, 'very_low']] as const) {
      const bundle = makeBundleWithConfidence(confidence, band, 'success');
      const hints = generateOptimisationHints(bundle);
      const opt004 = hints.find(h => h.rule_id === 'OPT-004');
      expect(opt004?.rule_id).toBe('OPT-004');
    }
  });
});
