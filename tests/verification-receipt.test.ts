/**
 * Verification Receipt — Deterministic Governance Tests
 *
 * Tests the canonical VerificationReceipt model introduced to fix false
 * VERIFICATION_REQUIRED_NOT_RUN outcomes.
 *
 * Root-cause context:
 *   The trace hook writes task events to events.jsonl with task_id taken from
 *   loadActiveEnvelope(). When the envelope is not loaded (any edge case: wrong
 *   session_id, stale active_task_id, race), all events get task_id='none'.
 *   validate.ts filters events by task_id — so evidence with task_id='none' is
 *   invisible and VERIFICATION_REQUIRED_NOT_RUN fires even though the command ran.
 *
 *   The VerificationReceipt is written to a separate task-scoped file at capture
 *   time, bypassing the task_id binding problem. validate.ts reads the receipt
 *   first; the trace event search is the backward-compat fallback.
 *
 * Test organisation:
 *   U — Unit tests for session helpers (pure, no child processes)
 *   I — Integration tests via CLI spawn (require built dist)
 *
 * Coverage required by the fix specification:
 *   I1  mandatory verification executed → receipt written → allow
 *   I2  verification executed + exit non-zero → COMMAND_EXIT_NONZERO block
 *   I3  verification genuinely not run → VERIFICATION_REQUIRED_NOT_RUN with diagnostics
 *   I4  verification run + no edits after → allow (no POST_VERIFICATION_EDIT)
 *   I5  edits after verification → POST_VERIFICATION_EDIT block
 *   I6  repeated validate on finalized task → no second terminal outcome (idempotent)
 *   I7  same scenario repeated → identical outcome (determinism)
 *   I8  task_id binding failure fingerprint: orphan bash events named in diagnostics
 *   I9  no verification requested → allow with verification_status=not_requested
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import {
  saveVerificationReceipt,
  loadVerificationReceipt,
  saveEnvelope,
  createSession,
  saveSession,
  appendHookEvent,
  appendTraceEvent,
  generateEventId,
  generateRunId,
  loadHookEvents,
} from '../packages/cli/src/runtime/session.js';

import type {
  TaskEnvelope,
  VerificationReceipt,
  TraceEvent,
  InputEnvelopeCapturedEvent,
  FinalOutcomeDeclaredEvent,
  ContractViolationDetectedEvent,
} from '../packages/cli/src/runtime/types.js';

import { ReasonCode } from '../packages/cli/src/runtime/types.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const CLI_PATH = path.resolve(import.meta.dirname, '../packages/cli/dist/index.js');

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nirnex-vr-'));
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs.length = 0;
});

function makeProject(): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'nirnex.config.json'),
    JSON.stringify({ project: 'test' }),
    'utf8',
  );
  return dir;
}

function makeEnvelope(
  repoRoot: string,
  sessionId: string,
  overrides: Partial<TaskEnvelope> = {},
): TaskEnvelope {
  const taskId = `task_vr_${randomUUID().slice(0, 8)}`;
  const envelope: TaskEnvelope = {
    task_id:     taskId,
    session_id:  sessionId,
    created_at:  new Date().toISOString(),
    prompt:      'Update the app and run npm run lint to verify',
    lane:        'A',
    scope:       { allowed_paths: [], blocked_paths: [], modules_expected: [] },
    constraints: [],
    acceptance_criteria: [],
    tool_policy: { allowed_tools: [], requires_guard: [], denied_patterns: [] },
    stop_conditions: { required_validations: [], forbidden_files: [] },
    confidence:  { score: 80, label: 'high', penalties: [] },
    eco_summary: {
      intent: 'update', recommended_lane: 'A', forced_unknown: false,
      blocked: false, escalation_reasons: [], boundary_warnings: [],
    },
    status: 'active',
    ...overrides,
  };
  saveEnvelope(repoRoot, envelope);
  return envelope;
}

function makeSession(repoRoot: string, sessionId: string, taskId: string): void {
  const s = createSession(repoRoot, sessionId);
  s.active_task_id = taskId;
  s.tasks = [taskId];
  saveSession(repoRoot, s);
}

function writeObligationEvent(
  repoRoot: string,
  sessionId: string,
  taskId: string,
  opts: {
    mandatory: boolean;
    commands?: string[];
    source?: 'explicit_user_instruction' | 'none';
  },
): void {
  const ev: InputEnvelopeCapturedEvent = {
    event_id:   generateEventId(),
    timestamp:  new Date().toISOString(),
    session_id: sessionId,
    task_id:    taskId,
    run_id:     generateRunId(),
    hook_stage: 'entry',
    event_type: 'InputEnvelopeCaptured',
    payload: {
      task_id:                         taskId,
      lane:                            'A',
      blocked:                         false,
      forced_unknown:                  false,
      acceptance_criteria_count:       0,
      constraints_count:               0,
      verification_commands_detected:  opts.mandatory,
      verification_commands:           opts.commands ?? (opts.mandatory ? ['npm run lint'] : []),
      mandatory_verification_required: opts.mandatory,
      verification_requirement_source: opts.source ?? (opts.mandatory ? 'explicit_user_instruction' : 'none'),
    },
  };
  appendHookEvent(repoRoot, sessionId, ev);
}

function makeReceipt(overrides: Partial<VerificationReceipt> = {}): VerificationReceipt {
  const cmd = overrides.command ?? 'npm run lint';
  return {
    receipt_id:         `evt_receipt_${randomUUID().slice(0, 8)}`,
    session_id:         overrides.session_id ?? 'sess_test',
    task_id:            overrides.task_id ?? 'task_test',
    run_id:             overrides.run_id ?? generateRunId(),
    command:            cmd,
    normalized_command: cmd.trim(),
    command_hash:       createHash('sha256').update(cmd).digest('hex'),
    started_at:         null,
    finished_at:        new Date().toISOString(),
    exit_code:          overrides.exit_code !== undefined ? overrides.exit_code : 0,
    status:             overrides.status ?? 'pass',
    source_stage:       'trace-hook',
    captured_at:        new Date().toISOString(),
    ...overrides,
  };
}

function writeTraceEvent(repoRoot: string, sessionId: string, event: TraceEvent): void {
  appendTraceEvent(repoRoot, sessionId, event);
}

function invokeValidate(dir: string, sessionId: string): {
  decision: string;
  reason?: string;
  stdout: string;
  stderr: string;
} {
  const payload = JSON.stringify({ session_id: sessionId });
  const result = spawnSync('node', [CLI_PATH, 'runtime', 'validate'], {
    input:    payload,
    encoding: 'utf8',
    env:      { ...process.env, NIRNEX_REPO_ROOT: dir, NIRNEX_SESSION_ID: sessionId },
    timeout:  10_000,
  });
  let parsed: { decision: string; reason?: string } = { decision: 'allow' };
  try { parsed = JSON.parse(result.stdout || '{"decision":"allow"}'); } catch { /* ignore */ }
  return { ...parsed, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ─── U: Unit tests for saveVerificationReceipt / loadVerificationReceipt ─────

describe('U1 — saveVerificationReceipt / loadVerificationReceipt round-trip', () => {
  it('U1.1 saves and loads a receipt with all required fields', () => {
    const dir = makeProject();
    const taskId = 'task_u1';
    const receipt = makeReceipt({ task_id: taskId, session_id: 'sess_u1' });

    saveVerificationReceipt(dir, receipt);
    const loaded = loadVerificationReceipt(dir, taskId);

    expect(loaded).not.toBeNull();
    expect(loaded!.receipt_id).toBe(receipt.receipt_id);
    expect(loaded!.task_id).toBe(taskId);
    expect(loaded!.command).toBe('npm run lint');
    expect(loaded!.exit_code).toBe(0);
    expect(loaded!.status).toBe('pass');
    expect(loaded!.source_stage).toBe('trace-hook');
    expect(loaded!.command_hash).toBe(
      createHash('sha256').update('npm run lint').digest('hex'),
    );
  });

  it('U1.2 loadVerificationReceipt returns null when no receipt exists', () => {
    const dir = makeProject();
    expect(loadVerificationReceipt(dir, 'task_nonexistent')).toBeNull();
  });

  it('U1.3 receipt is scoped to task_id — different tasks have independent receipts', () => {
    const dir = makeProject();
    const r1 = makeReceipt({ task_id: 'task_a', command: 'npm run lint', exit_code: 0, status: 'pass' });
    const r2 = makeReceipt({ task_id: 'task_b', command: 'npm test',     exit_code: 1, status: 'fail' });

    saveVerificationReceipt(dir, r1);
    saveVerificationReceipt(dir, r2);

    const loaded1 = loadVerificationReceipt(dir, 'task_a');
    const loaded2 = loadVerificationReceipt(dir, 'task_b');

    expect(loaded1!.exit_code).toBe(0);
    expect(loaded2!.exit_code).toBe(1);
  });
});

describe('U2 — Zero-Trust Rule 4: saveVerificationReceipt preserves first receipt', () => {
  it('U2.1 second write for the same task_id is a no-op', () => {
    const dir = makeProject();
    const taskId = 'task_rule4';
    const first  = makeReceipt({ task_id: taskId, exit_code: 0, status: 'pass',  receipt_id: 'id_first' });
    const second = makeReceipt({ task_id: taskId, exit_code: 1, status: 'fail', receipt_id: 'id_second' });

    saveVerificationReceipt(dir, first);
    saveVerificationReceipt(dir, second);  // must be no-op

    const loaded = loadVerificationReceipt(dir, taskId);
    expect(loaded!.receipt_id).toBe('id_first');
    expect(loaded!.exit_code).toBe(0);
    expect(loaded!.status).toBe('pass');
  });

  it('U2.2 third write is also a no-op', () => {
    const dir = makeProject();
    const taskId = 'task_rule4b';
    for (let i = 0; i < 3; i++) {
      saveVerificationReceipt(dir, makeReceipt({ task_id: taskId, receipt_id: `id_${i}`, exit_code: i }));
    }
    const loaded = loadVerificationReceipt(dir, taskId);
    expect(loaded!.receipt_id).toBe('id_0');
    expect(loaded!.exit_code).toBe(0);
  });
});

describe('U3 — VerificationReceipt fields', () => {
  it('U3.1 status=pass when exit_code=0', () => {
    const dir = makeProject();
    const r = makeReceipt({ task_id: 'task_u3a', exit_code: 0, status: 'pass' });
    saveVerificationReceipt(dir, r);
    expect(loadVerificationReceipt(dir, 'task_u3a')!.status).toBe('pass');
  });

  it('U3.2 status=fail when exit_code=1', () => {
    const dir = makeProject();
    const r = makeReceipt({ task_id: 'task_u3b', exit_code: 1, status: 'fail' });
    saveVerificationReceipt(dir, r);
    expect(loadVerificationReceipt(dir, 'task_u3b')!.status).toBe('fail');
  });

  it('U3.3 status=unknown when exit_code=null', () => {
    const dir = makeProject();
    const r = makeReceipt({ task_id: 'task_u3c', exit_code: null, status: 'unknown' });
    saveVerificationReceipt(dir, r);
    expect(loadVerificationReceipt(dir, 'task_u3c')!.status).toBe('unknown');
  });

  it('U3.4 started_at is null (PostToolUse has no command start time)', () => {
    const dir = makeProject();
    const r = makeReceipt({ task_id: 'task_u3d' });
    saveVerificationReceipt(dir, r);
    expect(loadVerificationReceipt(dir, 'task_u3d')!.started_at).toBeNull();
  });

  it('U3.5 source_stage is always trace-hook', () => {
    const dir = makeProject();
    const r = makeReceipt({ task_id: 'task_u3e' });
    saveVerificationReceipt(dir, r);
    expect(loadVerificationReceipt(dir, 'task_u3e')!.source_stage).toBe('trace-hook');
  });
});

// ─── I: Integration tests via CLI spawn ──────────────────────────────────────

describe('I1 — mandatory verification executed → receipt written → allow', () => {
  it('I1.1 validate allows when a passing receipt exists for the active task', () => {
    const dir       = makeProject();
    const sessionId = `sess_i1_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, { mandatory: true });

    // Write a passing receipt (simulating what trace hook writes after npm run lint exit=0)
    const receipt = makeReceipt({
      task_id:    envelope.task_id,
      session_id: sessionId,
      exit_code:  0,
      status:     'pass',
      finished_at: new Date(Date.now() - 1000).toISOString(),
    });
    saveVerificationReceipt(dir, receipt);

    // Also write a trace event so evidence integrity checks pass
    const ts = new Date(Date.now() - 2000).toISOString();
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: ts,
      tool: 'Bash',
      tool_input: { command: 'npm run lint' },
      tool_result: { exit_code: 0 },
      affected_files: [], deviation_flags: [],
      attestation: {
        command_hash: receipt.command_hash, exit_code: 0,
        captured_by: 'trace-hook', verified: true,
        capture_timestamp: receipt.finished_at,
      },
    });

    const out = invokeValidate(dir, sessionId);
    expect(out.decision).toBe('allow');

    // Hook log must show FinalOutcomeDeclared allow with verify=pass
    const hookEvents = loadHookEvents(dir, sessionId);
    const finalEvent = hookEvents.find(e => e.event_type === 'FinalOutcomeDeclared') as FinalOutcomeDeclaredEvent | undefined;
    expect(finalEvent).toBeDefined();
    expect(finalEvent!.payload.decision).toBe('allow');
    expect(finalEvent!.payload.verification_status).toBe('pass');
    expect(finalEvent!.payload.blocking_violation_count).toBe(0);
  });
});

describe('I2 — verification executed + exit non-zero → COMMAND_EXIT_NONZERO block', () => {
  it('I2.1 validate blocks with COMMAND_EXIT_NONZERO when receipt.exit_code=1', () => {
    const dir       = makeProject();
    const sessionId = `sess_i2_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, { mandatory: true });

    const receipt = makeReceipt({
      task_id: envelope.task_id, session_id: sessionId,
      exit_code: 1, status: 'fail',
      finished_at: new Date().toISOString(),
    });
    saveVerificationReceipt(dir, receipt);

    // Write the matching trace event
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: new Date(Date.now() - 500).toISOString(),
      tool: 'Bash', tool_input: { command: 'npm run lint' },
      tool_result: { exit_code: 1 }, affected_files: [], deviation_flags: [],
      attestation: {
        command_hash: receipt.command_hash, exit_code: 1,
        captured_by: 'trace-hook', verified: true,
        capture_timestamp: receipt.finished_at,
      },
    });

    const out = invokeValidate(dir, sessionId);
    expect(out.decision).toBe('block');

    const hookEvents = loadHookEvents(dir, sessionId);
    const violations = hookEvents.filter(
      e => e.event_type === 'ContractViolationDetected',
    ) as ContractViolationDetectedEvent[];
    const nonzero = violations.find(
      v => v.payload.reason_code === ReasonCode.COMMAND_EXIT_NONZERO,
    );
    expect(nonzero).toBeDefined();
    expect(nonzero!.payload.severity).toBe('blocking');
    expect(nonzero!.payload.actual).toContain('exit_code = 1');
    expect(nonzero!.payload.actual).toContain('receipt_id=');
  });
});

