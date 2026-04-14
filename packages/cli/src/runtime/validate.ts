// Stop hook handler.
// Called when Claude thinks it is done with a task.
// Validates the active task envelope against the trace, and blocks completion
// if required conditions are not met.

import fs from 'node:fs';
import path from 'node:path';
import { loadActiveEnvelope, loadTraceEvents, loadHookEvents, loadHookWriteFailures, appendHookEvent, generateEventId, generateRunId, isEnvelopeFinalized, isBlockFinalized, loadVerificationReceipt } from './session.js';
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
import { evaluateZeroTrustRules, isBashVerificationCommand } from './attestation.js';
import { isConfidenceGateUnknown } from './confidence-gate.js';
import { readStdinWithTimeout } from './stdin.js';

/**
 * Extracts the JSON string following a --payload flag from an args array.
 *
 * Returns the value string when --payload is present and followed by a
 * non-empty value. Returns null otherwise.
 *
 * Exported for unit testing. Used by runValidate to support manual/debug
 * invocation without piping JSON to stdin:
 *
 *   nirnex runtime validate --payload '{"session_id":"..."}'
 */
export function parsePayloadArg(args: string[]): string | null {
  const idx = args.indexOf('--payload');
  if (idx === -1) return null;
  const value = args[idx + 1];
  return value && value.length > 0 ? value : null;
}

interface ViolationRecord {
  event: ContractViolationDetectedEvent;
  severity: 'blocking' | 'advisory';
}

