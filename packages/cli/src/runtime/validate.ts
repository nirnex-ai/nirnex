// Stop hook handler.
// Called when Claude thinks it is done with a task.
// Validates the active task envelope against the trace, and blocks completion
// if required conditions are not met.

import fs from 'node:fs';
import path from 'node:path';
import { loadActiveEnvelope, loadTraceEvents, loadHookEvents, appendHookEvent, generateEventId, generateRunId } from './session.js';
import {
  HookStop,
  ValidateDecision,
  HookInvocationStartedEvent,
  ContractViolationDetectedEvent,
  StageCompletedEvent,
  FinalOutcomeDeclaredEvent,
  ReasonCode,
  ReasonCodeValue,
  VerificationStatus,
} from './types.js';

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
  });
}

interface ViolationRecord {
  event: ContractViolationDetectedEvent;
  severity: 'blocking' | 'advisory';
}

export async function runValidate(): Promise<void> {
  const runId = generateRunId();
  const raw = await readStdin();

  let hookData: HookStop = { session_id: 'unknown' };
  try {
    hookData = JSON.parse(raw || '{}') as HookStop;
  } catch {
    // Non-fatal
  }

  const repoRoot = process.env.NIRNEX_REPO_ROOT ?? process.cwd();
  const sessionId = hookData.session_id ?? process.env.NIRNEX_SESSION_ID ?? '';

  // Emit invocation evidence before any early exits
  const invocationEvent: HookInvocationStartedEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: 'none',
    run_id: runId,
    hook_stage: 'validate',
    event_type: 'HookInvocationStarted',
    payload: { stage: 'validate', cwd: process.cwd(), repo_root: repoRoot, pid: process.pid },
  };
  appendHookEvent(repoRoot, sessionId, invocationEvent);

  if (!fs.existsSync(path.join(repoRoot, 'nirnex.config.json'))) {
    const out: ValidateDecision = { decision: 'allow' };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

  const envelope = loadActiveEnvelope(repoRoot, sessionId);

  // No active envelope → nothing to validate
  if (!envelope) {
    process.stdout.write(JSON.stringify({ decision: 'allow' } as ValidateDecision));
    process.exit(0);
  }

  const events = loadTraceEvents(repoRoot, sessionId);
  const hookEvents = loadHookEvents(repoRoot, sessionId);

  // Find the InputEnvelopeCaptured event for this task to read obligation source
  const obligationEvent = hookEvents
    .filter(e => e.event_type === 'InputEnvelopeCaptured' && e.task_id === envelope.task_id)
    .at(-1);
  const verificationSource = (obligationEvent as any)?.payload?.verification_requirement_source ?? 'unknown';
  const mandatoryVerificationRequired = (obligationEvent as any)?.payload?.mandatory_verification_required ?? false;

  const violations: ViolationRecord[] = [];
  const proseReasons: string[] = [];

  function recordViolation(
    reasonCode: ReasonCodeValue,
    violatedContract: string,
    expected: string,
    actual: string,
    severity: 'blocking' | 'advisory',
  ): void {
    const ev: ContractViolationDetectedEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      task_id: envelope!.task_id,
      run_id: runId,
      hook_stage: 'validate',
      event_type: 'ContractViolationDetected',
      status: 'violated',
      payload: {
        reason_code: reasonCode,
        violated_contract: violatedContract,
        expected,
        actual,
        severity,
        blocking_action_taken: severity === 'blocking',
      },
    };
    appendHookEvent(repoRoot, sessionId, ev);
    violations.push({ event: ev, severity });
    proseReasons.push(`[${reasonCode}] ${violatedContract}: expected ${expected}, got ${actual}`);
  }

  // ── Reconciliation checks ──────────────────────────────────────────────

  // If ECO was blocked, Claude should not have proceeded at all
  if (envelope.eco_summary.blocked) {
    recordViolation(
      ReasonCode.ECO_BLOCKED,
      'Task must not proceed when ECO marks it blocked',
      'eco_summary.blocked = false',
      'eco_summary.blocked = true',
      'blocking',
    );
  }

  // If ECO was forced unknown for a non-trivial task, require human verification
  if (envelope.eco_summary.forced_unknown && envelope.lane !== 'A') {
    recordViolation(
      ReasonCode.FORCED_UNKNOWN_NO_VERIFICATION,
      'Lane B/C task with forced_unknown must have human verification before completion',
      'forced_unknown = false OR human verification present',
      `forced_unknown = true, lane = ${envelope.lane}`,
      'blocking',
    );
  }

  // Lane C: require at least one trace event (cannot stop without having done something traceable)
  if (envelope.lane === 'C' && events.length === 0) {
    recordViolation(
      ReasonCode.LANE_C_EMPTY_TRACE,
      'Lane C task must have at least one recorded tool event before completion',
      'trace_event_count > 0',
      'trace_event_count = 0',
      'blocking',
    );
  }

  // Check for unresolved deviations in trace
  const unresolvedDeviations = events
    .flatMap(e => e.deviation_flags)
    .filter(f => f.startsWith('file_in_blocked_path:'));

  if (unresolvedDeviations.length > 0) {
    recordViolation(
      ReasonCode.BLOCKED_PATH_DEVIATION,
      'No file modifications may occur in blocked paths',
      'deviation_flags with file_in_blocked_path: empty',
      unresolvedDeviations.join(', '),
      'blocking',
    );
  }

  // Check deadlock: Lane C with denied patterns triggered but required files unchanged
  if (envelope.lane === 'C') {
    const touchedFiles = new Set(events.flatMap(e => e.affected_files));
    const expectedTouched = envelope.scope.modules_expected;
    if (expectedTouched.length > 0) {
      const anyExpectedTouched = expectedTouched.some(m => [...touchedFiles].some(f => f.includes(m)));
      if (!anyExpectedTouched) {
        recordViolation(
          ReasonCode.LANE_C_DEADLOCK,
          'Lane C task must modify at least one of its expected scope modules',
          `one of [${expectedTouched.join(', ')}] modified`,
          'none of expected modules touched',
          'blocking',
        );
      }
    }
  }

  // Check: mandatory verification required but no verification evidence in trace
  // Fallback: if no obligation event exists, treat source as unknown → advisory, not blocking
  if (mandatoryVerificationRequired) {
    // Look for any Bash tool events that might represent verification commands
    const bashEvents = events.filter(e => e.tool === 'Bash');
    const verificationAttempted = bashEvents.some(e => {
      const cmd = String((e.tool_input as any)?.command ?? '');
      return /\b(test|jest|pytest|vitest|mocha|cargo\s+test|go\s+test|npm\s+test|yarn\s+test|pnpm\s+test|make\s+test)\b/i.test(cmd);
    });

    if (!verificationAttempted) {
      const severity = verificationSource === 'unknown' ? 'advisory' : 'blocking';
      recordViolation(
        ReasonCode.VERIFICATION_REQUIRED_NOT_RUN,
        'Verification was declared mandatory but no verification command was executed',
        `verification command executed (source: ${verificationSource})`,
        'no verification command found in trace',
        severity,
      );
    }
  }

  // Advisory: acceptance criteria present but no evidence of evaluation
  if (envelope.acceptance_criteria.length > 0 && events.length === 0) {
    recordViolation(
      ReasonCode.ACCEPTANCE_NOT_EVALUATED,
      'Acceptance criteria exist but no tool events were recorded to evaluate them',
      `acceptance_criteria evaluated (count: ${envelope.acceptance_criteria.length})`,
      'zero tool events in trace',
      'advisory',
    );
  }

  // ── Derive final verification/acceptance status ────────────────────────

  let verificationStatus: VerificationStatus;
  if (!mandatoryVerificationRequired && verificationSource === 'none') {
    verificationStatus = 'not_requested';
  } else if (violations.some(v => v.event.payload.reason_code === ReasonCode.VERIFICATION_REQUIRED_NOT_RUN)) {
    verificationStatus = 'skipped';
  } else if (mandatoryVerificationRequired) {
    // Verification was attempted — classify by exit code if available, else unknown
    const bashEvents = events.filter(e => e.tool === 'Bash');
    const verificationBash = bashEvents.find(e => {
      const cmd = String((e.tool_input as any)?.command ?? '');
      return /\b(test|jest|pytest|vitest|mocha|cargo\s+test|go\s+test|npm\s+test|yarn\s+test|pnpm\s+test|make\s+test)\b/i.test(cmd);
    });
    if (verificationBash) {
      const exitCode = (verificationBash.tool_result as any)?.exit_code;
      if (exitCode === 0) verificationStatus = 'pass';
      else if (typeof exitCode === 'number') verificationStatus = 'fail';
      else verificationStatus = 'unknown';
    } else {
      verificationStatus = 'unknown';
    }
  } else {
    verificationStatus = 'not_requested';
  }

  const acceptanceStatus: VerificationStatus =
    envelope.acceptance_criteria.length === 0
      ? 'not_requested'
      : violations.some(v => v.event.payload.reason_code === ReasonCode.ACCEPTANCE_NOT_EVALUATED)
        ? 'skipped'
        : events.length > 0
          ? 'unknown'   // events ran but we cannot auto-verify AC satisfaction without explicit checks
          : 'skipped';

  // ── Decision: blocking violations → block; advisory only → allow ──────

  const blockingViolations = violations.filter(v => v.severity === 'blocking');
  const advisoryViolations = violations.filter(v => v.severity === 'advisory');
  const decision: 'allow' | 'block' = blockingViolations.length > 0 ? 'block' : 'allow';

  // ── Emit FinalOutcomeDeclared before any process.exit ─────────────────

  const finalEvent: FinalOutcomeDeclaredEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: envelope.task_id,
    run_id: runId,
    hook_stage: 'validate',
    event_type: 'FinalOutcomeDeclared',
    payload: {
      decision,
      violation_count: violations.length,
      blocking_violation_count: blockingViolations.length,
      advisory_violation_count: advisoryViolations.length,
      reason_codes: violations.map(v => v.event.payload.reason_code),
      verification_status: verificationStatus,
      acceptance_status: acceptanceStatus,
      envelope_status: envelope.status,
    },
  };
  appendHookEvent(repoRoot, sessionId, finalEvent);

  const stageEvent: StageCompletedEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: envelope.task_id,
    run_id: runId,
    hook_stage: 'validate',
    event_type: 'StageCompleted',
    status: decision === 'allow' ? 'pass' : 'fail',
    payload: {
      stage: 'validate',
      blocker_count: blockingViolations.length,
      violation_count: violations.length,
    },
  };
  appendHookEvent(repoRoot, sessionId, stageEvent);

  // ── Output decision ───────────────────────────────────────────────────

  if (decision === 'block') {
    const out: ValidateDecision = {
      decision: 'block',
      reason: `[Nirnex Validate] ${proseReasons.join(' | ')}`,
    };
    process.stdout.write(JSON.stringify(out));
  } else {
    // Mark envelope as completed
    try {
      envelope.status = 'completed';
      const { saveEnvelope } = await import('./session.js');
      saveEnvelope(repoRoot, envelope);
    } catch {
      // Non-fatal
    }
    process.stdout.write(JSON.stringify({ decision: 'allow' } as ValidateDecision));
  }

  process.exit(0);
}