describe('I3 — verification genuinely not run → VERIFICATION_REQUIRED_NOT_RUN with diagnostics', () => {
  it('I3.1 blocks with structured diagnostic when no receipt and no bash verification event', () => {
    const dir       = makeProject();
    const sessionId = `sess_i3_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, {
      mandatory: true, commands: ['npm run lint'],
    });

    // Write an unrelated trace event (edit only, no bash)
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: new Date().toISOString(),
      tool: 'Edit', tool_input: { file_path: 'src/foo.ts' },
      affected_files: ['src/foo.ts'], deviation_flags: [],
    });

    const out = invokeValidate(dir, sessionId);
    expect(out.decision).toBe('block');

    const hookEvents = loadHookEvents(dir, sessionId);
    const violations = hookEvents.filter(
      e => e.event_type === 'ContractViolationDetected',
    ) as ContractViolationDetectedEvent[];
    const vrViolation = violations.find(
      v => v.payload.reason_code === ReasonCode.VERIFICATION_REQUIRED_NOT_RUN,
    );
    expect(vrViolation).toBeDefined();
    expect(vrViolation!.payload.severity).toBe('blocking');

    // Structured diagnostic: must include machine-readable detail
    const actual = vrViolation!.payload.actual;
    expect(actual).toContain('no_receipt');
    expect(actual).toContain('bash_events_for_task=0');
    expect(actual).toContain('stored_commands=[npm run lint]');
  });

  it('I3.2 diagnostic includes orphan count when bash events have task_id=none', () => {
    const dir       = makeProject();
    const sessionId = `sess_i3b_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, {
      mandatory: true, commands: ['npm run lint'],
    });

    // Simulate a trace event with task_id='none' (task_id binding failure):
    // the verification command ran but loadActiveEnvelope returned null in the trace hook.
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: 'none',  // <-- binding failure
      timestamp: new Date().toISOString(),
      tool: 'Bash', tool_input: { command: 'npm run lint' },
      tool_result: { exit_code: 0 }, affected_files: [], deviation_flags: [],
    });

    const out = invokeValidate(dir, sessionId);
    expect(out.decision).toBe('block');

    const hookEvents = loadHookEvents(dir, sessionId);
    const violations = hookEvents.filter(
      e => e.event_type === 'ContractViolationDetected',
    ) as ContractViolationDetectedEvent[];
    const vrViolation = violations.find(
      v => v.payload.reason_code === ReasonCode.VERIFICATION_REQUIRED_NOT_RUN,
    );
    expect(vrViolation).toBeDefined();
    const actual = vrViolation!.payload.actual;
    // Must identify the orphan bash events and suspect task_id binding failure
    expect(actual).toContain('bash_events_task_id_none=1');
    expect(actual).toContain('task_id_binding_failure_suspected');
  });
});

