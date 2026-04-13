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
import { spawnSync } from 'node:child_process';

import {
  isEnvelopeFinalized,
  isBlockFinalized,
  saveEnvelope,
  loadEnvelope,
  createSession,
  appendHookEvent,
  loadHookEvents,
  generateEventId,
} from '../packages/cli/src/runtime/session.js';

import type { TaskEnvelope, ContractViolationDetectedEvent } from '../packages/cli/src/runtime/types.js';
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

// ─── L1b: isBlockFinalized() pure helper ─────────────────────────────────────
//
// Mirrors L1 but for the block-path idempotency guard.
// isBlockFinalized() must return true only when BOTH:
//   1. finalized_at is a non-empty ISO 8601 string, AND
//   2. status === 'failed' (block outcome)
//
// This ensures the validate.ts block-path guard fires on re-invocations of a
// previously-blocked task, preventing the infinite re-validation loop described
// in the production feedback incident.

describe('L1b — isBlockFinalized() pure function', () => {
  it('returns true when status="failed" and finalized_at is a non-empty string', () => {
    const ts = new Date().toISOString();
    const env = baseEnvelope({ status: 'failed', finalized_at: ts });
    expect(isBlockFinalized(env)).toBe(true);
  });

  it('returns false when status="completed" (allow path — covered by isEnvelopeFinalized)', () => {
    const ts = new Date().toISOString();
    const env = baseEnvelope({ status: 'completed', finalized_at: ts });
    expect(isBlockFinalized(env)).toBe(false);
  });

  it('returns false when status="active" (task not yet finalized)', () => {
    const ts = new Date().toISOString();
    const env = baseEnvelope({ status: 'active', finalized_at: ts });
    expect(isBlockFinalized(env)).toBe(false);
  });

  it('returns false when finalized_at is absent (block never persisted)', () => {
    const env = baseEnvelope({ status: 'failed' });
    expect(isBlockFinalized(env)).toBe(false);
  });

  it('returns false when finalized_at is an empty string', () => {
    const env = baseEnvelope({ status: 'failed', finalized_at: '' });
    expect(isBlockFinalized(env)).toBe(false);
  });

  it('returns false when finalized_at is explicitly undefined', () => {
    const env = baseEnvelope({ status: 'failed', finalized_at: undefined });
    expect(isBlockFinalized(env)).toBe(false);
  });

  it('is backward-compatible: pre-G3 envelope without finalized_at field returns false', () => {
    const raw = { ...baseEnvelope({ status: 'failed' }) };
    delete (raw as any).finalized_at;
    expect(isBlockFinalized(raw)).toBe(false);
  });

  it('isBlockFinalized and isEnvelopeFinalized are mutually exclusive for any single envelope', () => {
    const ts = new Date().toISOString();
    // No envelope can simultaneously satisfy both guards
    const completed = baseEnvelope({ status: 'completed', finalized_at: ts });
    expect(isEnvelopeFinalized(completed) && isBlockFinalized(completed)).toBe(false);

    const failed = baseEnvelope({ status: 'failed', finalized_at: ts });
    expect(isEnvelopeFinalized(failed) && isBlockFinalized(failed)).toBe(false);

    const active = baseEnvelope({ status: 'active', finalized_at: ts });
    expect(isEnvelopeFinalized(active) && isBlockFinalized(active)).toBe(false);
  });

  it('the two guards together cover all finalized outcomes: completed→allow, failed→block', () => {
    const ts = new Date().toISOString();
    const completedEnv = baseEnvelope({ status: 'completed', finalized_at: ts });
    expect(isEnvelopeFinalized(completedEnv)).toBe(true);
    expect(isBlockFinalized(completedEnv)).toBe(false);

    const failedEnv = baseEnvelope({ status: 'failed', finalized_at: ts });
    expect(isEnvelopeFinalized(failedEnv)).toBe(false);
    expect(isBlockFinalized(failedEnv)).toBe(true);
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

// ─── L4: Block-path advisory emitted at most once ────────────────────────────
//
// Verifies the predicate used by validate.ts G3 block-path to decide whether to
// emit the TASK_ALREADY_FINALIZED advisory. The advisory must be written at most
// once — subsequent re-invocations should detect the existing entry and skip
// emitting, breaking the feedback loop that caused "It keeps running" in production.

describe('L4 — block-path advisory emitted at most once per task', () => {
  let tmpDir:    string;
  let sessionId: string;
  let taskId:    string;

  beforeEach(() => {
    tmpDir    = makeTmpDir();
    sessionId = `sess_test_${randomUUID().slice(0, 8)}`;
    taskId    = `task_test_${randomUUID().slice(0, 8)}`;
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('predicate returns false (no existing advisory) when hook-events file is empty', () => {
    const events = loadHookEvents(tmpDir, sessionId);
    const alreadyEmitted = events.some(
      e =>
        e.event_type === 'ContractViolationDetected' &&
        e.task_id    === taskId &&
        (e as ContractViolationDetectedEvent).payload?.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );
    expect(alreadyEmitted).toBe(false);
  });

  it('predicate returns true after a TASK_ALREADY_FINALIZED advisory is written for the task', () => {
    const advisory: ContractViolationDetectedEvent = {
      event_id:   generateEventId(),
      timestamp:  new Date().toISOString(),
      session_id: sessionId,
      task_id:    taskId,
      run_id:     `run_test_${randomUUID().slice(0, 8)}`,
      hook_stage: 'validate',
      event_type: 'ContractViolationDetected',
      status:     'violated',
      payload: {
        reason_code:           ReasonCode.TASK_ALREADY_FINALIZED,
        violated_contract:     'Stop hook must produce exactly one terminal outcome per task_id',
        expected:              `single outcome for task_id=${taskId}`,
        actual:                `task was previously blocked; duplicate invocation suppressed`,
        severity:              'advisory',
        blocking_action_taken: false,
      },
    };
    appendHookEvent(tmpDir, sessionId, advisory);

    const events = loadHookEvents(tmpDir, sessionId);
    const alreadyEmitted = events.some(
      e =>
        e.event_type === 'ContractViolationDetected' &&
        e.task_id    === taskId &&
        (e as ContractViolationDetectedEvent).payload?.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );
    expect(alreadyEmitted).toBe(true);
  });

  it('predicate is scoped to task_id — advisory for a different task does not satisfy the check', () => {
    const otherTaskId = `task_other_${randomUUID().slice(0, 8)}`;
    const advisory: ContractViolationDetectedEvent = {
      event_id:   generateEventId(),
      timestamp:  new Date().toISOString(),
      session_id: sessionId,
      task_id:    otherTaskId,   // different task
      run_id:     `run_test_${randomUUID().slice(0, 8)}`,
      hook_stage: 'validate',
      event_type: 'ContractViolationDetected',
      status:     'violated',
      payload: {
        reason_code:           ReasonCode.TASK_ALREADY_FINALIZED,
        violated_contract:     'Stop hook must produce exactly one terminal outcome per task_id',
        expected:              `single outcome for task_id=${otherTaskId}`,
        actual:                `other task was previously blocked`,
        severity:              'advisory',
        blocking_action_taken: false,
      },
    };
    appendHookEvent(tmpDir, sessionId, advisory);

    const events = loadHookEvents(tmpDir, sessionId);
    // Checking for taskId (not otherTaskId) — should find nothing
    const alreadyEmitted = events.some(
      e =>
        e.event_type === 'ContractViolationDetected' &&
        e.task_id    === taskId &&
        (e as ContractViolationDetectedEvent).payload?.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );
    expect(alreadyEmitted).toBe(false);
  });
});

// ─── L5: Guard hard-blocks all tools after terminal block ─────────────────────
//
// Verifies that once a task envelope is block-finalized (status='failed',
// finalized_at set), the guard subprocess returns decision='deny' for all
// tool calls — not just Edit/Write/MultiEdit (which Rule 3 already blocks),
// but also Bash and any other tool. Without this guard, the agent can re-run
// verification commands after a block, trigger another stop hook, and sustain
// the re-invocation loop that was observed in production (session 9a8a8092).
//
// These tests use spawnSync against the compiled CLI dist/index.js.

const CLI_PATH = path.resolve(import.meta.dirname, '../packages/cli/dist/index.js');

function makeProjectWithConfig(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'nirnex.config.json'), JSON.stringify({ project: 'test' }), 'utf8');
}

function writeSession(dir: string, sessionId: string, taskId: string): void {
  const sessDir = path.join(dir, '.ai-index', 'runtime', 'sessions');
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessDir, `${sessionId}.json`),
    JSON.stringify({ session_id: sessionId, active_task_id: taskId, tasks: [taskId], created_at: new Date().toISOString() }),
    'utf8',
  );
}

function writeEnvelopeFile(dir: string, taskId: string, overrides: Record<string, unknown> = {}): void {
  const envDir = path.join(dir, '.ai-index', 'runtime', 'envelopes');
  fs.mkdirSync(envDir, { recursive: true });
  const envelope = {
    task_id: taskId,
    session_id: 'sess_l5',
    created_at: new Date().toISOString(),
    prompt: 'test',
    lane: 'B',
    scope: { allowed_paths: [], blocked_paths: [], modules_expected: [] },
    constraints: [],
    acceptance_criteria: [],
    tool_policy: { allowed_tools: [], requires_guard: ['Edit', 'Write', 'Bash'], denied_patterns: [] },
    stop_conditions: { required_validations: [], forbidden_files: [] },
    confidence: { score: 80, label: 'medium', penalties: [] },
    eco_summary: { intent: 'test', recommended_lane: 'B', forced_unknown: false, blocked: false, escalation_reasons: [], boundary_warnings: [] },
    status: 'active',
    ...overrides,
  };
  fs.writeFileSync(path.join(envDir, `${taskId}.json`), JSON.stringify(envelope), 'utf8');
}

function invokeGuard(dir: string, sessionId: string, toolName: string, toolInput: Record<string, unknown>): { decision: string; reason?: string } {
  const payload = JSON.stringify({
    session_id: sessionId,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
  });
  const result = spawnSync('node', [CLI_PATH, 'runtime', 'guard'], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, NIRNEX_REPO_ROOT: dir, NIRNEX_SESSION_ID: sessionId },
    timeout: 5000,
  });
  return JSON.parse(result.stdout || '{"decision":"allow"}');
}

