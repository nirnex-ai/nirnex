// Pure builder functions for StageCompleted events emitted by guard and trace.
// No side effects — callers are responsible for appending to the event stream.

import { generateEventId, generateRunId } from './session.js';
import { StageCompletedEvent, HookStage } from './types.js';

interface GuardStageCompletedOpts {
  sessionId: string;
  taskId: string;
  runId: string;
  decision: 'allow' | 'deny' | 'ask';
}

interface TraceStageCompletedOpts {
  sessionId: string;
  taskId: string;
  runId: string;
  deviationFlags: string[];
}

/**
 * Build a StageCompleted event for the guard stage.
 * - deny  → status: 'fail', blocker_count: 1
 * - allow | ask → status: 'pass', blocker_count: 0  (ask is not a failure)
 */
export function buildGuardStageCompleted(opts: GuardStageCompletedOpts): StageCompletedEvent {
  const { sessionId, taskId, runId, decision } = opts;
  const isDeny = decision === 'deny';

  return {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: taskId,
    run_id: runId,
    hook_stage: 'guard',
    event_type: 'StageCompleted',
    status: isDeny ? 'fail' : 'pass',
    payload: {
      stage: 'guard',
      blocker_count: isDeny ? 1 : 0,
      violation_count: 0,
    },
  };
}

/**
 * Build a StageCompleted event for the trace stage.
 * Trace always completes (it records and signals, never hard-blocks).
 * Deviation count is surfaced in blocker_count so downstream can see what trace found.
 */
export function buildTraceStageCompleted(opts: TraceStageCompletedOpts): StageCompletedEvent {
  const { sessionId, taskId, runId, deviationFlags } = opts;

  return {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: taskId,
    run_id: runId,
    hook_stage: 'trace',
    event_type: 'StageCompleted',
    status: 'pass',
    payload: {
      stage: 'trace',
      blocker_count: deviationFlags.length,
      violation_count: 0,
    },
  };
}
