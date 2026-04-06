/**
 * Sprint 29 — Pre-Execution Guard Enforcement & Cross-Task Trace Isolation (TDD)
 *
 * Addresses three issues found in the Nirnex validation feedback:
 *
 * 1. POST_VERIFICATION_EDIT was fired on the second task in a session because
 *    validate.ts loaded ALL trace events for the session (no task_id filter).
 *    Verification from a prior task appeared as "already ran," making the
 *    current task's Edit look like a post-verification edit.
 *
 *    Fix: validate.ts now filters events by envelope.task_id before running
 *    Zero-Trust checks.
 *
 * 2. The guard stage (PreToolUse) never checked for prior verification before
 *    allowing Edit/Write/MultiEdit. Violations were only detected post-facto
 *    at the validate stage. The guard now denies file modifications if
 *    verification has already run within the same task.
 *
 * 3. The G3 idempotency path in validate.ts emitted HookInvocationStarted +
 *    ContractViolationDetected (advisory) but no StageCompleted, leaving the
 *    lifecycle incomplete.
 *
 *    Fix: validate.ts G3 path now emits StageCompleted after the advisory.
 *
 * Coverage:
 *
 * 1. isBashVerificationCommand — exported helper
 *    1.1  returns true for npm run lint (stored command match)
 *    1.2  returns true for npm run test (pattern match)
 *    1.3  returns true for jest (pattern match)
 *    1.4  returns false for a plain git commit (non-verification)
 *    1.5  returns false for empty string
 *    1.6  stored commands take precedence over pattern
 *    1.7  returns false when storedCmds is empty and command is non-verification
 *
 * 2. evaluateZeroTrustRules — task_id isolation behaviour
 *    2.1  events from a different task_id are excluded when task filter applied
 *    2.2  edit before verification in the CURRENT task does not trigger Rule 3
 *    2.3  edit after verification in the CURRENT task triggers Rule 3
 *
 * 3. isEnvelopeFinalized — re-verified for G3 path coverage
 *    3.1  returns false when finalized_at is absent
 *    3.2  returns true when finalized_at is set
 */

import { describe, it, expect } from 'vitest';
import { isBashVerificationCommand, evaluateZeroTrustRules } from '../packages/cli/src/runtime/attestation.js';
import { isEnvelopeFinalized } from '../packages/cli/src/runtime/session.js';
import type { TraceEvent, TaskEnvelope } from '../packages/cli/src/runtime/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBashTrace(command: string, exitCode: number | null, taskId = 'task_current'): TraceEvent {
  const toolResult: Record<string, unknown> = exitCode !== null ? { exit_code: exitCode } : {};
  return {
    event_id:       'evt_test',
    session_id:     'sess_test',
    task_id:        taskId,
    timestamp:      new Date().toISOString(),
    tool:           'Bash',
    tool_input:     { command },
    tool_result:    toolResult,
    affected_files: [],
    deviation_flags: [],
    attestation: {
      command_hash:      'abc',
      exit_code:         exitCode,
      captured_by:       'trace-hook',
      verified:          exitCode !== null,
      capture_timestamp: new Date().toISOString(),
    },
  };
}

function makeEditTrace(filePath: string, taskId = 'task_current'): TraceEvent {
  return {
    event_id:       'evt_edit',
    session_id:     'sess_test',
    task_id:        taskId,
    timestamp:      new Date().toISOString(),
    tool:           'Edit',
    tool_input:     { file_path: filePath },
    tool_result:    {},
    affected_files: [filePath],
    deviation_flags: [],
  };
}

function baseEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    task_id:    'task_current',
    session_id: 'sess_test',
    created_at: new Date().toISOString(),
    prompt:     'test prompt',
    lane:       'A',
    scope:      { allowed_paths: [], blocked_paths: [], modules_expected: [] },
    constraints:         [],
    acceptance_criteria: [],
    tool_policy:         { allowed_tools: [], requires_guard: [], denied_patterns: [] },
    stop_conditions:     { required_validations: [], forbidden_files: [] },
    confidence:          { score: 80, label: 'high', penalties: [] },
    eco_summary: {
      intent: 'test', recommended_lane: 'A',
      forced_unknown: false, blocked: false,
      escalation_reasons: [], boundary_warnings: [],
    },
    status: 'active',
    ...overrides,
  };
}

