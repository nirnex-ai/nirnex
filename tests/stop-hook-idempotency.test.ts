/**
 * Stop Hook Idempotency — Unit Tests (G3 fix)
 *
 * Verifies that a duplicate Stop hook invocation for the same task_id cannot
 * produce a second ledger entry or re-run full validation.
 *
 * Three defence layers are tested:
 *   L1 — `isEnvelopeFinalized()` pure helper (session.ts)
 *   L2 — `finalized_at` survives save/load round-trip for allow and block outcomes
 *   L3 — Ledger dedupe: `LedgerReader.fetchOutcomeSummaries` correctly detects
 *         existing run_outcome_summary entries so the backstop guard fires
 *
 * All tests use real filesystem I/O via tmpdir() — no mocks for file operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  isEnvelopeFinalized,
  saveEnvelope,
  loadEnvelope,
  createSession,
} from '../packages/cli/src/runtime/session.js';

import type { TaskEnvelope } from '../packages/cli/src/runtime/types.js';
import { ReasonCode } from '../packages/cli/src/runtime/types.js';

import {
  initLedgerDb,
  appendLedgerEntry,
  getLedgerDbPath,
  LedgerReader,
} from '../packages/core/src/runtime/ledger/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nirnex-idempotency-'));
}

function baseEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    task_id:    `task_test_${randomUUID().slice(0, 8)}`,
    session_id: `sess_test_${randomUUID().slice(0, 8)}`,
    created_at: new Date().toISOString(),
    prompt:     'test prompt',
    lane:       'B',
    scope:      { allowed_paths: [], blocked_paths: [], modules_expected: [] },
    constraints:         [],
    acceptance_criteria: [],
    tool_policy:         { allowed_tools: [], requires_guard: [], denied_patterns: [] },
    stop_conditions:     { required_validations: [], forbidden_files: [] },
    confidence:          { score: 80, label: 'high', penalties: [] },
    eco_summary: {
      intent: 'test', recommended_lane: 'B',
      forced_unknown: false, blocked: false,
      escalation_reasons: [], boundary_warnings: [],
    },
    status: 'active',
    ...overrides,
  };
}

// ─── L1: isEnvelopeFinalized() pure helper ────────────────────────────────────

describe('L1 — isEnvelopeFinalized() pure function', () => {
  it('returns false when finalized_at is absent (pre-G3 envelope)', () => {
    const env = baseEnvelope();
    expect(isEnvelopeFinalized(env)).toBe(false);
  });

  it('returns false when finalized_at is explicitly undefined', () => {
    const env = baseEnvelope({ finalized_at: undefined });
    expect(isEnvelopeFinalized(env)).toBe(false);
  });

  it('returns false when finalized_at is an empty string', () => {
    const env = baseEnvelope({ finalized_at: '' });
    expect(isEnvelopeFinalized(env)).toBe(false);
  });

  it('returns true when finalized_at is a non-empty ISO string AND status is "completed"', () => {
    const env = baseEnvelope({ status: 'completed', finalized_at: new Date().toISOString() });
    expect(isEnvelopeFinalized(env)).toBe(true);
  });

  it('returns true regardless of the timestamp value as long as it is non-empty and status is "completed"', () => {
    const ts = '2026-04-03T00:00:00.000Z';
    expect(isEnvelopeFinalized(baseEnvelope({ status: 'completed', finalized_at: ts }))).toBe(true);
  });

  it('returns false when status is "failed" even with finalized_at set (block-outcome guard)', () => {
    const ts = new Date().toISOString();
    expect(isEnvelopeFinalized(baseEnvelope({ status: 'failed', finalized_at: ts }))).toBe(false);
  });

  it('is backward-compatible: envelopes without the field are treated as not finalized', () => {
    // Simulate a pre-G3 envelope loaded from JSON (field absent, not undefined)
    const raw = { ...baseEnvelope() };
    delete (raw as any).finalized_at;
    expect(isEnvelopeFinalized(raw)).toBe(false);
  });
});

// ─── L2: finalized_at survives save/load round-trip ──────────────────────────

describe('L2 — finalized_at survives envelope save/load', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('finalized_at is absent on a freshly created envelope (no prior finalization)', () => {
    const env = baseEnvelope();
    saveEnvelope(tmpDir, env);
    const loaded = loadEnvelope(tmpDir, env.task_id);
    expect(loaded).not.toBeNull();
    expect(loaded!.finalized_at).toBeUndefined();
  });

  it('finalized_at is preserved after allow-path finalization (status=completed)', () => {
    const ts  = '2026-04-03T12:00:00.000Z';
    const env = baseEnvelope({ status: 'completed', finalized_at: ts });
    saveEnvelope(tmpDir, env);
    const loaded = loadEnvelope(tmpDir, env.task_id);
    expect(loaded).not.toBeNull();
    expect(loaded!.finalized_at).toBe(ts);
    expect(loaded!.status).toBe('completed');
  });

  it('finalized_at is preserved after block-path finalization (status=failed)', () => {
    const ts  = '2026-04-03T13:00:00.000Z';
    const env = baseEnvelope({ status: 'failed', finalized_at: ts });
    saveEnvelope(tmpDir, env);
    const loaded = loadEnvelope(tmpDir, env.task_id);
    expect(loaded).not.toBeNull();
    expect(loaded!.finalized_at).toBe(ts);
    expect(loaded!.status).toBe('failed');
  });

  it('isEnvelopeFinalized returns true for a round-tripped finalized envelope', () => {
    const ts  = new Date().toISOString();
    const env = baseEnvelope({ status: 'completed', finalized_at: ts });
    saveEnvelope(tmpDir, env);
    const loaded = loadEnvelope(tmpDir, env.task_id)!;
    expect(isEnvelopeFinalized(loaded)).toBe(true);
  });

  it('isEnvelopeFinalized returns false for a round-tripped non-finalized envelope', () => {
    const env = baseEnvelope({ status: 'active' });
    saveEnvelope(tmpDir, env);
    const loaded = loadEnvelope(tmpDir, env.task_id)!;
    expect(isEnvelopeFinalized(loaded)).toBe(false);
  });

  it('updating finalized_at from undefined to a timestamp (first finalization) works correctly', () => {
    const env = baseEnvelope();
    saveEnvelope(tmpDir, env);                   // first save — no finalized_at

    const loadedBeforeFinalize = loadEnvelope(tmpDir, env.task_id)!;
    expect(isEnvelopeFinalized(loadedBeforeFinalize)).toBe(false);

    loadedBeforeFinalize.finalized_at = new Date().toISOString();
    loadedBeforeFinalize.status = 'completed';
    saveEnvelope(tmpDir, loadedBeforeFinalize);  // second save — now finalized

    const loadedAfterFinalize = loadEnvelope(tmpDir, env.task_id)!;
    expect(isEnvelopeFinalized(loadedAfterFinalize)).toBe(true);
    expect(loadedAfterFinalize.status).toBe('completed');
  });
});

// ─── L3: Ledger-level dedupe backstop ────────────────────────────────────────

describe('L3 — Ledger dedupe: fetchOutcomeSummaries detects existing entries', () => {
  let tmpDir:  string;
  let dbPath:  string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    dbPath = getLedgerDbPath(tmpDir);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function makeLedgerEntry(traceId: string) {
    const ts = new Date().toISOString();
    return {
      schema_version: '1.0.0' as const,
      ledger_id:      randomUUID(),
      trace_id:       traceId,
      request_id:     `sess_${randomUUID().slice(0, 8)}`,
      session_id:     `sess_${randomUUID().slice(0, 8)}`,
      timestamp:      ts,
      stage:          'analysis' as const,
      record_type:    'run_outcome_summary' as const,
      actor:          'system' as const,
      payload: {
        kind:                   'run_outcome_summary' as const,
        summarized_trace_id:    traceId,
        completion_state:       'merged' as const,
        final_lane:             'B' as const,
        final_confidence:       null,
        had_refusal:            false,
        had_override:           false,
        forced_unknown_applied: false,
        evidence_gate_failed:   false,
        stages_completed:       1,
        run_timestamp:          ts,
      },
    };
  }

  it('fetchOutcomeSummaries returns [] for a trace_id with no entries (safe to write)', () => {
    const db     = initLedgerDb(dbPath);
    const reader = new LedgerReader(db);
    const result = reader.fetchOutcomeSummaries('task_nonexistent');
    expect(result).toHaveLength(0);
    db.close();
  });

  it('fetchOutcomeSummaries returns the entry after first write (dedupe guard fires)', () => {
    const traceId = `task_${randomUUID().slice(0, 8)}`;
    const db      = initLedgerDb(dbPath);
    appendLedgerEntry(db, makeLedgerEntry(traceId));
    const reader  = new LedgerReader(db);
    const result  = reader.fetchOutcomeSummaries(traceId);
    expect(result).toHaveLength(1);
    expect(result[0].record_type).toBe('run_outcome_summary');
    db.close();
  });

  it('dedupe guard correctly scopes by trace_id — different trace_ids do not interfere', () => {
    const traceA = `task_${randomUUID().slice(0, 8)}`;
    const traceB = `task_${randomUUID().slice(0, 8)}`;
    const db     = initLedgerDb(dbPath);
    appendLedgerEntry(db, makeLedgerEntry(traceA));
    const reader = new LedgerReader(db);

    // traceA has an entry — dedupe fires
    expect(reader.fetchOutcomeSummaries(traceA)).toHaveLength(1);
    // traceB has no entry — safe to write
    expect(reader.fetchOutcomeSummaries(traceB)).toHaveLength(0);
    db.close();
  });

  it('append-only: two run_outcome_summary entries can coexist with different ledger_ids', () => {
    // This test CONFIRMS the pre-G3 vulnerability: without the envelope guard,
    // two entries with the same trace_id are accepted by the ledger (different
    // ledger_id = different PRIMARY KEY). The dedupe logic in validate.ts reads
    // the count before writing — this is the backstop that prevents the second write.
    const traceId = `task_${randomUUID().slice(0, 8)}`;
    const db      = initLedgerDb(dbPath);
    appendLedgerEntry(db, makeLedgerEntry(traceId));  // first write
    appendLedgerEntry(db, makeLedgerEntry(traceId));  // second write — would happen pre-G3
    const reader  = new LedgerReader(db);
    // Two entries exist — confirms the ledger itself does NOT deduplicate.
    // The G3 fix prevents validate.ts from ever calling appendLedgerEntry twice.
    expect(reader.fetchOutcomeSummaries(traceId)).toHaveLength(2);
    db.close();
  });
});

// ─── ReasonCode alignment ─────────────────────────────────────────────────────

describe('ReasonCode — TASK_ALREADY_FINALIZED is defined and well-formed', () => {
  it('TASK_ALREADY_FINALIZED is present in ReasonCode', () => {
    expect(ReasonCode.TASK_ALREADY_FINALIZED).toBeDefined();
  });

  it('TASK_ALREADY_FINALIZED has the correct string value', () => {
    expect(ReasonCode.TASK_ALREADY_FINALIZED).toBe('TASK_ALREADY_FINALIZED');
  });

  it('TASK_ALREADY_FINALIZED value does not collide with any other ReasonCode', () => {
    const values = Object.values(ReasonCode);
    const occurrences = values.filter(v => v === ReasonCode.TASK_ALREADY_FINALIZED);
    expect(occurrences).toHaveLength(1);
  });
});

// ─── TaskEnvelope type contract ───────────────────────────────────────────────

describe('TaskEnvelope — finalized_at field contract', () => {
  it('finalized_at is optional (absent by default)', () => {
    const env = baseEnvelope();
    // TypeScript compile check: finalized_at is optional — no TS error without it
    expect('finalized_at' in env).toBe(false);
  });

  it('finalized_at can be set to an ISO 8601 string', () => {
    const ts  = new Date().toISOString();
    const env = baseEnvelope({ finalized_at: ts });
    expect(env.finalized_at).toBe(ts);
  });

  it('TaskEnvelope status values include "failed" (G3: block path sets status=failed)', () => {
    const env = baseEnvelope({ status: 'failed' });
    expect(env.status).toBe('failed');
  });

  it('finalized_at is independent of status — both can be set together', () => {
    const ts  = new Date().toISOString();
    const env = baseEnvelope({ status: 'failed', finalized_at: ts });
    expect(env.status).toBe('failed');
    expect(env.finalized_at).toBe(ts);
  });
});