describe('I4 — verification run + no edits after → allow (Rule 3 not triggered)', () => {
  it('I4.1 allow when all edits precede the receipt.finished_at boundary', () => {
    const dir       = makeProject();
    const sessionId = `sess_i4_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, { mandatory: true });

    const editTs   = new Date(Date.now() - 3000).toISOString();
    const lintTs   = new Date(Date.now() - 1000).toISOString();

    // Edit happened BEFORE verification
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: editTs,
      tool: 'Edit', tool_input: { file_path: 'src/app.ts' },
      affected_files: ['src/app.ts'], deviation_flags: [],
    });

    // Verification happened AFTER edit
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: lintTs,
      tool: 'Bash', tool_input: { command: 'npm run lint' },
      tool_result: { exit_code: 0 }, affected_files: [], deviation_flags: [],
      attestation: {
        command_hash: createHash('sha256').update('npm run lint').digest('hex'),
        exit_code: 0, captured_by: 'trace-hook', verified: true,
        capture_timestamp: lintTs,
      },
    });

    const receipt = makeReceipt({
      task_id:    envelope.task_id,
      session_id: sessionId,
      exit_code:  0,
      status:     'pass',
      finished_at: lintTs,
    });
    saveVerificationReceipt(dir, receipt);

    const out = invokeValidate(dir, sessionId);
    expect(out.decision).toBe('allow');

    const hookEvents = loadHookEvents(dir, sessionId);
    const postEditViolations = (hookEvents.filter(
      e => e.event_type === 'ContractViolationDetected',
    ) as ContractViolationDetectedEvent[]).filter(
      v => v.payload.reason_code === ReasonCode.POST_VERIFICATION_EDIT,
    );
    expect(postEditViolations).toHaveLength(0);
  });
});

describe('I5 — edits after verification → POST_VERIFICATION_EDIT block', () => {
  it('I5.1 block with POST_VERIFICATION_EDIT when trace event has timestamp after receipt.finished_at', () => {
    const dir       = makeProject();
    const sessionId = `sess_i5_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, { mandatory: true });

    const lintTs   = new Date(Date.now() - 2000).toISOString();
    const postEdit = new Date(Date.now() - 500).toISOString();

    // Verification trace event
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: lintTs,
      tool: 'Bash', tool_input: { command: 'npm run lint' },
      tool_result: { exit_code: 0 }, affected_files: [], deviation_flags: [],
      attestation: {
        command_hash: createHash('sha256').update('npm run lint').digest('hex'),
        exit_code: 0, captured_by: 'trace-hook', verified: true,
        capture_timestamp: lintTs,
      },
    });

    // Edit AFTER verification
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: postEdit,
      tool: 'Edit', tool_input: { file_path: 'src/foo.ts' },
      affected_files: ['src/foo.ts'], deviation_flags: [],
    });

    const receipt = makeReceipt({
      task_id:    envelope.task_id,
      session_id: sessionId,
      exit_code:  0,
      status:     'pass',
      finished_at: lintTs,
    });
    saveVerificationReceipt(dir, receipt);

    const out = invokeValidate(dir, sessionId);
    expect(out.decision).toBe('block');

    const hookEvents = loadHookEvents(dir, sessionId);
    const postEditViolations = (hookEvents.filter(
      e => e.event_type === 'ContractViolationDetected',
    ) as ContractViolationDetectedEvent[]).filter(
      v => v.payload.reason_code === ReasonCode.POST_VERIFICATION_EDIT,
    );
    expect(postEditViolations.length).toBeGreaterThanOrEqual(1);
    expect(postEditViolations[0].payload.actual).toContain('src/foo.ts');
  });
});

