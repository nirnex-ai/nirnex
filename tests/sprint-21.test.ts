/**
 * Sprint 21 — Confidence Evolution Tracking (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Coverage:
 *
 * A. ConfidenceBand computation (unit, no DB)
 *   1.  score ≥ 80 → 'high'
 *   2.  score ≥ 60 and < 80 → 'moderate'
 *   3.  score ≥ 40 and < 60 → 'low'
 *   4.  score < 40 → 'very_low'
 *   5.  forced_unknown=true overrides numeric band → 'forced_unknown'
 *   6.  blocked=true overrides numeric band → 'blocked'
 *
 * B. Ledger type and validator
 *   7.  ConfidenceSnapshotRecord with all required fields → validatePayload passes
 *   8.  Missing computed_confidence → validation error
 *   9.  Invalid confidence_band value → validation error
 *   10. payload.kind='confidence_snapshot' ↔ record_type='confidence_snapshot' enforced by validateLedgerEntry
 *   11. 'confidence' is a valid LedgerStage
 *   12. 'confidence_snapshot' is a valid LedgerRecordType
 *
 * C. Orchestrator checkpoint emission
 *   13. ECO_BUILD completes → onLedgerEntry receives snapshot with snapshot_index=1, trigger='eco_initialized'
 *   14. SUFFICIENCY_GATE completes → snapshot with snapshot_index=2, trigger='evidence_gate_evaluated'
 *   15. CLASSIFY_LANE completes → snapshot with snapshot_index=3, trigger='lane_classified'
 *   16. Final outcome → snapshot with snapshot_index=4, trigger='final_outcome_sealed'
 *   17. All 4 snapshots share the same trace_id
 *   18. Every snapshot has record_type='confidence_snapshot' and stage='confidence'
 *
 * D. Reader helpers
 *   19. fetchConfidenceTimeline returns all snapshots for a trace ordered by snapshot_index ASC
 *   20. fetchConfidenceTimeline returns [] when no snapshots exist for trace
 *   21. fetchLatestConfidenceSnapshot returns the highest snapshot_index entry
 *   22. fetchLatestConfidenceSnapshot returns null when no snapshots exist
 *   23. Timeline contains only confidence_snapshot records (no other record types)
 *   24. fetchConfidenceTimeline filters by trace_id
 *
 * E. Diff computation
 *   25. First snapshot (no previous) → delta_composite is null
 *   26. Two snapshots with same computed_confidence → delta_composite=0
 *   27. Confidence increases by 10 → delta_composite=10
 *   28. Confidence decreases by 5 → delta_composite=-5
 *   29. Band changes (e.g. moderate→high) → delta_reasons includes a band-transition string
 *   30. No band change → delta_reasons does NOT include a band-transition string
 *
 * F. Dimension score mapping
 *   31. ECO dim severity='pass' → dimension score=100
 *   32. ECO dim severity='warn' → dimension score=60
 *   33. ECO dim severity='escalate' → dimension score=40
 *   34. ECO dim severity='block' → dimension score=0
 *   35. forced_unknown=true in eco → snapshot has confidence_band='forced_unknown'
 *   36. forced_lane_minimum set in eco → snapshot's effective_lane reflects it
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  computeConfidenceBand,
  computeConfidenceDiff,
  buildConfidenceSnapshot,
  ecoSeverityToScore,
  CONFIDENCE_MODEL_VERSION,
  type ConfidenceSnapshotRecord,
  type ConfidenceBand,
  type ConfidenceTriggerType,
} from '../packages/core/src/runtime/confidence/index.js';

import {
  validateLedgerEntry,
  validatePayload,
} from '../packages/core/src/runtime/ledger/validators.js';

import {
  appendLedgerEntry,
} from '../packages/core/src/runtime/ledger/writer.js';

import {
  LEDGER_TABLE_SQL,
} from '../packages/core/src/runtime/ledger/schema.js';

import { LedgerReader } from '../packages/core/src/runtime/ledger/reader.js';

import { fromConfidenceSnapshot } from '../packages/core/src/runtime/ledger/mappers.js';

import { runOrchestrator } from '../packages/core/src/pipeline/orchestrator.js';

import type { LedgerEntry } from '../packages/core/src/runtime/ledger/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(LEDGER_TABLE_SQL);
  return db;
}

function makeValidSnapshot(overrides: Partial<ConfidenceSnapshotRecord> = {}): ConfidenceSnapshotRecord {
  return {
    kind: 'confidence_snapshot',
    snapshot_index: 1,
    confidence_model_version: CONFIDENCE_MODEL_VERSION,
    computed_confidence: 75,
    effective_confidence: 75,
    confidence_band: 'moderate',
    stage_name: 'ECO_BUILD',
    trigger_type: 'eco_initialized',
    dimensions: {
      coverage: 100,
      freshness: 100,
      mapping: 60,
      conflict: 100,
      graph_completeness: 100,
    },
    ...overrides,
  };
}

function makeHandlers() {
  return {
    INTENT_DETECT: async () => ({
      primary: 'test-intent',
      composite: false,
    }),
    ECO_BUILD: async () => ({
      intent: { primary: 'test-intent', composite: false },
      eco_dimensions: {
        coverage:  { severity: 'pass',     detail: '' },
        freshness: { severity: 'pass',     detail: '' },
        mapping:   { severity: 'warn',     detail: '' },
        conflict:  { severity: 'pass',     detail: '', conflict_payload: null },
        graph:     { severity: 'escalate', detail: '' },
      },
      confidence_score: 72,
    }),
    SUFFICIENCY_GATE: async () => ({
      behavior: 'pass' as const,
      lane: 'A',
      reason: 'sufficient evidence',
    }),
    TEE_BUILD: async () => ({
      blocked_paths: [],
      blocked_symbols: [],
      clarification_questions: [],
      proceed_warnings: [],
    }),
    CLASSIFY_LANE: async () => ({
      lane: 'A',
      set_by: 'P1' as const,
      reason: 'low risk',
    }),
  };
}

// ─── A. ConfidenceBand computation ────────────────────────────────────────────

describe('A. computeConfidenceBand', () => {
  it('1. score ≥ 80 → high', () => {
    expect(computeConfidenceBand(80)).toBe('high');
    expect(computeConfidenceBand(95)).toBe('high');
    expect(computeConfidenceBand(100)).toBe('high');
  });

  it('2. score ≥ 60 and < 80 → moderate', () => {
    expect(computeConfidenceBand(60)).toBe('moderate');
    expect(computeConfidenceBand(79)).toBe('moderate');
    expect(computeConfidenceBand(72)).toBe('moderate');
  });

  it('3. score ≥ 40 and < 60 → low', () => {
    expect(computeConfidenceBand(40)).toBe('low');
    expect(computeConfidenceBand(59)).toBe('low');
  });

  it('4. score < 40 → very_low', () => {
    expect(computeConfidenceBand(0)).toBe('very_low');
    expect(computeConfidenceBand(39)).toBe('very_low');
  });

  it('5. forced_unknown=true overrides numeric band → forced_unknown', () => {
    expect(computeConfidenceBand(95, { forced_unknown: true })).toBe('forced_unknown');
    expect(computeConfidenceBand(0, { forced_unknown: true })).toBe('forced_unknown');
  });

  it('6. blocked=true overrides numeric band → blocked', () => {
    expect(computeConfidenceBand(95, { blocked: true })).toBe('blocked');
    expect(computeConfidenceBand(0, { blocked: true })).toBe('blocked');
  });
});

// ─── B. Ledger type and validator ─────────────────────────────────────────────

describe('B. Ledger type and validator', () => {
  it('7. ConfidenceSnapshotRecord with valid fields → validatePayload passes', () => {
    const snapshot = makeValidSnapshot();
    const result = validatePayload('confidence_snapshot', snapshot);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('8. Missing computed_confidence → validation error', () => {
    const snapshot = makeValidSnapshot();
    const { computed_confidence: _removed, ...partial } = snapshot;
    const result = validatePayload('confidence_snapshot', partial);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('computed_confidence'))).toBe(true);
  });

  it('9. Invalid confidence_band value → validation error', () => {
    const snapshot = makeValidSnapshot({ confidence_band: 'ultra_high' as ConfidenceBand });
    const result = validatePayload('confidence_snapshot', snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('confidence_band'))).toBe(true);
  });

  it('10. payload.kind mismatches record_type → validateLedgerEntry error', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'confidence',
      record_type: 'decision',  // mismatch — payload.kind will be confidence_snapshot
      actor: 'system',
      payload: makeValidSnapshot() as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('mismatch'))).toBe(true);
  });

  it('11. confidence is a valid LedgerStage', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'confidence',
      record_type: 'confidence_snapshot',
      actor: 'system',
      payload: makeValidSnapshot() as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    // Should not have stage validation error
    expect(result.errors.some(e => e.includes('unknown stage'))).toBe(false);
  });

  it('12. confidence_snapshot is a valid LedgerRecordType', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'confidence',
      record_type: 'confidence_snapshot',
      actor: 'system',
      payload: makeValidSnapshot() as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.errors.some(e => e.includes('unknown record_type'))).toBe(false);
  });
});

// ─── C. Orchestrator checkpoint emission ──────────────────────────────────────

describe('C. Orchestrator checkpoint emission', () => {
  it('13. ECO_BUILD completes → snapshot with snapshot_index=1, trigger=eco_initialized', async () => {
    const ledgerEntries: LedgerEntry[] = [];
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableConfidenceTracking: true,
        onLedgerEntry: e => ledgerEntries.push(e),
      },
      makeHandlers(),
    );
    const snapshots = ledgerEntries.filter(e => e.record_type === 'confidence_snapshot');
    const first = snapshots.find(
      e => (e.payload as ConfidenceSnapshotRecord).snapshot_index === 1,
    );
    expect(first).toBeDefined();
    expect((first!.payload as ConfidenceSnapshotRecord).trigger_type).toBe('eco_initialized');
  });

  it('14. SUFFICIENCY_GATE completes → snapshot with snapshot_index=2, trigger=evidence_gate_evaluated', async () => {
    const ledgerEntries: LedgerEntry[] = [];
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableConfidenceTracking: true,
        onLedgerEntry: e => ledgerEntries.push(e),
      },
      makeHandlers(),
    );
    const snapshots = ledgerEntries.filter(e => e.record_type === 'confidence_snapshot');
    const second = snapshots.find(
      e => (e.payload as ConfidenceSnapshotRecord).snapshot_index === 2,
    );
    expect(second).toBeDefined();
    expect((second!.payload as ConfidenceSnapshotRecord).trigger_type).toBe('evidence_gate_evaluated');
  });

  it('15. CLASSIFY_LANE completes → snapshot with snapshot_index=3, trigger=lane_classified', async () => {
    const ledgerEntries: LedgerEntry[] = [];
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableConfidenceTracking: true,
        onLedgerEntry: e => ledgerEntries.push(e),
      },
      makeHandlers(),
    );
    const snapshots = ledgerEntries.filter(e => e.record_type === 'confidence_snapshot');
    const third = snapshots.find(
      e => (e.payload as ConfidenceSnapshotRecord).snapshot_index === 3,
    );
    expect(third).toBeDefined();
    expect((third!.payload as ConfidenceSnapshotRecord).trigger_type).toBe('lane_classified');
  });

  it('16. Final outcome → snapshot with snapshot_index=4, trigger=final_outcome_sealed', async () => {
    const ledgerEntries: LedgerEntry[] = [];
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableConfidenceTracking: true,
        onLedgerEntry: e => ledgerEntries.push(e),
      },
      makeHandlers(),
    );
    const snapshots = ledgerEntries.filter(e => e.record_type === 'confidence_snapshot');
    const fourth = snapshots.find(
      e => (e.payload as ConfidenceSnapshotRecord).snapshot_index === 4,
    );
    expect(fourth).toBeDefined();
    expect((fourth!.payload as ConfidenceSnapshotRecord).trigger_type).toBe('final_outcome_sealed');
  });

  it('17. All 4 snapshots share the same trace_id', async () => {
    const ledgerEntries: LedgerEntry[] = [];
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableConfidenceTracking: true,
        onLedgerEntry: e => ledgerEntries.push(e),
      },
      makeHandlers(),
    );
    const snapshots = ledgerEntries.filter(e => e.record_type === 'confidence_snapshot');
    expect(snapshots).toHaveLength(4);
    const traceIds = new Set(snapshots.map(e => e.trace_id));
    expect(traceIds.size).toBe(1);
  });

  it('18. Every snapshot has record_type=confidence_snapshot and stage=confidence', async () => {
    const ledgerEntries: LedgerEntry[] = [];
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableConfidenceTracking: true,
        onLedgerEntry: e => ledgerEntries.push(e),
      },
      makeHandlers(),
    );
    const snapshots = ledgerEntries.filter(e => e.record_type === 'confidence_snapshot');
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) {
      expect(s.record_type).toBe('confidence_snapshot');
      expect(s.stage).toBe('confidence');
    }
  });
});

// ─── D. Reader helpers ────────────────────────────────────────────────────────

describe('D. Reader helpers', () => {
  let db: Database.Database;
  let reader: LedgerReader;
  const traceId = 'tr_reader_test_001';
  const otherTraceId = 'tr_reader_other_002';
  const requestId = 'req_test_001';

  beforeEach(() => {
    db = makeInMemoryDb();
    reader = new LedgerReader(db);
  });

  function appendSnapshot(overrides: Partial<ConfidenceSnapshotRecord> = {}, tid = traceId) {
    const snapshot = makeValidSnapshot(overrides);
    const entry = fromConfidenceSnapshot(snapshot, {
      trace_id: tid,
      request_id: requestId,
    });
    appendLedgerEntry(db, entry);
    return entry;
  }

  it('19. fetchConfidenceTimeline returns all snapshots ordered by snapshot_index ASC', () => {
    appendSnapshot({ snapshot_index: 1 });
    appendSnapshot({ snapshot_index: 3 });
    appendSnapshot({ snapshot_index: 2 });
    const timeline = reader.fetchConfidenceTimeline(traceId);
    expect(timeline).toHaveLength(3);
    expect((timeline[0].payload as ConfidenceSnapshotRecord).snapshot_index).toBe(1);
    expect((timeline[1].payload as ConfidenceSnapshotRecord).snapshot_index).toBe(2);
    expect((timeline[2].payload as ConfidenceSnapshotRecord).snapshot_index).toBe(3);
  });

  it('20. fetchConfidenceTimeline returns [] when no snapshots exist', () => {
    const timeline = reader.fetchConfidenceTimeline(traceId);
    expect(timeline).toEqual([]);
  });

  it('21. fetchLatestConfidenceSnapshot returns highest snapshot_index entry', () => {
    appendSnapshot({ snapshot_index: 1 });
    appendSnapshot({ snapshot_index: 2 });
    appendSnapshot({ snapshot_index: 3, computed_confidence: 88, confidence_band: 'high' });
    const latest = reader.fetchLatestConfidenceSnapshot(traceId);
    expect(latest).not.toBeNull();
    expect((latest!.payload as ConfidenceSnapshotRecord).snapshot_index).toBe(3);
    expect((latest!.payload as ConfidenceSnapshotRecord).computed_confidence).toBe(88);
  });

  it('22. fetchLatestConfidenceSnapshot returns null when no snapshots', () => {
    const latest = reader.fetchLatestConfidenceSnapshot(traceId);
    expect(latest).toBeNull();
  });

  it('23. Timeline contains only confidence_snapshot records', () => {
    appendSnapshot({ snapshot_index: 1 });
    // Also append a non-snapshot entry
    const nonSnapshot: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: traceId,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      stage: 'eco',
      record_type: 'decision',
      actor: 'system',
      payload: {
        kind: 'decision',
        decision_name: 'eco computed',
        decision_code: 'ECO_COMPUTED',
        input_refs: {},
        result: { status: 'pass' },
        rationale: { summary: 'test', rule_refs: [] },
      },
    };
    appendLedgerEntry(db, nonSnapshot);

    const timeline = reader.fetchConfidenceTimeline(traceId);
    expect(timeline.every(e => e.record_type === 'confidence_snapshot')).toBe(true);
    expect(timeline).toHaveLength(1);
  });

  it('24. fetchConfidenceTimeline filters by trace_id', () => {
    appendSnapshot({ snapshot_index: 1 }, traceId);
    appendSnapshot({ snapshot_index: 1 }, otherTraceId);
    const timeline = reader.fetchConfidenceTimeline(traceId);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].trace_id).toBe(traceId);
  });
});

// ─── E. Diff computation ──────────────────────────────────────────────────────

describe('E. computeConfidenceDiff', () => {
  it('25. First snapshot (no previous) → delta_composite is null', () => {
    const current = makeValidSnapshot({ snapshot_index: 1, computed_confidence: 75 });
    const diff = computeConfidenceDiff(current);
    expect(diff.delta_composite).toBeNull();
  });

  it('26. Two snapshots with same computed_confidence → delta_composite=0', () => {
    const previous = makeValidSnapshot({ snapshot_index: 1, computed_confidence: 75 });
    const current  = makeValidSnapshot({ snapshot_index: 2, computed_confidence: 75 });
    const diff = computeConfidenceDiff(current, previous);
    expect(diff.delta_composite).toBe(0);
  });

  it('27. Confidence increases by 10 → delta_composite=10', () => {
    const previous = makeValidSnapshot({ snapshot_index: 1, computed_confidence: 65 });
    const current  = makeValidSnapshot({ snapshot_index: 2, computed_confidence: 75 });
    const diff = computeConfidenceDiff(current, previous);
    expect(diff.delta_composite).toBe(10);
  });

  it('28. Confidence decreases by 5 → delta_composite=-5', () => {
    const previous = makeValidSnapshot({ snapshot_index: 1, computed_confidence: 80 });
    const current  = makeValidSnapshot({ snapshot_index: 2, computed_confidence: 75 });
    const diff = computeConfidenceDiff(current, previous);
    expect(diff.delta_composite).toBe(-5);
  });

  it('29. Band changes (moderate→high) → delta_reasons includes band-transition string', () => {
    const previous = makeValidSnapshot({ snapshot_index: 1, computed_confidence: 70, confidence_band: 'moderate' });
    const current  = makeValidSnapshot({ snapshot_index: 2, computed_confidence: 85, confidence_band: 'high' });
    const diff = computeConfidenceDiff(current, previous);
    expect(diff.delta_reasons.some(r => r.includes('moderate') && r.includes('high'))).toBe(true);
  });

  it('30. No band change → delta_reasons does NOT include band-transition string', () => {
    const previous = makeValidSnapshot({ snapshot_index: 1, computed_confidence: 70, confidence_band: 'moderate' });
    const current  = makeValidSnapshot({ snapshot_index: 2, computed_confidence: 75, confidence_band: 'moderate' });
    const diff = computeConfidenceDiff(current, previous);
    // No band transition
    expect(diff.delta_reasons.some(r => r.includes('band_transition'))).toBe(false);
  });
});

// ─── F. Dimension score mapping ───────────────────────────────────────────────

describe('F. Dimension score mapping', () => {
  it('31. ECO dim severity=pass → dimension score=100', () => {
    expect(ecoSeverityToScore('pass')).toBe(100);
  });

  it('32. ECO dim severity=warn → dimension score=60', () => {
    expect(ecoSeverityToScore('warn')).toBe(60);
  });

  it('33. ECO dim severity=escalate → dimension score=40', () => {
    expect(ecoSeverityToScore('escalate')).toBe(40);
  });

  it('34. ECO dim severity=block → dimension score=0', () => {
    expect(ecoSeverityToScore('block')).toBe(0);
  });

  it('35. forced_unknown=true in eco → snapshot has confidence_band=forced_unknown', async () => {
    const ledgerEntries: LedgerEntry[] = [];
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableConfidenceTracking: true,
        onLedgerEntry: e => ledgerEntries.push(e),
      },
      {
        ...makeHandlers(),
        ECO_BUILD: async () => ({
          intent: { primary: 'test-intent', composite: false },
          eco_dimensions: {
            coverage:  { severity: 'pass', detail: '' },
            freshness: { severity: 'pass', detail: '' },
            mapping:   { severity: 'pass', detail: '' },
            conflict:  { severity: 'pass', detail: '', conflict_payload: null },
            graph:     { severity: 'pass', detail: '' },
          },
          confidence_score: 95,
          forced_unknown: true,
        }),
      },
    );
    const snapshots = ledgerEntries.filter(e => e.record_type === 'confidence_snapshot');
    const ecoSnapshot = snapshots.find(
      e => (e.payload as ConfidenceSnapshotRecord).snapshot_index === 1,
    );
    expect(ecoSnapshot).toBeDefined();
    expect((ecoSnapshot!.payload as ConfidenceSnapshotRecord).confidence_band).toBe('forced_unknown');
  });

  it('36. forced_lane_minimum set in eco → snapshot effective_lane reflects it', async () => {
    const ledgerEntries: LedgerEntry[] = [];
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableConfidenceTracking: true,
        onLedgerEntry: e => ledgerEntries.push(e),
      },
      {
        ...makeHandlers(),
        ECO_BUILD: async () => ({
          intent: { primary: 'test-intent', composite: false },
          eco_dimensions: {
            coverage:  { severity: 'pass', detail: '' },
            freshness: { severity: 'pass', detail: '' },
            mapping:   { severity: 'pass', detail: '' },
            conflict:  { severity: 'pass', detail: '', conflict_payload: null },
            graph:     { severity: 'pass', detail: '' },
          },
          confidence_score: 80,
          forced_lane_minimum: 'B',
        }),
      },
    );
    const snapshots = ledgerEntries.filter(e => e.record_type === 'confidence_snapshot');
    const ecoSnapshot = snapshots.find(
      e => (e.payload as ConfidenceSnapshotRecord).snapshot_index === 1,
    );
    expect(ecoSnapshot).toBeDefined();
    expect((ecoSnapshot!.payload as ConfidenceSnapshotRecord).effective_lane).toBe('B');
  });
});