export async function runValidate(args: string[] = []): Promise<void> {
  const runId = generateRunId();

  // ── Stdin transport ────────────────────────────────────────────────────────
  // Prefer an explicit --payload flag (manual/debug mode) over reading stdin.
  // Fall back to readStdinWithTimeout which:
  //   - writes a stderr diagnostic so observers can distinguish waiting from hanging
  //   - resolves with null after 30s if stdin never closes (never-EOF / broken-pipe)
  const inlinePayload = parsePayloadArg(args);
  const raw = inlinePayload !== null
    ? inlinePayload
    : await readStdinWithTimeout();

  // ── Stdin timeout / broken-pipe gate ──────────────────────────────────────
  // null means no payload arrived: either manual invocation without --payload,
  // or the hook runner failed to close the pipe (normal path failure).
  // Emit a structured block so the cause is diagnosable from the hook log.
  if (raw === null) {
    const repoRoot  = process.env.NIRNEX_REPO_ROOT ?? process.cwd();
    const sessionId = process.env.NIRNEX_SESSION_ID ?? '';
    process.stderr.write(
      '[nirnex validate] STDIN_READ_TIMEOUT: No hook payload received within the timeout window.\n' +
      '  Possible causes:\n' +
      '    1. Direct invocation without stdin — use --payload \'{"session_id":"..."}\' for debugging.\n' +
      '    2. Hook runner failed to close stdin (Claude Code crash or stall).\n' +
      '  Reason code: STDIN_READ_TIMEOUT\n',
    );
    // Emit minimal hook events so the audit trail is not silently orphaned.
    const timeoutInvocationEvent: HookInvocationStartedEvent = {
      event_id:   generateEventId(),
      timestamp:  new Date().toISOString(),
      session_id: sessionId,
      task_id:    'none',
      run_id:     runId,
      hook_stage: 'validate',
      event_type: 'HookInvocationStarted',
      payload: { stage: 'validate', cwd: process.cwd(), repo_root: repoRoot, pid: process.pid },
    };
    appendHookEvent(repoRoot, sessionId, timeoutInvocationEvent);
    const timeoutViolationEvent: ContractViolationDetectedEvent = {
      event_id:   generateEventId(),
      timestamp:  new Date().toISOString(),
      session_id: sessionId,
      task_id:    'none',
      run_id:     runId,
      hook_stage: 'validate',
      event_type: 'ContractViolationDetected',
      status:     'violated',
      payload: {
        reason_code:            ReasonCode.STDIN_READ_TIMEOUT,
        violated_contract:      'validate must receive a hook payload on stdin within the timeout window',
        expected:               'JSON hook payload on stdin before timeout',
        actual:                 inlinePayload === null
          ? 'stdin did not close within the timeout window (never-EOF or broken-pipe)'
          : 'unreachable',
        severity:               'blocking',
        blocking_action_taken:  true,
      },
    };
    appendHookEvent(repoRoot, sessionId, timeoutViolationEvent);
    const timeoutFinalEvent: FinalOutcomeDeclaredEvent = {
      event_id:   generateEventId(),
      timestamp:  new Date().toISOString(),
      session_id: sessionId,
      task_id:    'none',
      run_id:     runId,
      hook_stage: 'validate',
      event_type: 'FinalOutcomeDeclared',
      payload: {
        decision:                  'block',
        violation_count:           1,
        blocking_violation_count:  1,
        advisory_violation_count:  0,
        reason_codes:              [ReasonCode.STDIN_READ_TIMEOUT],
        verification_status:       'unknown' as VerificationStatus,
        acceptance_status:         'unknown' as VerificationStatus,
        envelope_status:           'stdin_timeout',
      },
    };
    appendHookEvent(repoRoot, sessionId, timeoutFinalEvent);
    const timeoutStageEvent: StageCompletedEvent = {
      event_id:   generateEventId(),
      timestamp:  new Date().toISOString(),
      session_id: sessionId,
      task_id:    'none',
      run_id:     runId,
      hook_stage: 'validate',
      event_type: 'StageCompleted',
      status:     'fail',
      payload: { stage: 'validate', blocker_count: 1, violation_count: 1 },
    };
    appendHookEvent(repoRoot, sessionId, timeoutStageEvent);
    const out: ValidateDecision = {
      decision: 'block',
      reason:   '[STDIN_READ_TIMEOUT] validate did not receive a hook payload within the timeout window. ' +
                'Use --payload for manual invocation or check hook runner health.',
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

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
    // G3 allow-path: emit the TASK_ALREADY_FINALIZED advisory exactly once
    // (first re-invocation only) — consistent with the block-path guard below.
    // Repeated advisories give Claude text to acknowledge on each re-invocation,
    // accumulate noise in the audit trail, and provide no additional signal.
    const existingAllowEvents = loadHookEvents(repoRoot, sessionId);
    const alreadyEmittedAllowAdvisory = existingAllowEvents.some(
      e =>
        e.event_type === 'ContractViolationDetected' &&
        e.task_id === envelope.task_id &&
        (e as ContractViolationDetectedEvent).payload?.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );

    if (!alreadyEmittedAllowAdvisory) {
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
    }

    // Emit StageCompleted on every re-invocation to close the lifecycle — the G3
    // path emits HookInvocationStarted above and needs a matching StageCompleted.
    // violation_count reflects whether the advisory was emitted this invocation.
    const dupScEvent: StageCompletedEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      task_id: envelope.task_id,
      run_id: runId,
      hook_stage: 'validate',
      event_type: 'StageCompleted',
      status: 'pass',
      payload: {
        stage: 'validate',
        blocker_count: 0,
        violation_count: alreadyEmittedAllowAdvisory ? 0 : 1,
      },
    };
    appendHookEvent(repoRoot, sessionId, dupScEvent);
    process.stdout.write(JSON.stringify({ decision: 'allow' } as ValidateDecision));
    process.exit(0);
  }

  // ── G3 block-path: Idempotency guard for previously-blocked tasks ──────────
  // If the envelope was previously finalized as 'failed' (block outcome), a
  // re-invocation must short-circuit with block — NOT re-run full validation.
  //
  // Re-running validation produces duplicate ContractViolationDetected events,
  // accumulates new POST_VERIFICATION_EDIT violations for any edits Claude made
  // in response to the first block, and sustains an infinite re-invocation loop
  // where the agent keeps attempting to "fix" a situation that is already closed.
  //
  // The advisory is emitted at most once (first re-invocation) so the duplicate is
  // auditable. Subsequent re-invocations return block silently — repeated events give
  // the agent new information to acknowledge, generating more text, triggering more
  // stop hooks, and sustaining the very loop this guard is meant to break.
  if (isBlockFinalized(envelope)) {
    const existingEvents = loadHookEvents(repoRoot, sessionId);
    const alreadyEmittedAdvisory = existingEvents.some(
      e =>
        e.event_type === 'ContractViolationDetected' &&
        e.task_id === envelope.task_id &&
        (e as ContractViolationDetectedEvent).payload?.reason_code === ReasonCode.TASK_ALREADY_FINALIZED,
    );

    if (!alreadyEmittedAdvisory) {
      // First re-invocation: emit one auditable advisory so the duplicate is recorded.
      const blockDupEvent: ContractViolationDetectedEvent = {
        event_id:   generateEventId(),
        timestamp:  new Date().toISOString(),
        session_id: sessionId,
        task_id:    envelope.task_id,
        run_id:     runId,
        hook_stage: 'validate',
        event_type: 'ContractViolationDetected',
        status:     'violated',
        payload: {
          reason_code:           ReasonCode.TASK_ALREADY_FINALIZED,
          violated_contract:     'Stop hook must produce exactly one terminal outcome per task_id',
          expected:              `single outcome for task_id=${envelope.task_id}`,
          actual:                `task was previously blocked at ${envelope.finalized_at}; duplicate block-path invocation suppressed`,
          severity:              'advisory',
          blocking_action_taken: false,
        },
      };
      appendHookEvent(repoRoot, sessionId, blockDupEvent);
    }

    // Always emit StageCompleted — even on the silent path (2nd+ re-invocations).
    // Without this, every silent re-invocation leaves an orphaned HookInvocationStarted
    // with no matching StageCompleted, breaking audit-trail lifecycle completeness.
    // violation_count: first re-invocation records 1 (advisory above); subsequent are 0.
    const blockDupScEvent: StageCompletedEvent = {
      event_id:   generateEventId(),
      timestamp:  new Date().toISOString(),
      session_id: sessionId,
      task_id:    envelope.task_id,
      run_id:     runId,
      hook_stage: 'validate',
      event_type: 'StageCompleted',
      // Use 'pass': the idempotency guard succeeded. 'fail' was inconsistent with the
      // allow-path guard (line 250) and caused the hook framework to treat these
      // re-invocations as errors rather than clean no-ops.
      status:     'pass',
      payload:    { stage: 'validate', blocker_count: 0, violation_count: alreadyEmittedAdvisory ? 0 : 1 },
    };
    appendHookEvent(repoRoot, sessionId, blockDupScEvent);

    // Return block without a reason string — the original block reason is in the
    // audit trail; repeating it gives the agent text to acknowledge, which triggers
    // another response and another stop hook cycle.
    process.stdout.write(JSON.stringify({ decision: 'block' } as ValidateDecision));
    process.exit(0);
  }

  const rawEvents = loadTraceEvents(repoRoot, sessionId);
  // Filter to only trace events for the current task — prevents cross-task
  // trace contamination when multiple tasks run within the same Claude Code session.
  const events = rawEvents.filter(e => e.task_id === envelope.task_id);
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

  // G4: evidence integrity result — populated inside the try block.
  // undefined until checkEvidenceIntegrity() runs; the Ledger payload embeds it
  // so every run_outcome_summary carries a self-describing evidence sufficiency record.
  let evidenceIntegrityResult: import('@nirnex/core/dist/runtime/evidence-integrity.js').EvidenceIntegrityResult | undefined;

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

  // Check: mandatory verification required but no verification evidence
  // Primary path: load the canonical VerificationReceipt written by the trace hook.
  // Fallback: search trace events (backward compat / pre-receipt deployments).
  if (mandatoryVerificationRequired) {

    // ── Primary: canonical VerificationReceipt ────────────────────────────
    // The receipt is written by the trace hook at PostToolUse capture time,
    // scoped to the task_id. It is immune to task_id binding failures in
    // events.jsonl (where task_id='none' causes evidence to be invisible).
    const receipt = loadVerificationReceipt(repoRoot, envelope.task_id);

    if (receipt) {
      // Rule 2: exit code from the frozen receipt — never re-extracted from prose.
      if (receipt.exit_code === null) {
        recordViolation(
          ReasonCode.COMMAND_EXIT_UNKNOWN,
          'Verification command ran but exit code could not be determined — cannot confirm pass (Zero-Trust Rule 2)',
          'exit_code = 0 (deterministic)',
          `exit_code = unknown (receipt_id=${receipt.receipt_id})`,
          'blocking',
        );
      } else if (receipt.exit_code !== 0) {
        recordViolation(
          ReasonCode.COMMAND_EXIT_NONZERO,
          'Verification command exited with a non-zero code (Zero-Trust Rule 2)',
          'exit_code = 0',
          `exit_code = ${receipt.exit_code} (receipt_id=${receipt.receipt_id})`,
          'blocking',
        );
      }

      // Rule 3: no edits after the verification boundary (receipt.finished_at).
      // ISO 8601 strings are lexicographically comparable — no Date() needed.
      const postVerifEdits = events.filter(e =>
        (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit') &&
        e.timestamp > receipt.finished_at,
      );
      for (const edit of postVerifEdits) {
        const files = edit.affected_files.length > 0
          ? edit.affected_files.join(', ')
          : String((edit.tool_input as any)?.file_path ?? 'unknown');
        recordViolation(
          ReasonCode.POST_VERIFICATION_EDIT,
          'File modified after verification was run (Zero-Trust Rule 3)',
          'no file modifications after verification',
          `file: ${files}`,
          'blocking',
        );
      }
    } else {
      // ── Fallback: trace event search ──────────────────────────────────────
      // Receipt absent — pre-receipt deployment or task_id binding failure.
      // Try to find verification evidence in events.jsonl for this task.
      const bashEvents = events.filter(e => e.tool === 'Bash');
      const verificationAttempted = bashEvents.some(e => {
        const cmd = String((e.tool_input as any)?.command ?? '');
        // Delegates to the shared helper: stored commands first, then VERIFICATION_PATTERN.
        return isBashVerificationCommand(cmd, storedVerificationCommands);
      });

      if (!verificationAttempted) {
        // ── Structured diagnostics ────────────────────────────────────────
        // Emit machine-readable detail about WHY no verification evidence was
        // found. This allows root-cause diagnosis without assistant narration.
        // Key signal: if task_id='none' bash events look like verification,
        // the envelope was likely unloaded during the trace hook invocation —
        // a task_id binding failure, not a genuine skip.
        const allBashEvents = rawEvents.filter(e => e.tool === 'Bash');
        const orphanBashEvents = rawEvents.filter(
          e => e.tool === 'Bash' && e.task_id === 'none',
        );
        const orphanLookingLikeVerification = orphanBashEvents.filter(e => {
          const cmd = String((e.tool_input as any)?.command ?? '');
          return isBashVerificationCommand(cmd, storedVerificationCommands);
        });

        const diagParts: string[] = [
          'no_receipt',
          `bash_events_for_task=${bashEvents.length}`,
          `bash_events_total=${allBashEvents.length}`,
        ];
        if (orphanBashEvents.length > 0) {
          diagParts.push(`bash_events_task_id_none=${orphanBashEvents.length}`);
        }
        if (orphanLookingLikeVerification.length > 0) {
          // This fingerprint: the verification command RAN (visible in events.jsonl)
          // but the trace hook failed to load the active envelope, so the event
          // was written with task_id='none' instead of the actual task_id.
          diagParts.push(
            `task_id_binding_failure_suspected:${orphanLookingLikeVerification.length}_verification_candidate(s)_have_task_id=none`,
          );
        }
        if (storedVerificationCommands.length > 0) {
          diagParts.push(`stored_commands=[${storedVerificationCommands.join(',')}]`);
        }

        const severity = verificationSource === 'unknown' ? 'advisory' : 'blocking';
        recordViolation(
          ReasonCode.VERIFICATION_REQUIRED_NOT_RUN,
          'Verification was declared mandatory but no verification command was executed',
          `verification command executed (source: ${verificationSource})`,
          diagParts.join('; '),
          severity,
        );
      } else {
        // Found in trace — apply Zero-Trust rules 2, 3, 4 via pure engine.
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
            ztv.observed,
            'blocking',
          );
        }
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

  // ── Confidence gate ────────────────────────────────────────────────────────
  // When envelope.confidence.score === 0 the planning stage produced no
  // confidence signal — the governance decision reliability cannot be verified.
  // Record as advisory so the gap is visible in the audit trail without blocking.
  if (isConfidenceGateUnknown(envelope.confidence.score)) {
    recordViolation(
      ReasonCode.CONFIDENCE_GATE_UNKNOWN,
      'Confidence score is 0 — governance decision reliability cannot be established',
      'confidence.score > 0',
      `confidence.score = 0, label = "${envelope.confidence.label}"`,
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

  // ── G4: Evidence integrity check ─────────────────────────────────────────
  // Verifies that the event stream is complete enough for a trustworthy
  // governance decision. Three checks run here (pure function, no I/O):
  //
  //   EV1 — Entry hook definitively didn't run (no write failures, no entry events)
  //   EV2 — Entry hook may have run but evidence was lost (write failures + no entry events)
  //   EV3 — Execution evidence lost under obligations (write failures + zero trace events)
  //
  // EV1/EV2 are mutually exclusive and differentiate "missing vs valid" evidence.
  // Violations feed into the governance decision exactly like other checks.
  {
    const { checkEvidenceIntegrity, EvidenceViolationCode: EVC } = await import('@nirnex/core/dist/runtime/evidence-integrity.js');
    evidenceIntegrityResult = checkEvidenceIntegrity({
      envelope: {
        task_id: envelope.task_id,
        lane:    envelope.lane,
      },
      hookEvents,
      traceEventCount:              events.length,
      writeFailureCount:             hookWriteFailureCount,
      mandatoryVerificationRequired,
    });
    for (const v of evidenceIntegrityResult.violations) {
      // Map EvidenceViolationCode → ReasonCode: both use identical EVIDENCE_* literals.
      // The cast is safe by construction.
      const reasonCode = v.code as typeof ReasonCode[keyof typeof ReasonCode];
      recordViolation(reasonCode, v.message, v.expected, v.actual, v.severity);
    }
    // Suppress unused-variable warning; EVC is referenced for structural check.
    void EVC;
  }

  // ── Derive final verification/acceptance status ────────────────────────

  if (!mandatoryVerificationRequired && verificationSource === 'none') {
    verificationStatus = 'not_requested';
  } else if (violations.some(v => v.event.payload.reason_code === ReasonCode.VERIFICATION_REQUIRED_NOT_RUN)) {
    verificationStatus = 'skipped';
  } else if (mandatoryVerificationRequired) {
    // Primary: derive status from the canonical receipt (same source used in the check above).
    const receiptForStatus = loadVerificationReceipt(repoRoot, envelope.task_id);
    if (receiptForStatus) {
      if (receiptForStatus.exit_code === 0) verificationStatus = 'pass';
      else if (receiptForStatus.exit_code !== null) verificationStatus = 'fail';
      else verificationStatus = 'unknown';
    } else {
      // Fallback: derive from trace event (backward compat).
      // Rule 4: use the FIRST verification event, never the last.
      const bashEvents = events.filter(e => e.tool === 'Bash');
      const verificationBash = bashEvents.find(e => {
        const cmd = String((e.tool_input as any)?.command ?? '');
        return isBashVerificationCommand(cmd, storedVerificationCommands);
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
          final_confidence: envelope.confidence.score,
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
          // G4: embed the evidence integrity record so every Ledger entry carries
          // a self-describing record of whether the evidence stream was complete
          // enough for the governance decision to be trustworthy.
          ...(evidenceIntegrityResult !== undefined
            ? { evidence_integrity: evidenceIntegrityResult }
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