describe('L5 — guard hard-blocks all tool calls when task is block-finalized', () => {
  let tmpDir:    string;
  let sessionId: string;
  let taskId:    string;

  beforeEach(() => {
    tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'nirnex-guard-l5-'));
    sessionId = `sess_l5_${randomUUID().slice(0, 8)}`;
    taskId    = `task_l5_${randomUUID().slice(0, 8)}`;
    makeProjectWithConfig(tmpDir);
    writeSession(tmpDir, sessionId, taskId);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('allows Edit tool when task is active (baseline — guard not yet blocking)', () => {
    writeEnvelopeFile(tmpDir, taskId, { status: 'active' });
    const out = invokeGuard(tmpDir, sessionId, 'Edit', { file_path: 'app/page.tsx', old_string: 'a', new_string: 'b' });
    expect(out.decision).toBe('allow');
  });

  it('denies Edit tool when task is block-finalized', () => {
    writeEnvelopeFile(tmpDir, taskId, { status: 'failed', finalized_at: new Date().toISOString() });
    const out = invokeGuard(tmpDir, sessionId, 'Edit', { file_path: 'app/page.tsx', old_string: 'a', new_string: 'b' });
    expect(out.decision).toBe('deny');
  });

  it('denies Bash tool when task is block-finalized (Rule 3 alone would allow this)', () => {
    writeEnvelopeFile(tmpDir, taskId, { status: 'failed', finalized_at: new Date().toISOString() });
    const out = invokeGuard(tmpDir, sessionId, 'Bash', { command: 'npm run lint' });
    expect(out.decision).toBe('deny');
  });

  it('denies Write tool when task is block-finalized', () => {
    writeEnvelopeFile(tmpDir, taskId, { status: 'failed', finalized_at: new Date().toISOString() });
    const out = invokeGuard(tmpDir, sessionId, 'Write', { file_path: 'app/new.tsx', content: 'x' });
    expect(out.decision).toBe('deny');
  });

  it('deny reason references the task_id for traceability', () => {
    writeEnvelopeFile(tmpDir, taskId, { status: 'failed', finalized_at: new Date().toISOString() });
    const out = invokeGuard(tmpDir, sessionId, 'Bash', { command: 'npm run lint' });
    expect(out.decision).toBe('deny');
    expect(out.reason).toContain(taskId);
  });
});