describe('I6 — repeated validate on finalized task → no second terminal outcome', () => {
  it('I6.1 second validate invocation on a completed task returns allow without new FinalOutcomeDeclared', () => {
    const dir       = makeProject();
    const sessionId = `sess_i6_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, { mandatory: true });

    const receipt = makeReceipt({
      task_id: envelope.task_id, session_id: sessionId,
      exit_code: 0, status: 'pass', finished_at: new Date(Date.now() - 1000).toISOString(),
    });
    saveVerificationReceipt(dir, receipt);

    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: new Date(Date.now() - 500).toISOString(),
      tool: 'Bash', tool_input: { command: 'npm run lint' },
      tool_result: { exit_code: 0 }, affected_files: [], deviation_flags: [],
      attestation: {
        command_hash: receipt.command_hash, exit_code: 0,
        captured_by: 'trace-hook', verified: true,
        capture_timestamp: receipt.finished_at,
      },
    });

    // First invocation — should allow
    const out1 = invokeValidate(dir, sessionId);
    expect(out1.decision).toBe('allow');

    const eventsBefore = loadHookEvents(dir, sessionId);
    const finalsBefore = eventsBefore.filter(e => e.event_type === 'FinalOutcomeDeclared');
    expect(finalsBefore).toHaveLength(1);

    // Second invocation — must be a no-op; G3 idempotency guard must fire
    const out2 = invokeValidate(dir, sessionId);
    expect(out2.decision).toBe('allow');  // G3 returns allow for completed tasks

    const eventsAfter = loadHookEvents(dir, sessionId);
    const finalsAfter = eventsAfter.filter(e => e.event_type === 'FinalOutcomeDeclared');
    // G3 does NOT emit another FinalOutcomeDeclared — the original is the only one
    expect(finalsAfter).toHaveLength(1);

    // G3 emits TASK_ALREADY_FINALIZED advisory
    const advisories = (eventsAfter.filter(
      e => e.event_type === 'ContractViolationDetected',
    ) as ContractViolationDetectedEvent[]).filter(
      v => v.payload.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0].payload.severity).toBe('advisory');
  });

  it('I6.2 third validate invocation on a completed task emits no additional TASK_ALREADY_FINALIZED', () => {
    const dir       = makeProject();
    const sessionId = `sess_i6b_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, { mandatory: true });

    const receipt = makeReceipt({
      task_id: envelope.task_id, session_id: sessionId,
      exit_code: 0, status: 'pass', finished_at: new Date(Date.now() - 1000).toISOString(),
    });
    saveVerificationReceipt(dir, receipt);

    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: new Date(Date.now() - 500).toISOString(),
      tool: 'Bash', tool_input: { command: 'npm run lint' },
      tool_result: { exit_code: 0 }, affected_files: [], deviation_flags: [],
      attestation: {
        command_hash: receipt.command_hash, exit_code: 0,
        captured_by: 'trace-hook', verified: true,
        capture_timestamp: receipt.finished_at,
      },
    });

    invokeValidate(dir, sessionId);  // first — allow
    invokeValidate(dir, sessionId);  // second — TASK_ALREADY_FINALIZED advisory
    invokeValidate(dir, sessionId);  // third — silent no-op

    const eventsAfter = loadHookEvents(dir, sessionId);
    const advisories = (eventsAfter.filter(
      e => e.event_type === 'ContractViolationDetected',
    ) as ContractViolationDetectedEvent[]).filter(
      v => v.payload.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );
    // Advisory emitted exactly once (first re-invocation only)
    expect(advisories).toHaveLength(1);
  });
});

