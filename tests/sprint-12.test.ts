/**
 * Sprint 12 — Canonical Decision Ledger Schema
 *
 * TDD test suite. Tests are written before implementation.
 * Covers: schema/types, validators, writer, reader, mappers, orchestrator wiring,
 * correlation model, DB path ownership.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Imports under test ────────────────────────────────────────────────────────
import {
  LEDGER_SCHEMA_VERSION,
  type LedgerEntry,
  type DecisionRecord,
  type OverrideRecord,
  type OutcomeRecord,
  type RefusalRecord,
  type DeviationRecord,
  type TraceAdapterRecord,
  type LedgerPayload,
  type LedgerStage,
  type LedgerRecordType,
} from '../packages/core/src/runtime/ledger/types.js';

import {
  getLedgerDbPath,
  LEDGER_TABLE_SQL,
} from '../packages/core/src/runtime/ledger/schema.js';

import {
  validateLedgerEntry,
  validateDecisionRecord,
  validateOverrideRecord,
  validateOutcomeRecord,
  validateRefusalRecord,
  validateDeviationRecord,
  type ValidationResult,
} from '../packages/core/src/runtime/ledger/validators.js';

import {
  initLedgerDb,
  appendLedgerEntry,
  appendLedgerEntryAsync,
  LedgerValidationError,
} from '../packages/core/src/runtime/ledger/writer.js';

import {
  LedgerReader,
} from '../packages/core/src/runtime/ledger/reader.js';

import {
  fromBoundTrace,
  fromDimensionScoringTrace,
  fromConflictEvents,
  fromRefusal,
  fromOrchestratorResult,
  fromTraceJson,
} from '../packages/core/src/runtime/ledger/mappers.js';

import type { BoundTrace } from '../packages/core/src/pipeline/types.js';
import type { ConflictLedgerEvent } from '../packages/core/src/knowledge/conflict/types.js';
import type { DimensionScoringTrace } from '../packages/core/src/knowledge/ledger/traceDimensionScoring.js';
import type { OrchestratorResult } from '../packages/core/src/pipeline/orchestrator.js';
import { runOrchestrator } from '../packages/core/src/pipeline/orchestrator.js';

// ─── Test root ────────────────────────────────────────────────────────────────

const TEST_ROOT = join(tmpdir(), `nirnex-sprint12-${Date.now()}`);
const TEST_ROOT_B = join(tmpdir(), `nirnex-sprint12-b-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  mkdirSync(TEST_ROOT_B, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  rmSync(TEST_ROOT_B, { recursive: true, force: true });
});

// ─── Fixture factories ────────────────────────────────────────────────────────

function makeDecisionPayload(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    kind: 'decision',
    decision_name: 'intent_detected',
    decision_code: 'INTENT_DETECTED',
    input_refs: {},
    result: { status: 'pass' },
    rationale: { summary: 'Intent detected successfully', rule_refs: ['RULE_001'] },
    ...overrides,
  };
}

function makeOutcomePayload(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    kind: 'outcome',
    completion_state: 'merged',
    final_lane: 'A',
    final_disposition_reason: 'Pipeline completed successfully',
    ...overrides,
  };
}

function makeRefusalPayload(overrides: Partial<RefusalRecord> = {}): RefusalRecord {
  return {
    kind: 'refusal',
    refusal_code: 'COVERAGE_BLOCK',
    refusal_reason: 'Coverage dimension blocked execution',
    blocking_dimension: 'coverage',
    ...overrides,
  };
}

function makeOverridePayload(overrides: Partial<OverrideRecord> = {}): OverrideRecord {
  return {
    kind: 'override',
    override_id: 'ovr_test_001',
    target_stage: 'eco',
    scope: {},
    reason: 'Manual override for testing',
    approved_by: 'human',
    effect: 'allow',
    ...overrides,
  };
}

function makeDeviationPayload(overrides: Partial<DeviationRecord> = {}): DeviationRecord {
  return {
    kind: 'deviation',
    detected_at_stage: 'validation',
    observed_summary: 'Output diverged from expected schema',
    severity: 'low',
    disposition: 'logged',
    ...overrides,
  };
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    schema_version: '1.0.0',
    ledger_id: `led_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    trace_id: 'tr_test_001',
    request_id: 'req_test_001',
    timestamp: new Date().toISOString(),
    stage: 'knowledge',
    record_type: 'decision',
    actor: 'system',
    payload: makeDecisionPayload(),
    ...overrides,
  };
}

function makeBoundTrace(overrides: Partial<BoundTrace> = {}): BoundTrace {
  return {
    stage: 'INTENT_DETECT',
    status: 'ok',
    inputHash: 'abcd1234',
    timestamp: new Date().toISOString(),
    durationMs: 12,
    input: { specPath: null, query: 'test' },
    output: { primary: 'bug_fix', composite: false },
    ...overrides,
  };
}

function makeConflictEvents(count = 2): ConflictLedgerEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'structural_conflicts_found' as const,
    timestamp: new Date().toISOString(),
    payload: { conflictId: `cfl_${i}`, type: 'hub_collision' },
  }));
}

function makeDimensionScoringTrace(): DimensionScoringTrace {
  const dimEntry = {
    status: 'pass' as const,
    value: 0.95,
    reason_codes: ['COVERAGE_FULL'],
    summary: 'Coverage complete',
    metrics: { scopeRatio: 1.0 },
    provenance: { signals: ['matchedScopeCount'], thresholds: { pass: 0.80 } },
  };
  return {
    timestamp: new Date().toISOString(),
    calculation_version: '1.0.0',
    composite_internal_confidence: 92,
    coverage: dimEntry,
    freshness: dimEntry,
    mapping: dimEntry,
    conflict: dimEntry,
    graph: dimEntry,
    dimensions: { coverage: dimEntry, freshness: dimEntry, mapping: dimEntry, conflict: dimEntry, graph: dimEntry },
    signal_snapshot: { intent: 'bug_fix', matchedScopeCount: 3 },
  };
}

function makeOrchestratorResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    completed: true,
    blocked: false,
    escalated: false,
    degraded: false,
    stageResults: [],
    finalLane: 'A',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Schema / Types
// ═══════════════════════════════════════════════════════════════════════════════

describe('Schema — LEDGER_SCHEMA_VERSION', () => {
  it('is exactly "1.0.0"', () => {
    expect(LEDGER_SCHEMA_VERSION).toBe('1.0.0');
  });
});

describe('Schema — LedgerEntry shape', () => {
  it('has all required envelope fields', () => {
    const entry = makeLedgerEntry();
    expect(entry).toHaveProperty('schema_version', '1.0.0');
    expect(entry).toHaveProperty('ledger_id');
    expect(entry).toHaveProperty('trace_id');
    expect(entry).toHaveProperty('request_id');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('stage');
    expect(entry).toHaveProperty('record_type');
    expect(entry).toHaveProperty('actor');
    expect(entry).toHaveProperty('payload');
  });

  it('accepts optional fields: session_id, tee_id, parent_ledger_id', () => {
    const entry = makeLedgerEntry({
      session_id: 'sess_001',
      tee_id: 'tee_001',
      parent_ledger_id: 'led_parent_001',
    });
    expect(entry.session_id).toBe('sess_001');
    expect(entry.tee_id).toBe('tee_001');
    expect(entry.parent_ledger_id).toBe('led_parent_001');
  });
});

describe('Schema — record families', () => {
  it('DecisionRecord has required fields: kind, decision_name, decision_code, input_refs, result, rationale', () => {
    const p = makeDecisionPayload();
    expect(p.kind).toBe('decision');
    expect(p.decision_name).toBeTruthy();
    expect(p.decision_code).toBeTruthy();
    expect(p).toHaveProperty('input_refs');
    expect(p).toHaveProperty('result');
    expect(p).toHaveProperty('rationale');
  });

  it('OverrideRecord has required fields: kind, override_id, target_stage, scope, reason, approved_by, effect', () => {
    const p = makeOverridePayload();
    expect(p.kind).toBe('override');
    expect(p.override_id).toBeTruthy();
    expect(p.target_stage).toBeTruthy();
    expect(p).toHaveProperty('scope');
    expect(p.reason).toBeTruthy();
    expect(p.approved_by).toBeTruthy();
    expect(p.effect).toBeTruthy();
  });

  it('OutcomeRecord has required fields: kind, completion_state, final_disposition_reason', () => {
    const p = makeOutcomePayload();
    expect(p.kind).toBe('outcome');
    expect(p.completion_state).toBeTruthy();
    expect(p.final_disposition_reason).toBeTruthy();
  });

  it('RefusalRecord has required fields: kind, refusal_code, refusal_reason', () => {
    const p = makeRefusalPayload();
    expect(p.kind).toBe('refusal');
    expect(p.refusal_code).toBeTruthy();
    expect(p.refusal_reason).toBeTruthy();
  });

  it('DeviationRecord has required fields: kind, detected_at_stage, observed_summary, severity, disposition', () => {
    const p = makeDeviationPayload();
    expect(p.kind).toBe('deviation');
    expect(p.detected_at_stage).toBeTruthy();
    expect(p.observed_summary).toBeTruthy();
    expect(['low', 'medium', 'high']).toContain(p.severity);
    expect(['logged', 'escalated', 'overridden', 'abandoned']).toContain(p.disposition);
  });

  it('TraceAdapterRecord has kind: "trace" and raw field', () => {
    const p: TraceAdapterRecord = { kind: 'trace', raw: { some: 'data' } };
    expect(p.kind).toBe('trace');
    expect(p.raw).toBeTruthy();
  });
});

describe('Schema — LEDGER_TABLE_SQL', () => {
  it('contains ledger_entries table definition', () => {
    expect(LEDGER_TABLE_SQL).toContain('CREATE TABLE IF NOT EXISTS ledger_entries');
  });

  it('has all required columns', () => {
    const cols = ['ledger_id', 'request_id', 'trace_id', 'tee_id', 'stage', 'record_type', 'actor', 'timestamp', 'schema_version', 'payload_json'];
    for (const col of cols) {
      expect(LEDGER_TABLE_SQL).toContain(col);
    }
  });

  it('creates indexes for query performance', () => {
    expect(LEDGER_TABLE_SQL).toContain('CREATE INDEX');
    expect(LEDGER_TABLE_SQL).toContain('request_id');
    expect(LEDGER_TABLE_SQL).toContain('trace_id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateLedgerEntry — required fields', () => {
  it('passes a valid entry', () => {
    const result = validateLedgerEntry(makeLedgerEntry());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when schema_version is missing', () => {
    const entry = { ...makeLedgerEntry() };
    delete (entry as any).schema_version;
    const result = validateLedgerEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails when schema_version is wrong value', () => {
    const result = validateLedgerEntry({ ...makeLedgerEntry(), schema_version: '2.0.0' });
    expect(result.valid).toBe(false);
  });

  it('fails when ledger_id is missing', () => {
    const entry = { ...makeLedgerEntry() };
    delete (entry as any).ledger_id;
    expect(validateLedgerEntry(entry).valid).toBe(false);
  });

  it('fails when trace_id is missing', () => {
    const entry = { ...makeLedgerEntry() };
    delete (entry as any).trace_id;
    expect(validateLedgerEntry(entry).valid).toBe(false);
  });

  it('fails when request_id is missing', () => {
    const entry = { ...makeLedgerEntry() };
    delete (entry as any).request_id;
    expect(validateLedgerEntry(entry).valid).toBe(false);
  });

  it('fails when payload is missing', () => {
    const entry = { ...makeLedgerEntry() };
    delete (entry as any).payload;
    expect(validateLedgerEntry(entry).valid).toBe(false);
  });
});

describe('validateLedgerEntry — enum validation', () => {
  it('fails on unknown stage', () => {
    const result = validateLedgerEntry({ ...makeLedgerEntry(), stage: 'unknown_stage' });
    expect(result.valid).toBe(false);
  });

  it('passes all known stages', () => {
    const stages: LedgerStage[] = [
      'knowledge', 'eco', 'classification', 'strategy',
      'pre_tool_guard', 'implementation', 'validation',
      'post_tool_trace', 'stop', 'override', 'outcome',
    ];
    for (const stage of stages) {
      const entry = makeLedgerEntry({ stage });
      // Need matching record_type for payload kind — just check stage enum passes
      const result = validateLedgerEntry(entry);
      // Stage should not produce a stage-enum error specifically
      const stageErrors = result.errors.filter(e => e.includes('stage'));
      expect(stageErrors).toHaveLength(0);
    }
  });

  it('fails on unknown record_type', () => {
    const result = validateLedgerEntry({ ...makeLedgerEntry(), record_type: 'unknown_type' });
    expect(result.valid).toBe(false);
  });
});

describe('validateLedgerEntry — kind ↔ record_type invariant', () => {
  it('fails when record_type="decision" but payload.kind="outcome" (intentional mismatch)', () => {
    const entry = makeLedgerEntry({
      record_type: 'decision',
      payload: makeOutcomePayload(), // kind: 'outcome'
    });
    const result = validateLedgerEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('kind') || e.toLowerCase().includes('mismatch'))).toBe(true);
  });

  it('passes when record_type and payload.kind agree', () => {
    const entry = makeLedgerEntry({
      record_type: 'decision',
      payload: makeDecisionPayload(), // kind: 'decision'
    });
    expect(validateLedgerEntry(entry).valid).toBe(true);
  });

  it('fails when record_type="override" but payload.kind="decision"', () => {
    const entry = makeLedgerEntry({
      record_type: 'override',
      payload: makeDecisionPayload(), // kind: 'decision'
    });
    expect(validateLedgerEntry(entry).valid).toBe(false);
  });
});

describe('validateLedgerEntry — forward-compatible optional fields', () => {
  it('passes with unknown optional fields in payload (forward compat)', () => {
    const entry = makeLedgerEntry({
      payload: { ...makeDecisionPayload(), future_field: 'some_value' } as any,
    });
    expect(validateLedgerEntry(entry).valid).toBe(true);
  });

  it('passes with session_id and tee_id absent', () => {
    const entry = makeLedgerEntry();
    delete (entry as any).session_id;
    delete (entry as any).tee_id;
    expect(validateLedgerEntry(entry).valid).toBe(true);
  });
});

describe('validateDecisionRecord', () => {
  it('passes a valid decision record', () => {
    expect(validateDecisionRecord(makeDecisionPayload()).valid).toBe(true);
  });

  it('fails when decision_name missing', () => {
    const p = { ...makeDecisionPayload() };
    delete (p as any).decision_name;
    expect(validateDecisionRecord(p).valid).toBe(false);
  });

  it('fails when result.status is invalid', () => {
    const p = { ...makeDecisionPayload(), result: { status: 'unknown_status' } };
    expect(validateDecisionRecord(p).valid).toBe(false);
  });

  it('passes all valid result.status values', () => {
    const statuses = ['pass', 'warn', 'escalate', 'block', 'refuse'];
    for (const status of statuses) {
      const p = { ...makeDecisionPayload(), result: { status } };
      expect(validateDecisionRecord(p).valid).toBe(true);
    }
  });
});

describe('validateRefusalRecord', () => {
  it('passes a valid refusal record', () => {
    expect(validateRefusalRecord(makeRefusalPayload()).valid).toBe(true);
  });

  it('fails when refusal_code missing', () => {
    const p = { ...makeRefusalPayload() };
    delete (p as any).refusal_code;
    expect(validateRefusalRecord(p).valid).toBe(false);
  });
});

describe('validateOutcomeRecord', () => {
  it('passes a valid outcome record', () => {
    expect(validateOutcomeRecord(makeOutcomePayload()).valid).toBe(true);
  });

  it('fails when completion_state is invalid', () => {
    const p = { ...makeOutcomePayload(), completion_state: 'invalid_state' as any };
    expect(validateOutcomeRecord(p).valid).toBe(false);
  });

  it('passes all valid completion_state values', () => {
    const states = ['merged', 'escalated', 'abandoned', 'refused'];
    for (const completion_state of states) {
      const p = { ...makeOutcomePayload(), completion_state: completion_state as any };
      expect(validateOutcomeRecord(p).valid).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DB Path
// ═══════════════════════════════════════════════════════════════════════════════

describe('getLedgerDbPath', () => {
  it('returns a deterministic path under targetRoot', () => {
    const p = getLedgerDbPath('/some/project/root');
    expect(p).toContain('.aidos-ledger.db');
    expect(p).toContain('/some/project/root');
  });

  it('two different targetRoots produce distinct paths', () => {
    const p1 = getLedgerDbPath('/project/a');
    const p2 = getLedgerDbPath('/project/b');
    expect(p1).not.toBe(p2);
  });

  it('same targetRoot always produces same path (deterministic)', () => {
    const p1 = getLedgerDbPath('/consistent/root');
    const p2 = getLedgerDbPath('/consistent/root');
    expect(p1).toBe(p2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Writer
// ═══════════════════════════════════════════════════════════════════════════════

describe('initLedgerDb', () => {
  it('creates ledger DB and ledger_entries table', () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_entries'`
    ).get();
    expect(tableExists).toBeTruthy();
    db.close();
  });

  it('creates all required indexes', () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ledger_entries'`
    ).all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames.some(n => n.includes('request'))).toBe(true);
    expect(indexNames.some(n => n.includes('trace'))).toBe(true);
    db.close();
  });
});

describe('appendLedgerEntry', () => {
  it('persists a valid entry to the DB', () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const entry = makeLedgerEntry();
    appendLedgerEntry(db, entry);
    const row = db.prepare(`SELECT * FROM ledger_entries WHERE ledger_id = ?`).get(entry.ledger_id) as any;
    expect(row).toBeTruthy();
    expect(row.trace_id).toBe(entry.trace_id);
    expect(row.record_type).toBe('decision');
    db.close();
  });

  it('stores payload as JSON in payload_json column', () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const entry = makeLedgerEntry();
    appendLedgerEntry(db, entry);
    const row = db.prepare(`SELECT payload_json FROM ledger_entries WHERE ledger_id = ?`).get(entry.ledger_id) as any;
    const parsed = JSON.parse(row.payload_json);
    expect(parsed.kind).toBe('decision');
    db.close();
  });

  it('throws LedgerValidationError when entry is invalid', () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const badEntry = { ...makeLedgerEntry(), schema_version: '99.0.0' as any };
    expect(() => appendLedgerEntry(db, badEntry)).toThrow(LedgerValidationError);
    db.close();
  });

  it('throws on duplicate ledger_id (append-only, no upsert)', () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const entry = makeLedgerEntry();
    appendLedgerEntry(db, entry);
    expect(() => appendLedgerEntry(db, entry)).toThrow();
    db.close();
  });

  it('fills timestamp when absent', () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const entry = makeLedgerEntry();
    delete (entry as any).timestamp;
    appendLedgerEntry(db, entry);
    const row = db.prepare(`SELECT timestamp FROM ledger_entries WHERE ledger_id = ?`).get(entry.ledger_id) as any;
    expect(row.timestamp).toBeTruthy();
    db.close();
  });

  it('preserves mapper-supplied timestamp (does not overwrite)', () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const fixedTs = '2025-01-15T10:00:00.000Z';
    const entry = makeLedgerEntry({ timestamp: fixedTs });
    appendLedgerEntry(db, entry);
    const row = db.prepare(`SELECT timestamp FROM ledger_entries WHERE ledger_id = ?`).get(entry.ledger_id) as any;
    expect(row.timestamp).toBe(fixedTs);
    db.close();
  });
});

describe('appendLedgerEntryAsync', () => {
  it('is an async wrapper that resolves on success', async () => {
    const dbPath = getLedgerDbPath(TEST_ROOT);
    const db = initLedgerDb(dbPath);
    const entry = makeLedgerEntry();
    // Sprint 20: appendLedgerEntryAsync now resolves to AppendReceipt (not void)
    await expect(appendLedgerEntryAsync(db, entry)).resolves.toBeDefined();
    db.close();
  });
});

describe('Writer — immutability contract', () => {
  it('does not export an update function', async () => {
    const writerModule = await import('../packages/core/src/runtime/ledger/writer.js');
    expect((writerModule as any).updateLedgerEntry).toBeUndefined();
    expect((writerModule as any).deleteLedgerEntry).toBeUndefined();
    expect((writerModule as any).upsertLedgerEntry).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Reader
// ═══════════════════════════════════════════════════════════════════════════════

describe('LedgerReader', () => {
  let db: ReturnType<typeof initLedgerDb>;
  const TRACE_A = 'tr_reader_a';
  const TRACE_B = 'tr_reader_b';
  const REQUEST_X = 'req_reader_x';

  beforeAll(() => {
    db = initLedgerDb(getLedgerDbPath(TEST_ROOT_B));

    // Insert 3 entries for TRACE_A
    for (let i = 0; i < 3; i++) {
      appendLedgerEntry(db, makeLedgerEntry({
        ledger_id: `led_a_${i}`,
        trace_id: TRACE_A,
        request_id: REQUEST_X,
        timestamp: new Date(2025, 0, 1, 10, i).toISOString(),
        stage: (['knowledge', 'eco', 'classification'] as LedgerStage[])[i],
        record_type: 'decision',
        payload: makeDecisionPayload({ decision_code: `CODE_${i}` }),
      }));
    }

    // Insert one override for REQUEST_X (different trace)
    appendLedgerEntry(db, makeLedgerEntry({
      ledger_id: 'led_ovr_1',
      trace_id: TRACE_B,
      request_id: REQUEST_X,
      timestamp: new Date(2025, 0, 1, 11, 0).toISOString(),
      stage: 'override',
      record_type: 'override',
      payload: makeOverridePayload(),
    }));

    // Insert two outcomes for TRACE_A (superseded + latest)
    appendLedgerEntry(db, makeLedgerEntry({
      ledger_id: 'led_out_old',
      trace_id: TRACE_A,
      request_id: REQUEST_X,
      timestamp: new Date(2025, 0, 1, 10, 10).toISOString(),
      stage: 'outcome',
      record_type: 'outcome',
      payload: makeOutcomePayload({ completion_state: 'escalated', final_disposition_reason: 'first outcome' }),
    }));
    appendLedgerEntry(db, makeLedgerEntry({
      ledger_id: 'led_out_new',
      trace_id: TRACE_A,
      request_id: REQUEST_X,
      timestamp: new Date(2025, 0, 1, 10, 20).toISOString(),
      stage: 'outcome',
      record_type: 'outcome',
      payload: makeOutcomePayload({ completion_state: 'merged', final_disposition_reason: 'final outcome' }),
    }));

    // Insert one refusal for REQUEST_X
    appendLedgerEntry(db, makeLedgerEntry({
      ledger_id: 'led_ref_1',
      trace_id: TRACE_B,
      request_id: REQUEST_X,
      timestamp: new Date(2025, 0, 1, 11, 5).toISOString(),
      stage: 'classification',
      record_type: 'refusal',
      payload: makeRefusalPayload(),
    }));
  });

  afterAll(() => {
    db.close();
  });

  it('fetchByTraceId returns all records for the trace in chronological order', () => {
    const reader = new LedgerReader(db);
    const entries = reader.fetchByTraceId(TRACE_A);
    expect(entries.length).toBeGreaterThanOrEqual(3); // 3 decisions + 2 outcomes
    // All belong to TRACE_A
    for (const e of entries) {
      expect(e.trace_id).toBe(TRACE_A);
    }
    // Ordered by timestamp ASC
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].timestamp >= entries[i - 1].timestamp).toBe(true);
    }
  });

  it('fetchByTraceId returns empty array for unknown trace', () => {
    const reader = new LedgerReader(db);
    expect(reader.fetchByTraceId('nonexistent_trace')).toHaveLength(0);
  });

  it('fetchOverrides returns only override records for a request, across all traces', () => {
    const reader = new LedgerReader(db);
    const overrides = reader.fetchOverrides(REQUEST_X);
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    for (const e of overrides) {
      expect(e.record_type).toBe('override');
      expect(e.request_id).toBe(REQUEST_X);
    }
  });

  it('fetchOutcome returns the latest outcome by timestamp (superseded outcome is not returned)', () => {
    const reader = new LedgerReader(db);
    const outcome = reader.fetchOutcome(TRACE_A);
    expect(outcome).not.toBeNull();
    const payload = outcome!.payload as OutcomeRecord;
    expect(payload.completion_state).toBe('merged'); // latest, not 'escalated'
  });

  it('fetchOutcome returns null for trace with no outcome', () => {
    const reader = new LedgerReader(db);
    // TRACE_B has no outcome
    expect(reader.fetchOutcome(TRACE_B)).toBeNull();
  });

  it('buildTimeline returns same records as fetchByTraceId, chronologically', () => {
    const reader = new LedgerReader(db);
    const timeline = reader.buildTimeline(TRACE_A);
    const byTrace = reader.fetchByTraceId(TRACE_A);
    expect(timeline).toEqual(byTrace);
  });

  it('both outcome records remain in ledger (append-only, superseded not deleted)', () => {
    const allForTrace = db.prepare(`SELECT * FROM ledger_entries WHERE trace_id = ? AND record_type = 'outcome'`).all(TRACE_A) as any[];
    expect(allForTrace.length).toBe(2); // superseded + latest both persist
  });

  it('fetchRefusals returns only refusal records for a request', () => {
    const reader = new LedgerReader(db);
    const refusals = reader.fetchRefusals(REQUEST_X);
    expect(refusals.length).toBeGreaterThanOrEqual(1);
    for (const e of refusals) {
      expect(e.record_type).toBe('refusal');
    }
  });

  it('fetchByStage filters records by stage', () => {
    const reader = new LedgerReader(db);
    const knowledgeEntries = reader.fetchByStage(TRACE_A, 'knowledge');
    expect(knowledgeEntries.every(e => e.stage === 'knowledge')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Mappers
// ═══════════════════════════════════════════════════════════════════════════════

describe('fromBoundTrace', () => {
  const STAGE_CASES: Array<[BoundTrace['stage'], string, LedgerStage]> = [
    ['INTENT_DETECT',    'INTENT_DETECTED',        'knowledge'],
    ['ECO_BUILD',        'ECO_COMPUTED',           'eco'],
    ['SUFFICIENCY_GATE', 'SUFFICIENCY_EVALUATED',  'classification'],
    ['TEE_BUILD',        'TEE_BUILT',              'strategy'],
    ['CLASSIFY_LANE',    'LANE_CLASSIFIED',        'classification'],
  ];

  for (const [pipelineStage, expectedCode, expectedLedgerStage] of STAGE_CASES) {
    it(`maps ${pipelineStage} → decision_code="${expectedCode}", stage="${expectedLedgerStage}"`, () => {
      const bt = makeBoundTrace({ stage: pipelineStage });
      const entry = fromBoundTrace(bt, { trace_id: 'tr_1', request_id: 'req_1', stage: expectedLedgerStage });
      expect(validateLedgerEntry(entry).valid).toBe(true);
      expect(entry.record_type).toBe('decision');
      expect(entry.stage).toBe(expectedLedgerStage);
      const payload = entry.payload as DecisionRecord;
      expect(payload.kind).toBe('decision');
      expect(payload.decision_code).toBe(expectedCode);
    });
  }

  it('produces valid LedgerEntry (passes validator)', () => {
    const entry = fromBoundTrace(makeBoundTrace(), { trace_id: 'tr_x', request_id: 'req_x', stage: 'knowledge' });
    expect(validateLedgerEntry(entry).valid).toBe(true);
  });

  it('sets parent_ledger_id when provided', () => {
    const entry = fromBoundTrace(makeBoundTrace(), { trace_id: 'tr_x', request_id: 'req_x', stage: 'knowledge', parent_ledger_id: 'led_parent' });
    expect(entry.parent_ledger_id).toBe('led_parent');
  });

  it('maps status ok → result.status pass', () => {
    const entry = fromBoundTrace(makeBoundTrace({ status: 'ok' }), { trace_id: 'tr_x', request_id: 'req_x', stage: 'knowledge' });
    const payload = entry.payload as DecisionRecord;
    expect(payload.result.status).toBe('pass');
  });

  it('maps status blocked → result.status block', () => {
    const entry = fromBoundTrace(makeBoundTrace({ status: 'blocked' }), { trace_id: 'tr_x', request_id: 'req_x', stage: 'knowledge' });
    const payload = entry.payload as DecisionRecord;
    expect(payload.result.status).toBe('block');
  });
});

describe('fromDimensionScoringTrace', () => {
  it('produces a valid DecisionRecord entry at stage "eco"', () => {
    const dimTrace = makeDimensionScoringTrace();
    const entry = fromDimensionScoringTrace(dimTrace, { trace_id: 'tr_d', request_id: 'req_d' });
    expect(validateLedgerEntry(entry).valid).toBe(true);
    expect(entry.stage).toBe('eco');
    expect(entry.record_type).toBe('decision');
    const payload = entry.payload as DecisionRecord;
    expect(payload.kind).toBe('decision');
    expect(payload.decision_code).toBe('ECO_SCORED');
  });

  it('includes composite_internal_confidence in rationale signal_refs', () => {
    const dimTrace = makeDimensionScoringTrace();
    const entry = fromDimensionScoringTrace(dimTrace, { trace_id: 'tr_d', request_id: 'req_d' });
    const payload = entry.payload as DecisionRecord;
    expect(payload.rationale.signal_refs).toBeDefined();
    const refs = payload.rationale.signal_refs ?? [];
    expect(refs.some(r => r.includes('92') || r.includes('confidence'))).toBe(true);
  });
});

describe('fromConflictEvents', () => {
  it('collapses multiple events into a single DecisionRecord', () => {
    const events = makeConflictEvents(3);
    const entry = fromConflictEvents(events, { trace_id: 'tr_c', request_id: 'req_c' });
    expect(validateLedgerEntry(entry).valid).toBe(true);
    expect(entry.record_type).toBe('decision');
    const payload = entry.payload as DecisionRecord;
    expect(payload.kind).toBe('decision');
  });

  it('includes event count in rationale signal_refs', () => {
    const events = makeConflictEvents(3);
    const entry = fromConflictEvents(events, { trace_id: 'tr_c', request_id: 'req_c' });
    const payload = entry.payload as DecisionRecord;
    const refs = payload.rationale.signal_refs ?? [];
    expect(refs.some(r => r.includes('3') || r.includes('event'))).toBe(true);
  });

  it('handles empty events array gracefully', () => {
    const entry = fromConflictEvents([], { trace_id: 'tr_c2', request_id: 'req_c2' });
    expect(validateLedgerEntry(entry).valid).toBe(true);
  });
});

describe('fromRefusal', () => {
  it('produces a valid RefusalRecord entry', () => {
    const entry = fromRefusal('classification', 'COVERAGE_BLOCK', 'Coverage dimension blocked', {
      trace_id: 'tr_r', request_id: 'req_r', blocking_dimension: 'coverage',
    });
    expect(validateLedgerEntry(entry).valid).toBe(true);
    expect(entry.record_type).toBe('refusal');
    const payload = entry.payload as RefusalRecord;
    expect(payload.kind).toBe('refusal');
    expect(payload.refusal_code).toBe('COVERAGE_BLOCK');
    expect(payload.blocking_dimension).toBe('coverage');
  });

  it('sets stage correctly', () => {
    const entry = fromRefusal('eco', 'SOME_CODE', 'reason', { trace_id: 'tr_r2', request_id: 'req_r2' });
    expect(entry.stage).toBe('eco');
  });
});

describe('fromOrchestratorResult', () => {
  it('maps completed=true → completion_state="merged"', () => {
    const result = makeOrchestratorResult({ completed: true, blocked: false });
    const entry = fromOrchestratorResult(result, { trace_id: 'tr_o', request_id: 'req_o' });
    expect(validateLedgerEntry(entry).valid).toBe(true);
    const payload = entry.payload as OutcomeRecord;
    expect(payload.kind).toBe('outcome');
    expect(payload.completion_state).toBe('merged');
  });

  it('maps blocked=true → completion_state="refused"', () => {
    const result = makeOrchestratorResult({ completed: false, blocked: true });
    const entry = fromOrchestratorResult(result, { trace_id: 'tr_o2', request_id: 'req_o2' });
    const payload = entry.payload as OutcomeRecord;
    expect(payload.completion_state).toBe('refused');
  });

  it('maps escalated=true → completion_state="escalated"', () => {
    const result = makeOrchestratorResult({ completed: true, blocked: false, escalated: true });
    const entry = fromOrchestratorResult(result, { trace_id: 'tr_o3', request_id: 'req_o3' });
    const payload = entry.payload as OutcomeRecord;
    expect(payload.completion_state).toBe('escalated');
  });

  it('includes final lane in outcome record', () => {
    const result = makeOrchestratorResult({ finalLane: 'C' });
    const entry = fromOrchestratorResult(result, { trace_id: 'tr_o4', request_id: 'req_o4' });
    const payload = entry.payload as OutcomeRecord;
    expect(payload.final_lane).toBe('C');
  });

  it('sets stage to "outcome"', () => {
    const entry = fromOrchestratorResult(makeOrchestratorResult(), { trace_id: 'tr_o5', request_id: 'req_o5' });
    expect(entry.stage).toBe('outcome');
  });
});

describe('fromTraceJson', () => {
  it('wraps legacy trace JSON with kind="trace"', () => {
    const legacyTrace = { trace_id: 'tr_legacy_1', intent: 'bug_fix', confidence_score: 85 };
    const entry = fromTraceJson(legacyTrace, { request_id: 'req_legacy_1' });
    expect(validateLedgerEntry(entry).valid).toBe(true);
    expect(entry.record_type).toBe('trace');
    const payload = entry.payload as TraceAdapterRecord;
    expect(payload.kind).toBe('trace');
    expect(payload.raw).toBe(legacyTrace);
  });

  it('sets trace_id from legacy blob when available', () => {
    const legacyTrace = { trace_id: 'tr_legacy_2', confidence_score: 70 };
    const entry = fromTraceJson(legacyTrace, {});
    expect(entry.trace_id).toBe('tr_legacy_2');
  });

  it('uses fallback trace_id when legacy blob has none', () => {
    const legacyTrace = { confidence_score: 50 };
    const entry = fromTraceJson(legacyTrace, {});
    expect(entry.trace_id).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Orchestrator wiring — onLedgerEntry hook
// ═══════════════════════════════════════════════════════════════════════════════

describe('runOrchestrator — onLedgerEntry hook', () => {
  const makePassHandler = (output: unknown) => async (_input: unknown) => output;

  it('backward compatible: runs without crashing when no onLedgerEntry provided', async () => {
    const result = await runOrchestrator(
      { specPath: null, query: 'test' },
      {
        INTENT_DETECT:    makePassHandler({ primary: 'bug_fix', composite: false }),
        ECO_BUILD:        makePassHandler({ intent: { primary: 'bug_fix', composite: false }, eco_dimensions: { coverage: { severity: 'pass' }, freshness: { severity: 'pass' }, mapping: { severity: 'pass' }, conflict: { severity: 'pass' }, graph: { severity: 'pass' } }, confidence_score: 80 }),
        SUFFICIENCY_GATE: makePassHandler({ behavior: 'pass', lane: 'A', reason: 'ok' }),
        TEE_BUILD:        makePassHandler({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
        CLASSIFY_LANE:    makePassHandler({ lane: 'A', set_by: 'P3', reason: 'low confidence' }),
      },
    );
    expect(result.completed).toBe(true);
  });

  it('fires onLedgerEntry for each completed stage', async () => {
    const entries: LedgerEntry[] = [];

    await runOrchestrator(
      { specPath: null, query: 'test', onLedgerEntry: (e) => entries.push(e) },
      {
        INTENT_DETECT:    makePassHandler({ primary: 'bug_fix', composite: false }),
        ECO_BUILD:        makePassHandler({ intent: { primary: 'bug_fix', composite: false }, eco_dimensions: { coverage: { severity: 'pass' }, freshness: { severity: 'pass' }, mapping: { severity: 'pass' }, conflict: { severity: 'pass' }, graph: { severity: 'pass' } }, confidence_score: 80 }),
        SUFFICIENCY_GATE: makePassHandler({ behavior: 'pass', lane: 'A', reason: 'ok' }),
        TEE_BUILD:        makePassHandler({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
        CLASSIFY_LANE:    makePassHandler({ lane: 'A', set_by: 'P3', reason: 'low confidence' }),
      },
    );

    // 5 stage records + 1 terminal outcome = 6 entries
    expect(entries.length).toBe(6);
  });

  it('emits a terminal OutcomeRecord as the last entry', async () => {
    const entries: LedgerEntry[] = [];

    await runOrchestrator(
      { specPath: null, query: 'test', onLedgerEntry: (e) => entries.push(e) },
      {
        INTENT_DETECT:    makePassHandler({ primary: 'bug_fix', composite: false }),
        ECO_BUILD:        makePassHandler({ intent: { primary: 'bug_fix', composite: false }, eco_dimensions: { coverage: { severity: 'pass' }, freshness: { severity: 'pass' }, mapping: { severity: 'pass' }, conflict: { severity: 'pass' }, graph: { severity: 'pass' } }, confidence_score: 80 }),
        SUFFICIENCY_GATE: makePassHandler({ behavior: 'pass', lane: 'A', reason: 'ok' }),
        TEE_BUILD:        makePassHandler({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
        CLASSIFY_LANE:    makePassHandler({ lane: 'A', set_by: 'P3', reason: 'low confidence' }),
      },
    );

    const last = entries[entries.length - 1];
    expect(last.record_type).toBe('outcome');
    expect(last.stage).toBe('outcome');
  });

  it('all stage entries have record_type: "decision"', async () => {
    const entries: LedgerEntry[] = [];

    await runOrchestrator(
      { specPath: null, query: 'test', onLedgerEntry: (e) => entries.push(e) },
      {
        INTENT_DETECT:    makePassHandler({ primary: 'bug_fix', composite: false }),
        ECO_BUILD:        makePassHandler({ intent: { primary: 'bug_fix', composite: false }, eco_dimensions: { coverage: { severity: 'pass' }, freshness: { severity: 'pass' }, mapping: { severity: 'pass' }, conflict: { severity: 'pass' }, graph: { severity: 'pass' } }, confidence_score: 80 }),
        SUFFICIENCY_GATE: makePassHandler({ behavior: 'pass', lane: 'A', reason: 'ok' }),
        TEE_BUILD:        makePassHandler({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
        CLASSIFY_LANE:    makePassHandler({ lane: 'A', set_by: 'P3', reason: 'low confidence' }),
      },
    );

    const stageDecisions = entries.slice(0, -1); // all except last (outcome)
    for (const e of stageDecisions) {
      expect(e.record_type).toBe('decision');
    }
  });

  it('parent_ledger_id chains linearly through stages', async () => {
    const entries: LedgerEntry[] = [];

    await runOrchestrator(
      { specPath: null, query: 'test', onLedgerEntry: (e) => entries.push(e) },
      {
        INTENT_DETECT:    makePassHandler({ primary: 'bug_fix', composite: false }),
        ECO_BUILD:        makePassHandler({ intent: { primary: 'bug_fix', composite: false }, eco_dimensions: { coverage: { severity: 'pass' }, freshness: { severity: 'pass' }, mapping: { severity: 'pass' }, conflict: { severity: 'pass' }, graph: { severity: 'pass' } }, confidence_score: 80 }),
        SUFFICIENCY_GATE: makePassHandler({ behavior: 'pass', lane: 'A', reason: 'ok' }),
        TEE_BUILD:        makePassHandler({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
        CLASSIFY_LANE:    makePassHandler({ lane: 'A', set_by: 'P3', reason: 'low confidence' }),
      },
    );

    // First stage has no parent
    expect(entries[0].parent_ledger_id).toBeUndefined();
    // Each subsequent stage points to previous
    for (let i = 1; i < entries.length - 1; i++) {
      expect(entries[i].parent_ledger_id).toBe(entries[i - 1].ledger_id);
    }
    // Outcome points to last stage record
    const outcome = entries[entries.length - 1];
    expect(outcome.parent_ledger_id).toBe(entries[entries.length - 2].ledger_id);
  });

  it('all emitted entries pass schema validation', async () => {
    const entries: LedgerEntry[] = [];

    await runOrchestrator(
      { specPath: null, query: 'test', onLedgerEntry: (e) => entries.push(e) },
      {
        INTENT_DETECT:    makePassHandler({ primary: 'bug_fix', composite: false }),
        ECO_BUILD:        makePassHandler({ intent: { primary: 'bug_fix', composite: false }, eco_dimensions: { coverage: { severity: 'pass' }, freshness: { severity: 'pass' }, mapping: { severity: 'pass' }, conflict: { severity: 'pass' }, graph: { severity: 'pass' } }, confidence_score: 80 }),
        SUFFICIENCY_GATE: makePassHandler({ behavior: 'pass', lane: 'A', reason: 'ok' }),
        TEE_BUILD:        makePassHandler({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
        CLASSIFY_LANE:    makePassHandler({ lane: 'A', set_by: 'P3', reason: 'low confidence' }),
      },
    );

    for (const e of entries) {
      const result = validateLedgerEntry(e);
      expect(result.valid).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Correlation model
// ═══════════════════════════════════════════════════════════════════════════════

describe('Correlation model', () => {
  it('request_id and trace_id are distinct fields (can be different values)', () => {
    const entry = makeLedgerEntry({ trace_id: 'tr_corr_1', request_id: 'req_corr_1' });
    expect(entry.trace_id).not.toBe(entry.request_id);
  });

  it('multiple traces can share one request_id', () => {
    const db = initLedgerDb(getLedgerDbPath(join(tmpdir(), `nirnex-sprint12-corr-${Date.now()}`)));
    const REQUEST = 'req_shared';

    appendLedgerEntry(db, makeLedgerEntry({ ledger_id: 'led_corr_1', trace_id: 'tr_corr_1', request_id: REQUEST }));
    appendLedgerEntry(db, makeLedgerEntry({ ledger_id: 'led_corr_2', trace_id: 'tr_corr_2', request_id: REQUEST }));

    const reader = new LedgerReader(db);
    // fetchByTraceId returns per-trace
    expect(reader.fetchByTraceId('tr_corr_1').length).toBe(1);
    expect(reader.fetchByTraceId('tr_corr_2').length).toBe(1);
    db.close();
  });

  it('fetchOverrides spans all traces for a request_id', () => {
    const db = initLedgerDb(getLedgerDbPath(join(tmpdir(), `nirnex-sprint12-ovr-${Date.now()}`)));
    const REQUEST = 'req_multi_trace';

    // Override on trace_1
    appendLedgerEntry(db, makeLedgerEntry({
      ledger_id: 'led_ovr_t1',
      trace_id: 'tr_ovr_1',
      request_id: REQUEST,
      stage: 'override',
      record_type: 'override',
      payload: makeOverridePayload(),
    }));
    // Override on trace_2 (same request)
    appendLedgerEntry(db, makeLedgerEntry({
      ledger_id: 'led_ovr_t2',
      trace_id: 'tr_ovr_2',
      request_id: REQUEST,
      stage: 'override',
      record_type: 'override',
      payload: makeOverridePayload(),
    }));

    const reader = new LedgerReader(db);
    const overrides = reader.fetchOverrides(REQUEST);
    expect(overrides.length).toBe(2); // spans both traces
    db.close();
  });
});