// ─── Section 1: isBashVerificationCommand ────────────────────────────────────

describe('1. isBashVerificationCommand', () => {
  it('1.1 returns true for npm run lint (stored command match)', () => {
    expect(isBashVerificationCommand('npm run lint', ['npm run lint'])).toBe(true);
  });

  it('1.2 returns true for npm run test (pattern match)', () => {
    expect(isBashVerificationCommand('npm run test', [])).toBe(true);
  });

  it('1.3 returns true for jest (pattern match)', () => {
    expect(isBashVerificationCommand('jest --coverage', [])).toBe(true);
  });

  it('1.4 returns false for plain git commit (non-verification)', () => {
    expect(isBashVerificationCommand('git commit -m "fix"', [])).toBe(false);
  });

  it('1.5 returns false for empty string', () => {
    expect(isBashVerificationCommand('', [])).toBe(false);
  });

  it('1.6 stored commands take precedence — custom command not matching pattern is still detected', () => {
    // 'make check' doesn't match the default pattern, but is a stored verification command
    expect(isBashVerificationCommand('make check', ['make check'])).toBe(true);
  });

  it('1.7 returns false when no stored cmds and command is non-verification', () => {
    expect(isBashVerificationCommand('echo hello', [])).toBe(false);
  });
});

// ─── Section 2: evaluateZeroTrustRules — task isolation ──────────────────────

describe('2. evaluateZeroTrustRules — task_id isolation', () => {
  it('2.1 events from a different task_id do not contaminate Rule 3 when caller pre-filters', () => {
    // Simulate: session has events from task_old (lint ran) and task_current (edit ran)
    // The caller (validate.ts) now filters by task_id=current before passing to evaluateZeroTrustRules
    const taskOldLint = makeBashTrace('npm run lint', 0, 'task_old');
    const taskCurrentEdit = makeEditTrace('src/foo.ts', 'task_current');
    const taskCurrentLint = makeBashTrace('npm run lint', 0, 'task_current');

    // If validate.ts correctly filters to task_current events only:
    const taskCurrentEvents = [taskOldLint, taskCurrentEdit, taskCurrentLint]
      .filter(e => e.task_id === 'task_current');
    // taskCurrentEvents = [taskCurrentEdit, taskCurrentLint]
    // Edit comes BEFORE lint → no Rule 3 violation
    const violations = evaluateZeroTrustRules(taskCurrentEvents, true, ['npm run lint']);
    const rule3 = violations.filter(v => v.reason_code === 'POST_VERIFICATION_EDIT');
    expect(rule3.length).toBe(0);
  });

  it('2.2 edit before verification in the current task does not trigger Rule 3', () => {
    // Standard developer workflow: edit → lint
    const edit = makeEditTrace('src/page.tsx', 'task_current');
    const lint = makeBashTrace('npm run lint', 0, 'task_current');
    const violations = evaluateZeroTrustRules([edit, lint], true, ['npm run lint']);
    const rule3 = violations.filter(v => v.reason_code === 'POST_VERIFICATION_EDIT');
    expect(rule3.length).toBe(0);
  });

  it('2.3 edit after verification in the current task triggers Rule 3', () => {
    // Reversed workflow: lint → edit (violates Zero-Trust Rule 3)
    const lint = makeBashTrace('npm run lint', 0, 'task_current');
    const edit = makeEditTrace('src/page.tsx', 'task_current');
    const violations = evaluateZeroTrustRules([lint, edit], true, ['npm run lint']);
    const rule3 = violations.filter(v => v.reason_code === 'POST_VERIFICATION_EDIT');
    expect(rule3.length).toBe(1);
    expect(rule3[0].severity).toBe('blocking');
  });
});

// ─── Section 3: isEnvelopeFinalized — G3 path coverage ───────────────────────

describe('3. isEnvelopeFinalized', () => {
  it('3.1 returns false when finalized_at is absent', () => {
    const env = baseEnvelope();
    expect(isEnvelopeFinalized(env)).toBe(false);
  });

  it('3.2 returns true when finalized_at is set AND status is "completed"', () => {
    const env = baseEnvelope({ status: 'completed', finalized_at: new Date().toISOString() });
    expect(isEnvelopeFinalized(env)).toBe(true);
  });
});
