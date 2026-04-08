/**
 * Sprint 31 — Assembler Confidence Fallback Consistency (TDD)
 *
 * Addresses the governance defect identified in the Level 2 validation
 * assessment: when no confidence_snapshot ledger entries exist but a
 * run_outcome_summary carries final_confidence, the assembled bundle
 * reported inconsistent fields:
 *
 *   overall_confidence   = 40  (correctly uses outcomeFinalConfidence fallback)
 *   effective_confidence = 0   (BUG: ignores outcomeFinalConfidence fallback)
 *   band                 = 'unknown'  (correct — no snapshot data)
 *
 * The effective_confidence field must match overall_confidence when both
 * derive from the same fallback source (run_outcome_summary.final_confidence).
 * Reporting effective_confidence = 0 while overall_confidence = 40 is
 * misleading and undermines governance signal quality.
 *
 * Fix:
 *   assembler.ts line 391: extend effective_confidence fallback chain to
 *   include outcomeFinalConfidence, matching the overall_confidence fallback.
 *
 * Coverage:
 *
 * 1. Assembler — effective_confidence fallback consistency
 *    1.1  When no confidence_snapshot exists and run_outcome_summary has
 *         final_confidence: 40, effective_confidence equals 40 (not 0)
 *    1.2  When no confidence_snapshot exists and run_outcome_summary has
 *         final_confidence: 40, overall_confidence also equals 40
 *    1.3  overall_confidence and effective_confidence are equal when
 *         both derive from the same fallback source
 *    1.4  When confidence_snapshot exists, effective_confidence derives
 *         from the snapshot (not the fallback)
 *    1.5  When neither snapshot nor run_outcome_summary exists,
 *         both overall_confidence and effective_confidence are 0
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

import { assembleReport } from '../packages/core/src/runtime/reporting/assembler.js';

import type { LedgerEntry } from '../packages/core/src/runtime/ledger/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TRACE_ID   = 'tr_sprint31_test';
const REQUEST_ID = 'req_sprint31_test';

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    schema_version: '1.0.0',
    ledger_id:      randomUUID(),
    trace_id:       TRACE_ID,
    request_id:     REQUEST_ID,
    timestamp:      new Date().toISOString(),
    stage:          'outcome',
    record_type:    'outcome',
    actor:          'system',
    payload: {
      kind:              'outcome',
      completion_state:  'merged',
      final_disposition_reason: 'pipeline completed',
      final_lane:        'A',
    } as LedgerEntry['payload'],
    ...overrides,
  };
}

function makeRunOutcomeSummaryEntry(finalConfidence: number): LedgerEntry {
  return makeLedgerEntry({
    stage:       'outcome',
    record_type: 'run_outcome_summary',
    payload: {
      kind:              'run_outcome_summary',
      summarized_trace_id: TRACE_ID,
      completion_state:  'merged',
      final_lane:        'A',
      final_confidence:  finalConfidence,
      had_refusal:       false,
      had_override:      false,
      forced_unknown_applied: false,
      evidence_gate_failed:   false,
      stages_completed:       5,
    } as unknown as LedgerEntry['payload'],
  });
}

function makeConfidenceSnapshotEntry(computedConfidence: number, effectiveConfidence: number): LedgerEntry {
  return makeLedgerEntry({
    stage:       'eco',
    record_type: 'confidence_snapshot',
    payload: {
      kind:                     'confidence_snapshot',
      snapshot_index:           1,
      confidence_model_version: '3.0.0',
      computed_confidence:      computedConfidence,
      effective_confidence:     effectiveConfidence,
      confidence_band:          computedConfidence >= 80 ? 'high' : computedConfidence >= 60 ? 'moderate' : computedConfidence >= 40 ? 'low' : 'very_low',
      stage_name:               'eco',
      trigger_type:             'eco_initialized',
      dimensions:               {},
    } as unknown as LedgerEntry['payload'],
  });
}

// ─── 1. Assembler — effective_confidence fallback consistency ─────────────────

describe('1. Assembler — effective_confidence fallback consistency', () => {
  it('1.1 effective_confidence equals outcomeFinalConfidence when no snapshot exists', () => {
    const entries = [makeRunOutcomeSummaryEntry(40)];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.confidence.effective_confidence).toBe(40);
  });

  it('1.2 overall_confidence equals outcomeFinalConfidence when no snapshot exists', () => {
    const entries = [makeRunOutcomeSummaryEntry(40)];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.confidence.overall_confidence).toBe(40);
  });

  it('1.3 overall_confidence and effective_confidence are equal when from the same fallback source', () => {
    const entries = [makeRunOutcomeSummaryEntry(40)];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.confidence.overall_confidence).toBe(bundle.confidence.effective_confidence);
  });

  it('1.4 effective_confidence derives from snapshot when one exists (not fallback)', () => {
    const entries = [
      makeConfidenceSnapshotEntry(75, 75),
      makeRunOutcomeSummaryEntry(40),
    ];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    // Snapshot takes priority over run_outcome_summary fallback
    expect(bundle.confidence.overall_confidence).toBe(75);
    expect(bundle.confidence.effective_confidence).toBe(75);
  });

  it('1.5 both fields are 0 when neither snapshot nor run_outcome_summary exists', () => {
    const entries: LedgerEntry[] = [];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.confidence.overall_confidence).toBe(0);
    expect(bundle.confidence.effective_confidence).toBe(0);
  });
});
