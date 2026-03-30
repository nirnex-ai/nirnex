/**
 * Hook Stage Completion — TDD Tests
 *
 * Written BEFORE implementation (red phase).
 *
 * Tests for:
 *   1. guard emits StageCompleted on allow
 *   2. guard emits StageCompleted on deny (status: fail, blocker_count: 1)
 *   3. guard emits StageCompleted on ask (status: pass — ask is not failure)
 *   4. trace emits StageCompleted after recording a tool event
 *   5. trace emits StageCompleted when deviation is detected (status: pass — trace always completes)
 *   6. hook-log --list returns one row per FinalOutcomeDeclared task
 *   7. hook-log --list rows include decision, violation counts, session, task_id, timestamp
 *   8. hook-log --list returns rows ordered most-recent first
 *   9. hook-log --list returns empty when no completed runs exist
 *  10. StageCompleted.status is always 'pass' or 'fail' — never missing
 *
 * Fixture strategy:
 *   Tests write hook events directly using appendHookEvent / buildGuardStageCompleted /
 *   buildTraceStageCompleted — functions exported from the runtime modules.
 *   No stdin/stdout mocking required.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  appendHookEvent,
  loadHookEvents,
  generateEventId,
  generateRunId,
} from '../packages/cli/src/runtime/session.js';
import {
  StageCompletedEvent,
  FinalOutcomeDeclaredEvent,
  HookInvocationStartedEvent,
  ReasonCode,
} from '../packages/cli/src/runtime/types.js';

// buildGuardStageCompleted and buildTraceStageCompleted are imported from the
// runtime modules — these DO NOT EXIST YET (red phase).
import {
  buildGuardStageCompleted,
  buildTraceStageCompleted,
} from '../packages/cli/src/runtime/stage-completion.js';

// listCompletedRuns is a new export from hook-log — does NOT EXIST YET (red phase).
import { listCompletedRuns } from '../packages/cli/src/commands/hook-log.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const createdDirs: string[] = [];

function makeProject(): string {
  const dir = join(tmpdir(), `nirnex-stage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({ project: 'test' }), 'utf8');
  createdDirs.push(dir);
  return dir;
}

function emitInvocation(dir: string, sessionId: string, runId: string, stage: 'guard' | 'trace'): void {
  const ev: HookInvocationStartedEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: 'task_test',
    run_id: runId,
    hook_stage: stage,
    event_type: 'HookInvocationStarted',
    payload: { stage, cwd: dir, repo_root: dir, pid: process.pid },
  };
  appendHookEvent(dir, sessionId, ev);
}

afterEach(() => {
  for (const d of createdDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  createdDirs.length = 0;
});

// ─── 1. guard StageCompleted on allow ─────────────────────────────────────────

describe('guard — StageCompleted on allow decision', () => {
  it('emits StageCompleted with status=pass and blocker_count=0', () => {
    const dir = makeProject();
    const sessionId = 'sess_guard_allow';
    const runId = generateRunId();

    emitInvocation(dir, sessionId, runId, 'guard');

    const ev = buildGuardStageCompleted({
      sessionId,
      taskId: 'task_test',
      runId,
      decision: 'allow',
    });
    appendHookEvent(dir, sessionId, ev);

    const events = loadHookEvents(dir, sessionId);
    const completed = events.filter(e => e.event_type === 'StageCompleted') as StageCompletedEvent[];

    expect(completed).toHaveLength(1);
    expect(completed[0].hook_stage).toBe('guard');
    expect(completed[0].status).toBe('pass');
    expect(completed[0].payload.blocker_count).toBe(0);
    expect(completed[0].payload.stage).toBe('guard');
  });
});

// ─── 2. guard StageCompleted on deny ──────────────────────────────────────────

describe('guard — StageCompleted on deny decision', () => {
  it('emits StageCompleted with status=fail and blocker_count=1', () => {
    const dir = makeProject();
    const sessionId = 'sess_guard_deny';
    const runId = generateRunId();

    emitInvocation(dir, sessionId, runId, 'guard');

    const ev = buildGuardStageCompleted({
      sessionId,
      taskId: 'task_test',
      runId,
      decision: 'deny',
    });
    appendHookEvent(dir, sessionId, ev);

    const events = loadHookEvents(dir, sessionId);
    const completed = events.filter(e => e.event_type === 'StageCompleted') as StageCompletedEvent[];

    expect(completed[0].status).toBe('fail');
    expect(completed[0].payload.blocker_count).toBe(1);
  });
});

// ─── 3. guard StageCompleted on ask ───────────────────────────────────────────

describe('guard — StageCompleted on ask decision', () => {
  it('emits StageCompleted with status=pass — ask is not failure', () => {
    const dir = makeProject();
    const sessionId = 'sess_guard_ask';
    const runId = generateRunId();

    emitInvocation(dir, sessionId, runId, 'guard');

    const ev = buildGuardStageCompleted({
      sessionId,
      taskId: 'task_test',
      runId,
      decision: 'ask',
    });
    appendHookEvent(dir, sessionId, ev);

    const events = loadHookEvents(dir, sessionId);
    const completed = events.filter(e => e.event_type === 'StageCompleted') as StageCompletedEvent[];

    expect(completed[0].status).toBe('pass');
    expect(completed[0].payload.blocker_count).toBe(0);
  });
});

// ─── 4. trace StageCompleted after recording a tool event ─────────────────────

describe('trace — StageCompleted after normal tool recording', () => {
  it('emits StageCompleted with status=pass and deviation_count=0', () => {
    const dir = makeProject();
    const sessionId = 'sess_trace_clean';
    const runId = generateRunId();

    emitInvocation(dir, sessionId, runId, 'trace');

    const ev = buildTraceStageCompleted({
      sessionId,
      taskId: 'task_test',
      runId,
      deviationFlags: [],
    });
    appendHookEvent(dir, sessionId, ev);

    const events = loadHookEvents(dir, sessionId);
    const completed = events.filter(e => e.event_type === 'StageCompleted') as StageCompletedEvent[];

    expect(completed).toHaveLength(1);
    expect(completed[0].hook_stage).toBe('trace');
    expect(completed[0].status).toBe('pass');
    expect(completed[0].payload.stage).toBe('trace');
    // deviation count surfaced in blocker_count for trace
    expect(completed[0].payload.blocker_count).toBe(0);
  });
});

// ─── 5. trace StageCompleted with deviations ──────────────────────────────────

describe('trace — StageCompleted when deviations are detected', () => {
  it('emits StageCompleted with status=pass and blocker_count = deviation count', () => {
    const dir = makeProject();
    const sessionId = 'sess_trace_deviation';
    const runId = generateRunId();

    emitInvocation(dir, sessionId, runId, 'trace');

    const ev = buildTraceStageCompleted({
      sessionId,
      taskId: 'task_test',
      runId,
      deviationFlags: ['file_in_blocked_path:src/locked.ts', 'file_out_of_scope:vendor/lib.ts'],
    });
    appendHookEvent(dir, sessionId, ev);

    const events = loadHookEvents(dir, sessionId);
    const completed = events.filter(e => e.event_type === 'StageCompleted') as StageCompletedEvent[];

    // trace always completes (it records and signals, never hard-blocks)
    expect(completed[0].status).toBe('pass');
    // deviation count is surfaced so downstream can see what trace found
    expect(completed[0].payload.blocker_count).toBe(2);
  });
});

// ─── 6–9. hook-log --list ─────────────────────────────────────────────────────

describe('listCompletedRuns', () => {
  it('returns one row per distinct task_id that has a FinalOutcomeDeclared', () => {
    const dir = makeProject();
    const sessionId = 'sess_list_a';
    const runId = generateRunId();

    const finalEv: FinalOutcomeDeclaredEvent = {
      event_id: generateEventId(),
      timestamp: '2026-03-30T10:14:45.000Z',
      session_id: sessionId,
      task_id: 'task_aaa',
      run_id: runId,
      hook_stage: 'validate',
      event_type: 'FinalOutcomeDeclared',
      payload: {
        decision: 'allow',
        violation_count: 0,
        blocking_violation_count: 0,
        advisory_violation_count: 0,
        reason_codes: [],
        verification_status: 'not_requested',
        acceptance_status: 'not_requested',
        envelope_status: 'completed',
      },
    };
    appendHookEvent(dir, sessionId, finalEv);

    const rows = listCompletedRuns(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].task_id).toBe('task_aaa');
    expect(rows[0].session_id).toBe(sessionId);
    expect(rows[0].decision).toBe('allow');
  });

  it('row includes blocking_violation_count and verification_status', () => {
    const dir = makeProject();
    const sessionId = 'sess_list_b';
    const runId = generateRunId();

    const finalEv: FinalOutcomeDeclaredEvent = {
      event_id: generateEventId(),
      timestamp: '2026-03-30T10:20:00.000Z',
      session_id: sessionId,
      task_id: 'task_bbb',
      run_id: runId,
      hook_stage: 'validate',
      event_type: 'FinalOutcomeDeclared',
      payload: {
        decision: 'block',
        violation_count: 2,
        blocking_violation_count: 1,
        advisory_violation_count: 1,
        reason_codes: [ReasonCode.VERIFICATION_REQUIRED_NOT_RUN, ReasonCode.ACCEPTANCE_NOT_EVALUATED],
        verification_status: 'skipped',
        acceptance_status: 'skipped',
        envelope_status: 'active',
      },
    };
    appendHookEvent(dir, sessionId, finalEv);

    const rows = listCompletedRuns(dir);
    expect(rows[0].decision).toBe('block');
    expect(rows[0].blocking_violation_count).toBe(1);
    expect(rows[0].verification_status).toBe('skipped');
  });

  it('returns rows ordered most-recent first (by timestamp DESC)', () => {
    const dir = makeProject();

    const make = (ts: string, taskId: string, sessionId: string) => {
      const ev: FinalOutcomeDeclaredEvent = {
        event_id: generateEventId(),
        timestamp: ts,
        session_id: sessionId,
        task_id: taskId,
        run_id: generateRunId(),
        hook_stage: 'validate',
        event_type: 'FinalOutcomeDeclared',
        payload: {
          decision: 'allow', violation_count: 0, blocking_violation_count: 0,
          advisory_violation_count: 0, reason_codes: [],
          verification_status: 'not_requested', acceptance_status: 'not_requested',
          envelope_status: 'completed',
        },
      };
      appendHookEvent(dir, sessionId, ev);
    };

    make('2026-03-30T08:00:00.000Z', 'task_old', 'sess_old');
    make('2026-03-30T10:00:00.000Z', 'task_new', 'sess_new');

    const rows = listCompletedRuns(dir);
    expect(rows[0].task_id).toBe('task_new');
    expect(rows[1].task_id).toBe('task_old');
  });

  it('returns empty array when no runs have completed', () => {
    const dir = makeProject();
    const sessionId = 'sess_empty';

    // Only invocation event, no FinalOutcomeDeclared
    appendHookEvent(dir, sessionId, {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      task_id: 'none',
      run_id: generateRunId(),
      hook_stage: 'entry',
      event_type: 'HookInvocationStarted',
      payload: { stage: 'entry', cwd: dir, repo_root: dir, pid: 1 },
    });

    const rows = listCompletedRuns(dir);
    expect(rows).toHaveLength(0);
  });

  it('deduplicates: multiple FinalOutcomeDeclared for same task returns the latest', () => {
    const dir = makeProject();
    const sessionId = 'sess_dedup';
    const taskId = 'task_retry';

    const makeOutcome = (ts: string, decision: 'allow' | 'block') => {
      const ev: FinalOutcomeDeclaredEvent = {
        event_id: generateEventId(),
        timestamp: ts,
        session_id: sessionId,
        task_id: taskId,
        run_id: generateRunId(),
        hook_stage: 'validate',
        event_type: 'FinalOutcomeDeclared',
        payload: {
          decision, violation_count: 0, blocking_violation_count: 0,
          advisory_violation_count: 0, reason_codes: [],
          verification_status: 'not_requested', acceptance_status: 'not_requested',
          envelope_status: decision === 'allow' ? 'completed' : 'active',
        },
      };
      appendHookEvent(dir, sessionId, ev);
    };

    // First attempt blocked, second allowed (retry scenario)
    makeOutcome('2026-03-30T09:00:00.000Z', 'block');
    makeOutcome('2026-03-30T09:05:00.000Z', 'allow');

    const rows = listCompletedRuns(dir);
    // Only one row per task — showing the most recent outcome
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe('allow');
  });
});

// ─── 10. StageCompleted.status is never missing ───────────────────────────────

describe('StageCompleted schema invariant', () => {
  it('status field is always present and is pass or fail', () => {
    const dir = makeProject();
    const sessionId = 'sess_schema';
    const runId = generateRunId();

    for (const decision of ['allow', 'deny', 'ask'] as const) {
      const ev = buildGuardStageCompleted({ sessionId, taskId: 'task_x', runId, decision });
      appendHookEvent(dir, `${sessionId}_${decision}`, ev);
      expect(['pass', 'fail']).toContain(ev.status);
    }

    const traceEv = buildTraceStageCompleted({ sessionId, taskId: 'task_x', runId, deviationFlags: [] });
    expect(['pass', 'fail']).toContain(traceEv.status);
  });
});
