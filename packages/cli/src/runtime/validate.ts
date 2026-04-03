// Stop hook handler.
// Called when Claude thinks it is done with a task.
// Validates the active task envelope against the trace, and blocks completion
// if required conditions are not met.

import fs from 'node:fs';
import path from 'node:path';
import { loadActiveEnvelope, loadTraceEvents, loadHookEvents, loadHookWriteFailures, appendHookEvent, generateEventId, generateRunId, isEnvelopeFinalized } from './session.js';
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
import { extractExitCode } from './exit-code.js';
import { evaluateZeroTrustRules } from './attestation.js';

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

  // Helper: emit a minimal FinalOutcomeDeclared for early-exit paths so the hook-log
  // is never left with an orphaned HookInvocationStarted.
  function emitEarlyAllow(reason: string): void {
    const ev: FinalOutcomeDeclaredEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      task_id: 'none',
      run_id: runId,
      hook_stage: 'validate',
      event_type: 'FinalOutcomeDeclared',
      payload: {
        decision: 'allow',
        violation_count: 0,
        blocking_violation_count: 0,
        advisory_violation_count: 0,
        reason_codes: [],
        verification_status: 'not_requested' as VerificationStatus,
        acceptance_status: 'not_requested' as VerificationStatus,
        envelope_status: reason,
      },
    };
    appendHookEvent(repoRoot, sessionId, ev);
    process.stdout.write(JSON.stringify({ decision: 'allow' } as ValidateDecision));
  }

  if (!fs.existsSync(path.join(repoRoot, 'nirnex.config.json'))) {
    emitEarlyAllow('nirnex_not_configured');
    process.exit(0);
  }

  const envelope = loadActiveEnvelope(repoRoot, sessionId);

  // No active envelope → nothing to validate
  if (!envelope) {
    emitEarlyAllow('no_active_envelope');
    process.exit(0);
  }

  // ── G3: Idempotency guard ───────────────────────────────────────────────────
  // If the envelope already has a finalized_at timestamp, the Stop hook is being
  // re-invoked (e.g. rapid double-submit, Claude Code retry, or transient
  // process restart). Re-running full validation would produce duplicate ledger
  // entries, redundant hook events, and false violation counts.
  //
  // Emit a single advisory event so the re-invocation is auditable, then exit
  // cleanly with decision='allow'. The original outcome is already recorded.
  if (isEnvelopeFinalized(envelope)) {
    const dupEvent: ContractViolationDetectedEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      task_id: envelope.task_id,
      run_id: runId,
      hook_stage: 'validate',
      event_type: 'ContractViolationDetected',
      status: 'violated',
      payload: {
        reason_code: ReasonCode.TASK_ALREADY_FINALIZED,
        violated_contract: 'Stop hook must produce exactly one terminal outcome per task_id',
        expected: `single outcome for task_id=${envelope.task_id}`,
        actual: `task already finalized at ${envelope.finalized_at}; duplicate invocation suppressed`,
        severity: 'advisory',
        blocking_action_taken: false,
      },
    };
    appendHookEvent(repoRoot, sessionId, dupEvent);
    process.stdout.write(JSON.stringify({ decision: 'allow' } as ValidateDecision));
    process.exit(0);
  }

  const events = loadTraceEvents(repoRoot, sessionId);
  const hookEvents = loadHookEvents(repoRoot, sessionId);

  // G2: Load write-failure count from the G1 sidecar so reconcileStores() can
  // detect incomplete JSONL audit trails before the governance decision is made.
  const hookWriteFailureCount = loadHookWriteFailures(repoRoot, sessionId).length;

  // Find the InputEnvelopeCaptured event for this task to read obligation source
  const obligationEvent = hookEvents
    .filter(e => e.event_type === 'InputEnvelopeCaptured' && e.task_id === envelope.task_id)
    .at(-1);
  const verificationSource = (obligationEvent as any)?.payload?.verification_requirement_source ?? 'unknown';
  const mandatoryVerificationRequired = (obligationEvent as any)?.payload?.mandatory_verification_required ?? false;
  // Commands explicitly extracted at entry time (e.g. ["npm run lint"]) — used for precise matching below
  const storedVerificationCommands: string[] = (obligationEvent as any)?.payload?.verification_commands ?? [];

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

  // Status variables declared here so the catch block can assign safe defaults
  // if anything in the reconciliation or status-derivation section throws.
  let verificationStatus: VerificationStatus = 'unknown';
  let acceptanceStatus: VerificationStatus = 'unknown';

  // G2: cross-store reconciliation result — populated inside the try block.
  // undefined until reconcileStores() runs; the Ledger payload embeds it so
  // every run_outcome_summary is self-describing about store consistency.
  let storeReconciliationResult: import('@nirnex/core/dist/runtime/store-hierarchy.js').StoreReconciliationResult | undefined;

  try {

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
      // First: match against the explicit commands captured at entry time (highest fidelity)
      if (storedVerificationCommands.length > 0 && storedVerificationCommands.some(vc => cmd.includes(vc))) return true;
      // Fallback: broad heuristic covering test and script runner invocations
      return /\b(test|jest|pytest|vitest|mocha|cargo\s+test|go\s+test|npm\s+test|yarn\s+test|pnpm\s+test|make\s+test|npm\s+run|yarn\s+run|pnpm\s+run)\b/i.test(cmd);
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
    } else {
      // Zero-Trust rules 2, 3, 4 — delegated to the pure enforcement engine.
      // Rule 4: uses FIRST verification event (not last).
      // Rule 2: null exit code → COMMAND_EXIT_UNKNOWN (blocking).
      // Rule 3: edits after verification → POST_VERIFICATION_EDIT (blocking).
      const ztViolations = evaluateZeroTrustRules(events, true, storedVerificationCommands);
      for (const ztv of ztViolations) {
        recordViolation(
          ReasonCode[ztv.reason_code],
          ztv.detail,
          ztv.reason_code === 'COMMAND_EXIT_NONZERO' ? 'exit_code = 0' :
          ztv.reason_code === 'COMMAND_EXIT_UNKNOWN' ? 'exit_code = 0 (deterministic)' :
          'no file modifications after verification',
          ztv.observed,   // machine-observed value, not prose — visible in hook-log actual column
          'blocking',
        );
      }
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

  // ── G2: Cross-store reconciliation ────────────────────────────────────────
  // Validate that Envelope, JSONL, and Ledger are mutually consistent BEFORE
  // the governance decision is computed. Violations here feed into the decision
  // (blocking violations can change allow → block).
  //
  // This replaces the doc-only hierarchy in CORE.MD with executable enforcement.
  // The result is also embedded in the Ledger payload so every run_outcome_summary
  // carries a self-describing cross-store consistency record.
  {
    const { reconcileStores, StoreViolationCode: SVC } = await import('@nirnex/core/dist/runtime/store-hierarchy.js');
    storeReconciliationResult = reconcileStores({
      envelope: {
        task_id:    envelope.task_id,
        session_id: envelope.session_id,
        lane:       envelope.lane,
      },
      hookEvents,
      writeFailureCount: hookWriteFailureCount,
    });
    // Surface each cross-store violation as a ContractViolationDetected event.
    // Blocking violations here are as consequential as any within-envelope violation.
    for (const v of storeReconciliationResult.violations) {
      // Map StoreViolationCode → ReasonCode: both use the same string literals
      // (STORE_* prefix). The cast is safe by construction.
      const reasonCode = v.code as typeof ReasonCode[keyof typeof ReasonCode];
      recordViolation(reasonCode, v.message, v.expected, v.actual, v.severity);
    }
    // Suppress unused-variable warning; SVC is referenced for structural check.
    void SVC;
  }

  // ── Derive final verification/acceptance status ────────────────────────

  if (!mandatoryVerificationRequired && verificationSource === 'none') {
    verificationStatus = 'not_requested';
  } else if (violations.some(v => v.event.payload.reason_code === ReasonCode.VERIFICATION_REQUIRED_NOT_RUN)) {
    verificationStatus = 'skipped';
  } else if (mandatoryVerificationRequired) {
    // Verification was attempted — classify by exit code if available, else unknown.
    // Rule 4: use the FIRST verification event, never the last.
    const bashEvents = events.filter(e => e.tool === 'Bash');
    const verificationBash = bashEvents.find(e => {
      const cmd = String((e.tool_input as any)?.command ?? '');
      if (storedVerificationCommands.length > 0 && storedVerificationCommands.some(vc => cmd.includes(vc))) return true;
      return /\b(test|jest|pytest|vitest|mocha|cargo\s+test|go\s+test|npm\s+test|yarn\s+test|pnpm\s+test|make\s+test|npm\s+run|yarn\s+run|pnpm\s+run)\b/i.test(cmd);
    });
    if (verificationBash) {
      // Prefer attested exit code (frozen at capture time) over live re-extraction.
      const vcmd = String((verificationBash.tool_input as any)?.command ?? '');
      const exitCode = verificationBash.attestation?.exit_code !== undefined
        ? verificationBash.attestation.exit_code
        : extractExitCode(verificationBash.tool_result, vcmd);
      if (exitCode === 0) verificationStatus = 'pass';
      else if (exitCode !== null) verificationStatus = 'fail';
      else verificationStatus = 'unknown';
    } else {
      verificationStatus = 'unknown';
    }
  } else {
    verificationStatus = 'not_requested';
  }

  acceptanceStatus =
    envelope.acceptance_criteria.length === 0
      ? 'not_requested'
      : violations.some(v => v.event.payload.reason_code === ReasonCode.ACCEPTANCE_NOT_EVALUATED)
        ? 'skipped'
        : events.length > 0
          ? 'unknown'   // events ran but we cannot auto-verify AC satisfaction without explicit checks
          : 'skipped';

  } catch (reconciliationErr) {
    // The reconciliation or status-derivation threw an unexpected error.
    // Record it as an advisory (never crash the validate hook silently),
    // keep whatever violations were already collected, and leave statuses as
    // their safe 'unknown' defaults so the decision engine still runs.
    const errMsg = reconciliationErr instanceof Error
      ? reconciliationErr.message
      : String(reconciliationErr);
    proseReasons.push(`[INTERNAL] Reconciliation error: ${errMsg}`);
    const internalErrEvent: ContractViolationDetectedEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      task_id: envelope.task_id,
      run_id: runId,
      hook_stage: 'validate',
      event_type: 'ContractViolationDetected',
      status: 'violated',
      payload: {
        reason_code: ReasonCode.LEDGER_WRITE_FAILED, // re-use nearest advisory code
        violated_contract: 'Validate reconciliation must not throw an unhandled exception',
        expected: 'no internal error',
        actual: errMsg,
        severity: 'advisory',
        blocking_action_taken: false,
      },
    };
    appendHookEvent(repoRoot, sessionId, internalErrEvent);
    violations.push({ event: internalErrEvent, severity: 'advisory' });
  }

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
  //
  // G3: finalize the envelope for BOTH allow and block outcomes so that any
  // subsequent Stop hook re-invocation is caught by the idempotency guard above.
  // `finalized_at` is set before stdout so the sentinel is on disk before the
  // hook returns — this minimises the window where a crash could leave the
  // envelope un-finalized while the process is mid-exit.

  const finalizedAt = new Date().toISOString();

  if (decision === 'block') {
    // G3: save envelope as 'failed' + finalized_at even for blocked tasks so
    // re-invocation is prevented (previously the envelope was never saved on block).
    try {
      envelope.status = 'failed';
      envelope.finalized_at = finalizedAt;
      const { saveEnvelope } = await import('./session.js');
      saveEnvelope(repoRoot, envelope);
    } catch {
      // Non-fatal: idempotency is best-effort when the envelope save fails
    }
    const out: ValidateDecision = {
      decision: 'block',
      reason: `[Nirnex Validate] ${proseReasons.join(' | ')}`,
    };
    process.stdout.write(JSON.stringify(out));
  } else {
    // Mark envelope as completed and finalized (G3: adds finalized_at)
    try {
      envelope.status = 'completed';
      envelope.finalized_at = finalizedAt;
      const { saveEnvelope } = await import('./session.js');
      saveEnvelope(repoRoot, envelope);
    } catch {
      // Non-fatal
    }
    process.stdout.write(JSON.stringify({ decision: 'allow' } as ValidateDecision));
  }

  // Write run outcome to the ledger so `nirnex report --list` records this run.
  // This is the missing link: hook events go to JSONL, but report reads the SQLite ledger.
  // completion_state mapping:
  //   block (blocking violations)        → 'refused'
  //   allow with advisory violations     → 'escalated'  (passed gate but flagged for attention)
  //   allow with no violations           → 'merged'     (cleanly completed)
  const completionState: 'refused' | 'escalated' | 'merged' =
    decision === 'block' ? 'refused' :
    advisoryViolations.length > 0 ? 'escalated' :
    'merged';

  try {
    const { initLedgerDb, appendLedgerEntry, getLedgerDbPath, LedgerReader } = await import('@nirnex/core/dist/ledger.js');
    const { randomUUID } = await import('node:crypto');
    const runTimestamp = new Date().toISOString();
    const db = initLedgerDb(getLedgerDbPath(repoRoot));

    // G3: Ledger-level dedupe backstop.
    // The envelope idempotency guard above is the primary protection. This is a
    // secondary layer that fires when the envelope save failed (e.g. permissions
    // error) but the process still reaches this point. If a run_outcome_summary
    // already exists for this trace_id we skip the write — the original outcome
    // is the authoritative one and the append-only ledger cannot be corrected.
    const reader = new LedgerReader(db);
    const existingSummaries = reader.fetchOutcomeSummaries(envelope.task_id);
    if (existingSummaries.length > 0) {
      // Outcome already recorded — no-op to prevent duplicate ledger entries.
      db.close();
    } else {
      const ledgerEntry = {
        schema_version: '1.0.0' as const,
        ledger_id: randomUUID(),
        trace_id: envelope.task_id,
        request_id: sessionId,
        session_id: sessionId,
        timestamp: runTimestamp,
        stage: 'analysis' as const,
        record_type: 'run_outcome_summary' as const,
        actor: 'system' as const,
        payload: {
          kind: 'run_outcome_summary' as const,
          summarized_trace_id: envelope.task_id,
          completion_state: completionState,
          final_lane: envelope.lane as 'A' | 'B' | 'C',
          final_confidence: null,
          had_refusal: decision === 'block',
          had_override: false,
          forced_unknown_applied: envelope.eco_summary.forced_unknown,
          evidence_gate_failed: blockingViolations.length > 0,
          stages_completed: events.length,
          run_timestamp: runTimestamp,
          // G2: embed the cross-store consistency record so every Ledger entry is
          // self-describing — a reader can determine store consistency without
          // re-reading the other two stores.
          ...(storeReconciliationResult !== undefined
            ? { store_reconciliation: storeReconciliationResult }
            : {}),
        },
      };
      appendLedgerEntry(db, ledgerEntry);
      db.close();
    }
  } catch (ledgerErr) {
    // Ledger write failure must not block task execution, but must not be silent either.
    // Emit a structured advisory so the event stream reflects the governance gap.
    const failEvent: ContractViolationDetectedEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      task_id: envelope.task_id,
      run_id: runId,
      hook_stage: 'validate',
      event_type: 'ContractViolationDetected',
      status: 'violated',
      payload: {
        reason_code: ReasonCode.LEDGER_WRITE_FAILED,
        violated_contract: 'Run outcome must be persisted to the ledger for governance continuity',
        expected: 'ledger entry written for trace_id=' + envelope.task_id,
        actual: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
        severity: 'advisory',
        blocking_action_taken: false,
      },
    };
    appendHookEvent(repoRoot, sessionId, failEvent);
  }

  process.exit(0);
}
