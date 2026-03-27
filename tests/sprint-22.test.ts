/**
 * Sprint 22 — Deterministic Replay Engine (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Core contract:
 *   Replay is reconstruction of prior execution using recorded stage inputs,
 *   recorded stage outputs, and recorded nondeterministic dependency responses.
 *   Replay is NOT fresh execution against live dependencies.
 *
 * Three explicitly distinct modes:
 *   replay    — uses recorded artifacts only; must be deterministic
 *   re_run    — executes pipeline again against live world; may differ
 *   diff      — compares replayed original vs fresh re_run
 *
 * Coverage:
 *
 * A. Capture & normalization (unit, no DB)
 *   1.  normalizeForRecord produces same output regardless of key insertion order
 *   2.  normalizeForRecord deep-sorts nested objects
 *   3.  hashRecordedOutput is stable — same output → same hash every time
 *   4.  Different outputs → different hashes
 *   5.  buildReplayMaterial from BoundTrace → ReplayMaterialRecord with correct fields
 *   6.  buildReplayMaterial with present input+output → replayability_status='replayable'
 *
 * B. Ledger type & validators
 *   7.  validateReplayMaterial with all required fields → valid
 *   8.  Missing output_hash in replay_material → validation error
 *   9.  Invalid replayability_status → validation error
 *   10. 'replay' is a valid LedgerStage
 *   11. 'replay_material' is a valid LedgerRecordType
 *   12. 'replay_attempted', 'replay_verified', 'replay_failed' are valid LedgerRecordTypes
 *
 * C. Orchestrator replay capture
 *   13. enableReplayCapture=true → onLedgerEntry receives replay_material entries
 *   14. Each replay_material entry has record_type='replay_material' and stage='replay'
 *   15. replay_material.output_hash matches independently computed hash of stage output
 *   16. One replay_material entry per successfully completed stage (5 stages → 5 materials)
 *   17. replay_material has replayability_status='replayable' for completed stages
 *   18. Replay capture is opt-in — no replay_material entries when flag absent
 *
 * D. Reconstruction from recorded materials
 *   19. reconstructRun with all materials present → overall_replayable=true
 *   20. reconstructed output hashes match recorded hashes → all stages verified=true
 *   21. reconstructRun does not accept handler functions — replay is handler-free by design
 *   22. ReplayReport always has mode='replay'
 *   23. Missing material for a stage → stage marked non_replayable, overall_replayable=false
 *   24. stage_results covers all STAGES in canonical pipeline order
 *
 * E. Replay validation & ledger records
 *   25. replay_attempted entry written to ledger when reconstructRun is called
 *   26. replay_verified entry written when all stages verified
 *   27. replay_failed entry written when reconstruction fails (hash mismatch)
 *   28. divergence_point identifies the first failing stage name
 *   29. Tampered normalized_output in material → reconstructed hash mismatch → verified=false
 *   30. reconstructRun on empty DB → overall_replayable=false, verified=false
 *
 * F. Reader helpers & replayability policy
 *   31. fetchReplayMaterials returns all replay_material entries ordered by stage sequence
 *   32. fetchReplayMaterials returns [] when no materials exist for trace
 *   33. checkRunReplayability returns 'replayable' when all 5 stages have materials
 *   34. checkRunReplayability returns 'non_replayable' when no materials at all
 *   35. checkRunReplayability returns 'conditionally_replayable' when only some stages covered
 *   36. ExecutionMode distinction: material.execution_mode='live', report.mode='replay'
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  normalizeForRecord,
  hashRecordedOutput,
  buildReplayMaterial,
  classifyStageReplayability,
} from '../packages/core/src/runtime/replay/capture.js';

import {
  checkRunReplayability,
} from '../packages/core/src/runtime/replay/policy.js';

import {
  reconstructRun,
  type ReplayReport,
} from '../packages/core/src/runtime/replay/reconstruct.js';

import {
  type ReplayMaterialRecord,
  type ReplayAttemptedRecord,
  type ReplayVerifiedRecord,
  type ReplayFailedRecord,
  type ExecutionMode,
} from '../packages/core/src/runtime/replay/types.js';

import {
  validateLedgerEntry,
  validatePayload,
} from '../packages/core/src/runtime/ledger/validators.js';

import {
  appendLedgerEntry,
} from '../packages/core/src/runtime/ledger/writer.js';

import { LedgerReader } from '../packages/core/src/runtime/ledger/reader.js';

import {
  fromReplayMaterial,
} from '../packages/core/src/runtime/ledger/mappers.js';

import { LEDGER_TABLE_SQL } from '../packages/core/src/runtime/ledger/schema.js';

import { runOrchestrator } from '../packages/core/src/pipeline/orchestrator.js';

import { STAGES } from '../packages/core/src/pipeline/types.js';

import type { LedgerEntry, BoundTrace } from '../packages/core/src/runtime/ledger/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(LEDGER_TABLE_SQL);
  return db;
}

function makeBoundTrace(overrides: Partial<BoundTrace> = {}): BoundTrace {
  return {
    stage: 'ECO_BUILD',
    status: 'ok',
    inputHash: 'abc123',
    timestamp: new Date().toISOString(),
    durationMs: 42,
    input: { intent: { primary: 'test', composite: false }, specPath: null },
    output: { confidence_score: 80, eco_dimensions: {}, intent: { primary: 'test', composite: false } },
    ...overrides,
  } as BoundTrace;
}

function makeHandlers() {
  return {
    INTENT_DETECT: async () => ({ primary: 'test-intent', composite: false }),
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
    SUFFICIENCY_GATE: async () => ({ behavior: 'pass' as const, lane: 'A', reason: 'sufficient' }),
    TEE_BUILD: async () => ({
      blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [],
    }),
    CLASSIFY_LANE: async () => ({ lane: 'A', set_by: 'P1' as const, reason: 'low risk' }),
  };
}

// ─── A. Capture & normalization ───────────────────────────────────────────────

describe('A. normalizeForRecord and hashRecordedOutput', () => {
  it('1. normalizeForRecord produces same output regardless of key insertion order', () => {
    const a = normalizeForRecord({ z: 1, a: 2, m: 3 });
    const b = normalizeForRecord({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
  });

  it('2. normalizeForRecord deep-sorts nested objects', () => {
    const a = normalizeForRecord({ outer: { z: 9, a: 1 }, top: true });
    const b = normalizeForRecord({ top: true, outer: { a: 1, z: 9 } });
    expect(a).toBe(b);
  });

  it('3. hashRecordedOutput is stable — same output → same hash', () => {
    const output = { lane: 'A', set_by: 'P1', reason: 'low risk' };
    expect(hashRecordedOutput(output)).toBe(hashRecordedOutput(output));
    // Also stable across structurally equal objects (different references)
    expect(hashRecordedOutput({ a: 1, b: 2 })).toBe(hashRecordedOutput({ a: 1, b: 2 }));
  });

  it('4. Different outputs → different hashes', () => {
    expect(hashRecordedOutput({ lane: 'A' })).not.toBe(hashRecordedOutput({ lane: 'B' }));
  });

  it('5. buildReplayMaterial from BoundTrace → correct stage_id, hashes, kind', () => {
    const trace = makeBoundTrace({ stage: 'ECO_BUILD' });
    const material = buildReplayMaterial(trace);
    expect(material.kind).toBe('replay_material');
    expect(material.stage_id).toBe('ECO_BUILD');
    expect(material.output_hash).toBe(hashRecordedOutput(trace.output));
    expect(material.input_hash).toBe(hashRecordedOutput(trace.input));
    expect(material.execution_mode).toBe('live');
  });

  it('6. buildReplayMaterial with present input+output → replayability_status=replayable', () => {
    const trace = makeBoundTrace();
    const material = buildReplayMaterial(trace);
    expect(material.replayability_status).toBe('replayable');
  });
});

// ─── B. Ledger type & validators ──────────────────────────────────────────────

describe('B. Ledger types and validators', () => {
  function makeValidMaterial(): ReplayMaterialRecord {
    return {
      kind: 'replay_material',
      stage_id: 'ECO_BUILD',
      execution_mode: 'live',
      input_hash: 'a'.repeat(64),
      output_hash: 'b'.repeat(64),
      normalized_input: { intent: { primary: 'test', composite: false } },
      normalized_output: { confidence_score: 80 },
      replayability_status: 'replayable',
      dependency_sequence_index: 0,
    };
  }

  it('7. validateReplayMaterial with all required fields → valid', () => {
    const result = validatePayload('replay_material', makeValidMaterial());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('8. Missing output_hash → validation error', () => {
    const { output_hash: _removed, ...partial } = makeValidMaterial();
    const result = validatePayload('replay_material', partial);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('output_hash'))).toBe(true);
  });

  it('9. Invalid replayability_status → validation error', () => {
    const material = { ...makeValidMaterial(), replayability_status: 'maybe_replayable' as any };
    const result = validatePayload('replay_material', material);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('replayability_status'))).toBe(true);
  });

  it('10. replay is a valid LedgerStage', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'replay',
      record_type: 'replay_material',
      actor: 'system',
      payload: makeValidMaterial() as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.errors.some(e => e.includes('unknown stage'))).toBe(false);
  });

  it('11. replay_material is a valid LedgerRecordType', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'replay',
      record_type: 'replay_material',
      actor: 'system',
      payload: makeValidMaterial() as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.errors.some(e => e.includes('unknown record_type'))).toBe(false);
  });

  it('12. replay_attempted, replay_verified, replay_failed are valid LedgerRecordTypes', () => {
    const types = ['replay_attempted', 'replay_verified', 'replay_failed'] as const;
    for (const rt of types) {
      const entry: LedgerEntry = {
        schema_version: '1.0.0',
        ledger_id: randomUUID(),
        trace_id: 'tr_test',
        request_id: 'req_test',
        timestamp: new Date().toISOString(),
        stage: 'replay',
        record_type: rt as LedgerEntry['record_type'],
        actor: 'system',
        payload: { kind: rt, run_trace_id: 'tr_orig' } as unknown as LedgerEntry['payload'],
      };
      const result = validateLedgerEntry(entry);
      expect(result.errors.some(e => e.includes('unknown record_type')), `${rt} should be valid`).toBe(false);
    }
  });
});

// ─── C. Orchestrator replay capture ───────────────────────────────────────────

describe('C. Orchestrator replay capture', () => {
  it('13. enableReplayCapture=true → onLedgerEntry receives replay_material entries', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableReplayCapture: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const materials = entries.filter(e => e.record_type === 'replay_material');
    expect(materials.length).toBeGreaterThan(0);
  });

  it('14. Each replay_material entry has record_type=replay_material and stage=replay', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableReplayCapture: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const materials = entries.filter(e => e.record_type === 'replay_material');
    for (const m of materials) {
      expect(m.record_type).toBe('replay_material');
      expect(m.stage).toBe('replay');
    }
  });

  it('15. replay_material.output_hash matches independently computed hash of stage output', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableReplayCapture: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const materials = entries.filter(e => e.record_type === 'replay_material');
    for (const m of materials) {
      const payload = m.payload as ReplayMaterialRecord;
      const recomputedHash = hashRecordedOutput(payload.normalized_output);
      expect(recomputedHash).toBe(payload.output_hash);
    }
  });

  it('16. One replay_material entry per successfully completed stage (5 stages → 5 materials)', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableReplayCapture: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const materials = entries.filter(e => e.record_type === 'replay_material');
    expect(materials).toHaveLength(5);
  });

  it('17. replay_material has replayability_status=replayable for completed stages', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableReplayCapture: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const materials = entries.filter(e => e.record_type === 'replay_material');
    for (const m of materials) {
      expect((m.payload as ReplayMaterialRecord).replayability_status).toBe('replayable');
    }
  });

  it('18. Replay capture is opt-in — no replay_material entries when flag absent', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const materials = entries.filter(e => e.record_type === 'replay_material');
    expect(materials).toHaveLength(0);
  });
});

// ─── D. Reconstruction from recorded materials ────────────────────────────────

describe('D. Reconstruction from recorded materials', () => {
  let db: Database.Database;
  const traceId = 'tr_reconstruction_test';
  const requestId = 'req_reconstruction_test';

  beforeEach(() => {
    db = makeDb();
  });

  function seedMaterials(stages: string[]) {
    for (let i = 0; i < stages.length; i++) {
      const output = { stage_result: stages[i], score: 80 + i };
      const input  = { stage_input: stages[i] };
      const material: ReplayMaterialRecord = {
        kind: 'replay_material',
        stage_id: stages[i],
        execution_mode: 'live',
        input_hash: hashRecordedOutput(input),
        output_hash: hashRecordedOutput(output),
        normalized_input: JSON.parse(normalizeForRecord(input)),
        normalized_output: JSON.parse(normalizeForRecord(output)),
        replayability_status: 'replayable',
        dependency_sequence_index: i,
      };
      const entry = fromReplayMaterial(material, { trace_id: traceId, request_id: requestId });
      appendLedgerEntry(db, entry);
    }
  }

  it('19. reconstructRun with all materials present → overall_replayable=true', () => {
    seedMaterials([...STAGES]);
    const report = reconstructRun(traceId, db);
    expect(report.overall_replayable).toBe(true);
  });

  it('20. reconstructed output hashes match recorded hashes → all stages verified=true', () => {
    seedMaterials([...STAGES]);
    const report = reconstructRun(traceId, db);
    for (const sr of report.stage_results) {
      if (sr.replayability_status === 'replayable') {
        expect(sr.verified).toBe(true);
        expect(sr.reconstructed_output_hash).toBe(sr.recorded_output_hash);
      }
    }
  });

  it('21. reconstructRun takes (traceId, db) — no handler argument — handler-free by design', () => {
    // Verify API contract: reconstructRun does not accept live handler functions
    // This is a compile-time / API surface test
    seedMaterials([...STAGES]);
    // If reconstructRun accepted handlers, the call below would look different.
    // The fact that it only takes (traceId, db) proves handlers are never invoked.
    const report = reconstructRun(traceId, db);
    expect(report).toBeDefined();
    expect(report.mode).toBe('replay');
  });

  it('22. ReplayReport always has mode=replay', () => {
    seedMaterials([...STAGES]);
    const report = reconstructRun(traceId, db);
    expect(report.mode).toBe('replay');
  });

  it('23. Missing material for a stage → stage non_replayable, overall_replayable=false', () => {
    // Only seed 2 out of 5 stages
    seedMaterials(['INTENT_DETECT', 'ECO_BUILD']);
    const report = reconstructRun(traceId, db);
    expect(report.overall_replayable).toBe(false);
    const nonReplayable = report.stage_results.filter(r => r.replayability_status === 'non_replayable');
    expect(nonReplayable.length).toBeGreaterThan(0);
  });

  it('24. stage_results covers all STAGES in canonical pipeline order', () => {
    seedMaterials([...STAGES]);
    const report = reconstructRun(traceId, db);
    expect(report.stage_results).toHaveLength(STAGES.length);
    for (let i = 0; i < STAGES.length; i++) {
      expect(report.stage_results[i].stage_id).toBe(STAGES[i]);
    }
  });
});

// ─── E. Replay validation & ledger records ────────────────────────────────────

describe('E. Replay validation and ledger records', () => {
  let db: Database.Database;
  let reader: LedgerReader;
  const traceId = 'tr_validation_test';
  const requestId = 'req_validation_test';

  beforeEach(() => {
    db = makeDb();
    reader = new LedgerReader(db);
  });

  function seedAllStages() {
    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i];
      const output = { result: stage, index: i };
      const input  = { input_for: stage };
      const material: ReplayMaterialRecord = {
        kind: 'replay_material',
        stage_id: stage,
        execution_mode: 'live',
        input_hash: hashRecordedOutput(input),
        output_hash: hashRecordedOutput(output),
        normalized_input: JSON.parse(normalizeForRecord(input)),
        normalized_output: JSON.parse(normalizeForRecord(output)),
        replayability_status: 'replayable',
        dependency_sequence_index: i,
      };
      appendLedgerEntry(db, fromReplayMaterial(material, { trace_id: traceId, request_id: requestId }));
    }
  }

  it('25. replay_attempted entry written to ledger when reconstructRun is called', () => {
    seedAllStages();
    reconstructRun(traceId, db);
    const allEntries = reader.buildTimeline(traceId);
    const attempted = allEntries.filter(e => e.record_type === 'replay_attempted');
    expect(attempted.length).toBeGreaterThanOrEqual(1);
    expect((attempted[0].payload as ReplayAttemptedRecord).run_trace_id).toBe(traceId);
    expect((attempted[0].payload as ReplayAttemptedRecord).execution_mode).toBe('replay');
  });

  it('26. replay_verified entry written when all stages verified', () => {
    seedAllStages();
    reconstructRun(traceId, db);
    const allEntries = reader.buildTimeline(traceId);
    const verified = allEntries.filter(e => e.record_type === 'replay_verified');
    expect(verified.length).toBeGreaterThanOrEqual(1);
    const v = verified[0].payload as ReplayVerifiedRecord;
    expect(v.run_trace_id).toBe(traceId);
    expect(v.verified_count).toBe(STAGES.length);
  });

  it('27. replay_failed entry written when hash mismatch (tampered output)', () => {
    // Seed with wrong output_hash so reconstruction detects mismatch
    const stage = STAGES[0];
    const output = { result: stage };
    const wrongHash = 'f'.repeat(64); // wrong hash
    const material: ReplayMaterialRecord = {
      kind: 'replay_material',
      stage_id: stage,
      execution_mode: 'live',
      input_hash: hashRecordedOutput({ input: stage }),
      output_hash: wrongHash, // tampered
      normalized_input: JSON.parse(normalizeForRecord({ input: stage })),
      normalized_output: JSON.parse(normalizeForRecord(output)),
      replayability_status: 'replayable',
      dependency_sequence_index: 0,
    };
    appendLedgerEntry(db, fromReplayMaterial(material, { trace_id: traceId, request_id: requestId }));

    reconstructRun(traceId, db);

    const allEntries = reader.buildTimeline(traceId);
    const failed = allEntries.filter(e => e.record_type === 'replay_failed');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect((failed[0].payload as ReplayFailedRecord).run_trace_id).toBe(traceId);
  });

  it('28. divergence_point identifies the first failing stage name', () => {
    // Seed ECO_BUILD with correct hash, SUFFICIENCY_GATE with wrong hash
    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i];
      const output = { result: stage };
      const actualHash = hashRecordedOutput(output);
      // Tamper SUFFICIENCY_GATE
      const outputHash = stage === 'SUFFICIENCY_GATE' ? 'e'.repeat(64) : actualHash;
      const material: ReplayMaterialRecord = {
        kind: 'replay_material',
        stage_id: stage,
        execution_mode: 'live',
        input_hash: hashRecordedOutput({ input: stage }),
        output_hash: outputHash,
        normalized_input: JSON.parse(normalizeForRecord({ input: stage })),
        normalized_output: JSON.parse(normalizeForRecord(output)),
        replayability_status: 'replayable',
        dependency_sequence_index: i,
      };
      appendLedgerEntry(db, fromReplayMaterial(material, { trace_id: traceId, request_id: requestId }));
    }

    const report = reconstructRun(traceId, db);
    expect(report.divergence_point).toBe('SUFFICIENCY_GATE');
    expect(report.verified).toBe(false);
  });

  it('29. Tampered normalized_output → reconstructed hash mismatch → stage verified=false', () => {
    const stage = STAGES[1]; // ECO_BUILD
    const originalOutput = { confidence_score: 80 };
    const tamperedOutput  = { confidence_score: 99 }; // different from what hash was computed on
    const material: ReplayMaterialRecord = {
      kind: 'replay_material',
      stage_id: stage,
      execution_mode: 'live',
      input_hash: hashRecordedOutput({ input: 'x' }),
      output_hash: hashRecordedOutput(originalOutput), // hash of original
      normalized_input: JSON.parse(normalizeForRecord({ input: 'x' })),
      normalized_output: JSON.parse(normalizeForRecord(tamperedOutput)), // but stores tampered
      replayability_status: 'replayable',
      dependency_sequence_index: 0,
    };
    appendLedgerEntry(db, fromReplayMaterial(material, { trace_id: traceId, request_id: requestId }));

    const report = reconstructRun(traceId, db);
    const stageResult = report.stage_results.find(r => r.stage_id === stage);
    expect(stageResult?.verified).toBe(false);
    expect(stageResult?.reconstructed_output_hash).not.toBe(stageResult?.recorded_output_hash);
  });

  it('30. reconstructRun on empty DB → overall_replayable=false, verified=false', () => {
    const report = reconstructRun(traceId, db);
    expect(report.overall_replayable).toBe(false);
    expect(report.verified).toBe(false);
  });
});

// ─── F. Reader helpers & replayability policy ─────────────────────────────────

describe('F. Reader helpers and replayability policy', () => {
  let db: Database.Database;
  let reader: LedgerReader;
  const traceId = 'tr_reader_policy_test';
  const otherTraceId = 'tr_other_trace';
  const requestId = 'req_rp_test';

  beforeEach(() => {
    db = makeDb();
    reader = new LedgerReader(db);
  });

  function appendMaterial(stageId: string, tid = traceId) {
    const output = { result: stageId };
    const input  = { input: stageId };
    const material: ReplayMaterialRecord = {
      kind: 'replay_material',
      stage_id: stageId,
      execution_mode: 'live',
      input_hash: hashRecordedOutput(input),
      output_hash: hashRecordedOutput(output),
      normalized_input: JSON.parse(normalizeForRecord(input)),
      normalized_output: JSON.parse(normalizeForRecord(output)),
      replayability_status: 'replayable',
      dependency_sequence_index: 0,
    };
    appendLedgerEntry(db, fromReplayMaterial(material, { trace_id: tid, request_id: requestId }));
  }

  it('31. fetchReplayMaterials returns all replay_material entries for a trace', () => {
    for (const stage of STAGES) appendMaterial(stage);
    const materials = reader.fetchReplayMaterials(traceId);
    expect(materials).toHaveLength(STAGES.length);
    expect(materials.every(e => e.record_type === 'replay_material')).toBe(true);
  });

  it('32. fetchReplayMaterials returns [] when no materials exist for trace', () => {
    expect(reader.fetchReplayMaterials(traceId)).toEqual([]);
  });

  it('33. checkRunReplayability returns replayable when all 5 stages have materials', () => {
    const materials: ReplayMaterialRecord[] = STAGES.map(s => ({
      kind: 'replay_material' as const,
      stage_id: s,
      execution_mode: 'live' as ExecutionMode,
      input_hash: 'a'.repeat(64),
      output_hash: 'b'.repeat(64),
      normalized_input: {},
      normalized_output: {},
      replayability_status: 'replayable' as const,
      dependency_sequence_index: 0,
    }));
    const result = checkRunReplayability(materials, [...STAGES]);
    expect(result.status).toBe('replayable');
    expect(result.missing_stages).toHaveLength(0);
  });

  it('34. checkRunReplayability returns non_replayable when no materials at all', () => {
    const result = checkRunReplayability([], [...STAGES]);
    expect(result.status).toBe('non_replayable');
    expect(result.missing_stages).toHaveLength(STAGES.length);
  });

  it('35. checkRunReplayability returns conditionally_replayable when only some stages covered', () => {
    const partialMaterials: ReplayMaterialRecord[] = ['INTENT_DETECT', 'ECO_BUILD'].map(s => ({
      kind: 'replay_material' as const,
      stage_id: s,
      execution_mode: 'live' as ExecutionMode,
      input_hash: 'a'.repeat(64),
      output_hash: 'b'.repeat(64),
      normalized_input: {},
      normalized_output: {},
      replayability_status: 'replayable' as const,
      dependency_sequence_index: 0,
    }));
    const result = checkRunReplayability(partialMaterials, [...STAGES]);
    expect(result.status).toBe('conditionally_replayable');
    expect(result.missing_stages.length).toBeGreaterThan(0);
    expect(result.missing_stages.length).toBeLessThan(STAGES.length);
  });

  it('36. ExecutionMode distinction: material.execution_mode=live, report.mode=replay', async () => {
    // Original run: materials have execution_mode='live'
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableReplayCapture: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const materials = entries.filter(e => e.record_type === 'replay_material');
    for (const m of materials) {
      expect((m.payload as ReplayMaterialRecord).execution_mode).toBe('live');
    }

    // Replay report: mode='replay'
    for (const entry of entries) appendLedgerEntry(db, entry);
    const capturedTraceId = entries[0].trace_id;
    const report = reconstructRun(capturedTraceId, db);
    expect(report.mode).toBe('replay');
  });
});