describe('I7 — same scenario repeated → identical outcome (determinism)', () => {
  function runScenario(cmd: string, exitCode: number): string {
    const dir       = makeProject();
    const sessionId = `sess_i7_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, {
      mandatory: true, commands: [cmd],
    });

    const lintTs = new Date(Date.now() - 500).toISOString();
    const receipt = makeReceipt({
      task_id: envelope.task_id, session_id: sessionId,
      command: cmd, exit_code: exitCode,
      status: exitCode === 0 ? 'pass' : 'fail',
      finished_at: lintTs,
    });
    saveVerificationReceipt(dir, receipt);

    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: lintTs,
      tool: 'Bash', tool_input: { command: cmd },
      tool_result: { exit_code: exitCode }, affected_files: [], deviation_flags: [],
      attestation: {
        command_hash: receipt.command_hash, exit_code: exitCode,
        captured_by: 'trace-hook', verified: true,
        capture_timestamp: lintTs,
      },
    });

    return invokeValidate(dir, sessionId).decision;
  }

  it('I7.1 same passing scenario always yields allow', () => {
    const decisions = Array.from({ length: 3 }, () => runScenario('npm run lint', 0));
    expect(decisions.every(d => d === 'allow')).toBe(true);
  });

  it('I7.2 same failing scenario always yields block', () => {
    const decisions = Array.from({ length: 3 }, () => runScenario('npm run lint', 1));
    expect(decisions.every(d => d === 'block')).toBe(true);
  });
});

describe('I8 — task_id binding failure fingerprint in diagnostics', () => {
  it('I8.1 suspicion flag appears when verification candidate has task_id=none but no receipt', () => {
    const dir       = makeProject();
    const sessionId = `sess_i8_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, {
      mandatory: true, commands: ['npm run lint'],
    });

    // Verification command ran but ended up with task_id='none'
    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: 'none',
      timestamp: new Date().toISOString(),
      tool: 'Bash', tool_input: { command: 'npm run lint' },
      tool_result: { exit_code: 0 }, affected_files: [], deviation_flags: [],
    });
    // No receipt was written (trace hook couldn't scope it)

    const out = invokeValidate(dir, sessionId);
    expect(out.decision).toBe('block');  // still blocks — receipt required for allow

    const hookEvents = loadHookEvents(dir, sessionId);
    const vr = (hookEvents.filter(
      e => e.event_type === 'ContractViolationDetected',
    ) as ContractViolationDetectedEvent[]).find(
      v => v.payload.reason_code === ReasonCode.VERIFICATION_REQUIRED_NOT_RUN,
    );
    expect(vr).toBeDefined();
    expect(vr!.payload.actual).toContain('task_id_binding_failure_suspected');
    expect(vr!.payload.actual).toContain('bash_events_task_id_none=1');
  });
});