// ─── L6: Validate lifecycle completeness after terminal block ─────────────────
//
// Verifies that every validate invocation — including silent re-invocations after
// the first TASK_ALREADY_FINALIZED advisory — emits a matched StageCompleted event.
//
// Without this, each silent re-invocation leaves an orphaned HookInvocationStarted
// in the audit trail, visible in production as:
//   12:26:43 validate HookInvocationStarted (pid=37791)  ← no StageCompleted follows
// The hook framework may retry or mis-handle invocations with incomplete lifecycles.
//
// Rule: for every HookInvocationStarted in hook-events.jsonl there must be a
// matching StageCompleted with the same run_id.

function invokeValidate(dir: string, sessionId: string): { decision: string } {
  const payload = JSON.stringify({ session_id: sessionId });
  const result = spawnSync('node', [CLI_PATH, 'runtime', 'validate'], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, NIRNEX_REPO_ROOT: dir, NIRNEX_SESSION_ID: sessionId },
    timeout: 10000,
  });
  return JSON.parse(result.stdout || '{"decision":"allow"}');
}

function countEventsOfType(dir: string, sessionId: string, eventType: string): number {
  return loadHookEvents(dir, sessionId).filter(e => e.event_type === eventType).length;
}

describe('L6 — validate lifecycle completeness: StageCompleted on every invocation', () => {
  let tmpDir:    string;
  let sessionId: string;
  let taskId:    string;

  beforeEach(() => {
    tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'nirnex-validate-l6-'));
    sessionId = `sess_l6_${randomUUID().slice(0, 8)}`;
    taskId    = `task_l6_${randomUUID().slice(0, 8)}`;
    makeProjectWithConfig(tmpDir);
    writeSession(tmpDir, sessionId, taskId);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('first re-invocation: emits advisory + StageCompleted, returns block', () => {
    writeEnvelopeFile(tmpDir, taskId, { status: 'failed', finalized_at: new Date().toISOString() });

    const out = invokeValidate(tmpDir, sessionId);

    expect(out.decision).toBe('block');
    // One advisory emitted (first re-invocation)
    const advisories = loadHookEvents(tmpDir, sessionId).filter(
      e => e.event_type === 'ContractViolationDetected' &&
           (e as ContractViolationDetectedEvent).payload?.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );
    expect(advisories).toHaveLength(1);
    // StageCompleted present (lifecycle closed)
    expect(countEventsOfType(tmpDir, sessionId, 'StageCompleted')).toBeGreaterThanOrEqual(1);
  });

  it('second re-invocation: emits StageCompleted but NOT a second advisory', () => {
    writeEnvelopeFile(tmpDir, taskId, { status: 'failed', finalized_at: new Date().toISOString() });

    // First re-invocation — emits advisory
    invokeValidate(tmpDir, sessionId);
    const advisoriesAfterFirst = loadHookEvents(tmpDir, sessionId).filter(
      e => e.event_type === 'ContractViolationDetected' &&
           (e as ContractViolationDetectedEvent).payload?.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );
    expect(advisoriesAfterFirst).toHaveLength(1);

    const scCountAfterFirst = countEventsOfType(tmpDir, sessionId, 'StageCompleted');

    // Second re-invocation — must emit StageCompleted but NOT a second advisory
    const out = invokeValidate(tmpDir, sessionId);
    expect(out.decision).toBe('block');

    const advisoriesAfterSecond = loadHookEvents(tmpDir, sessionId).filter(
      e => e.event_type === 'ContractViolationDetected' &&
           (e as ContractViolationDetectedEvent).payload?.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );
    // Advisory count must NOT increase
    expect(advisoriesAfterSecond).toHaveLength(1);
    // StageCompleted count MUST increase — lifecycle was closed on second invocation
    expect(countEventsOfType(tmpDir, sessionId, 'StageCompleted')).toBeGreaterThan(scCountAfterFirst);
  });

  it('every HookInvocationStarted for validate has a matching StageCompleted after two re-invocations', () => {
    writeEnvelopeFile(tmpDir, taskId, { status: 'failed', finalized_at: new Date().toISOString() });

    invokeValidate(tmpDir, sessionId);
    invokeValidate(tmpDir, sessionId);

    const events = loadHookEvents(tmpDir, sessionId);
    const starts = events.filter(e => e.event_type === 'HookInvocationStarted' && e.hook_stage === 'validate');
    const completions = events.filter(e => e.event_type === 'StageCompleted' && e.hook_stage === 'validate');

    // Every validate invocation must produce exactly one StageCompleted
    expect(completions.length).toBe(starts.length);
  });
});