describe('I9 — no verification requested → allow with verification_status=not_requested', () => {
  it('I9.1 task with no mandatory verification allows without any verification check', () => {
    const dir       = makeProject();
    const sessionId = `sess_i9_${randomUUID().slice(0, 8)}`;
    const envelope  = makeEnvelope(dir, sessionId);
    makeSession(dir, sessionId, envelope.task_id);
    writeObligationEvent(dir, sessionId, envelope.task_id, {
      mandatory: false, source: 'none',
    });

    writeTraceEvent(dir, sessionId, {
      event_id: generateEventId(), session_id: sessionId,
      task_id: envelope.task_id, timestamp: new Date().toISOString(),
      tool: 'Edit', tool_input: { file_path: 'src/foo.ts' },
      affected_files: ['src/foo.ts'], deviation_flags: [],
    });

    const out = invokeValidate(dir, sessionId);
    expect(out.decision).toBe('allow');

    const hookEvents = loadHookEvents(dir, sessionId);
    const finalEvent = hookEvents.find(e => e.event_type === 'FinalOutcomeDeclared') as FinalOutcomeDeclaredEvent | undefined;
    expect(finalEvent?.payload.verification_status).toBe('not_requested');
    expect(finalEvent?.payload.blocking_violation_count).toBe(0);
  });
});
