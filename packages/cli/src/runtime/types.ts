// Shared types for the Nirnex runtime hook pipeline.

export type Lane = 'A' | 'B' | 'C';

// Conflict section surfaced in the TEE — derived from conflict detection subsystem.
export type TEEConflictSection = {
  blocked_paths: string[];
  blocked_symbols: string[];
  clarification_questions: string[];
  proceed_warnings: string[];
};

export interface NirnexSession {
  session_id: string;
  repo_root: string;
  db_path: string;
  index_freshness: 'fresh' | 'stale' | 'unknown';
  current_head: string;
  policy_mode: 'strict' | 'standard' | 'permissive';
  created_at: string;
  tasks: string[];
  active_task_id?: string;
}

export interface TaskEnvelope {
  task_id: string;
  session_id: string;
  created_at: string;
  prompt: string;
  lane: Lane;
  scope: {
    allowed_paths: string[];
    blocked_paths: string[];
    modules_expected: string[];
  };
  constraints: string[];
  acceptance_criteria: string[];
  tool_policy: {
    allowed_tools: string[];
    requires_guard: string[];
    denied_patterns: string[];
  };
  stop_conditions: {
    required_validations: string[];
    forbidden_files: string[];
  };
  confidence: {
    score: number;
    label: string;
    penalties: Array<{ rule: string; deduction: number; detail: string }>;
  };
  eco_summary: {
    intent: string;
    recommended_lane: string;
    forced_unknown: boolean;
    blocked: boolean;
    escalation_reasons: string[];
    boundary_warnings: string[];
  };
  conflict?: TEEConflictSection;
  status: 'pending' | 'active' | 'completed' | 'failed';
  /**
   * ISO 8601 timestamp set when the Stop hook first writes a terminal outcome
   * for this task (G3 fix). Acts as the idempotency sentinel: subsequent Stop
   * hook invocations check this field and skip validation + ledger write when set.
   *
   * Absent on envelopes written before the G3 fix was deployed — treat as
   * "not yet finalized" (undefined === not finalized).
   */
  finalized_at?: string;
}

/** Execution attestation — frozen at trace-hook capture time, not at validation time. */
export interface CommandAttestation {
  /** SHA-256 hex of the command string. */
  command_hash: string;
  /** Exit code extracted at capture time. null = indeterminate → Zero-Trust Rule 2 blocks. */
  exit_code: number | null;
  /** Always 'trace-hook' — the only trusted capture source. */
  captured_by: 'trace-hook';
  /** true iff exit_code was deterministically extracted (not null). */
  verified: boolean;
  /** ISO 8601 timestamp when the attestation was created. */
  capture_timestamp: string;
}

export interface TraceEvent {
  event_id: string;
  session_id: string;
  task_id: string;
  timestamp: string;
  tool: string;
  tool_input: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
  affected_files: string[];
  deviation_flags: string[];
  /** Present for Bash events only. Frozen at capture time by the trace hook. */
  attestation?: CommandAttestation;
}

// ─── Hook Audit Trail ──────────────────────────────────────────────────────

export type HookStage = 'bootstrap' | 'entry' | 'guard' | 'trace' | 'validate';

export type HookEventType =
  | 'HookInvocationStarted'
  | 'InputEnvelopeCaptured'
  | 'ContractViolationDetected'
  | 'StageCompleted'
  | 'FinalOutcomeDeclared';

// Never infer missing state from absence of events — always use an explicit status value.
export type VerificationStatus = 'pass' | 'fail' | 'skipped' | 'unknown' | 'not_requested';

export type VerificationRequirementSource =
  | 'explicit_user_instruction'
  | 'acceptance_criteria'
  | 'lane_policy'
  | 'none';

export const ReasonCode = {
  VERIFICATION_NOT_REQUESTED: 'VERIFICATION_NOT_REQUESTED',
  VERIFICATION_REQUIRED_NOT_RUN: 'VERIFICATION_REQUIRED_NOT_RUN',
  /** Verification command ran and exit code was proven non-zero. */
  COMMAND_EXIT_NONZERO: 'COMMAND_EXIT_NONZERO',
  /** Verification command ran but exit code could not be determined (Zero-Trust Rule 2). */
  COMMAND_EXIT_UNKNOWN: 'COMMAND_EXIT_UNKNOWN',
  /** A file was modified after the verification command ran (Zero-Trust Rule 3). */
  POST_VERIFICATION_EDIT: 'POST_VERIFICATION_EDIT',
  ACCEPTANCE_NOT_EVALUATED: 'ACCEPTANCE_NOT_EVALUATED',
  SUMMARY_CONTRADICTS_EVIDENCE: 'SUMMARY_CONTRADICTS_EVIDENCE',
  BLOCKED_PATH_DEVIATION: 'BLOCKED_PATH_DEVIATION',
  FORCED_UNKNOWN_NO_VERIFICATION: 'FORCED_UNKNOWN_NO_VERIFICATION',
  LANE_C_EMPTY_TRACE: 'LANE_C_EMPTY_TRACE',
  LANE_C_DEADLOCK: 'LANE_C_DEADLOCK',
  ECO_BLOCKED: 'ECO_BLOCKED',
  LEDGER_WRITE_FAILED: 'LEDGER_WRITE_FAILED',
  /**
   * One or more hook events could not be written to hook-events.jsonl.
   * The failure is recorded in hook-write-failures.jsonl and emitted to stderr,
   * but the audit trail for this session may be incomplete.
   */
  HOOK_WRITE_FAILED: 'HOOK_WRITE_FAILED',

  // ── G2: Cross-store reconciliation codes ────────────────────────────────
  // These match StoreViolationCode values in packages/core/src/runtime/store-hierarchy.ts.
  // Both packages use the same string literals so ContractViolationDetected events in
  // the JSONL stream and the Ledger payload share a consistent, queryable reason_code.

  /**
   * No InputEnvelopeCaptured event in JSONL for the active task_id.
   * The entry hook may not have run or a G1 write failure suppressed it.
   */
  STORE_JSONL_MISSING_ENVELOPE_CAPTURED: 'STORE_JSONL_MISSING_ENVELOPE_CAPTURED',
  /**
   * TaskEnvelope.lane ≠ InputEnvelopeCaptured.payload.lane.
   * The governance rules applied during execution differ from the active lane.
   */
  STORE_ENVELOPE_JSONL_LANE_MISMATCH:    'STORE_ENVELOPE_JSONL_LANE_MISMATCH',
  /**
   * InputEnvelopeCaptured.task_id ≠ TaskEnvelope.task_id.
   * JSONL evidence belongs to a different task — cross-task contamination.
   */
  STORE_ENVELOPE_JSONL_TASK_ID_MISMATCH: 'STORE_ENVELOPE_JSONL_TASK_ID_MISMATCH',
  /**
   * hook-write-failures.jsonl is non-empty — the JSONL audit trail is incomplete.
   * Governance decisions may rest on missing evidence.
   */
  STORE_JSONL_WRITE_FAILURES_DETECTED:   'STORE_JSONL_WRITE_FAILURES_DETECTED',

  // ── G3: Stop-hook idempotency ────────────────────────────────────────────
  /**
   * Stop hook re-invoked for a task that already has a terminal outcome.
   * envelope.finalized_at is set — this invocation is suppressed as a no-op.
   * Emitted as an advisory; the hook still returns decision='allow' so Claude
   * Code can proceed without being blocked by the duplicate invocation.
   */
  TASK_ALREADY_FINALIZED: 'TASK_ALREADY_FINALIZED',

  // ── G4: Evidence integrity codes ─────────────────────────────────────────
  // These match EvidenceViolationCode values in
  // packages/core/src/runtime/evidence-integrity.ts (EVIDENCE_* prefix).

  /**
   * No HookInvocationStarted from the entry stage in JSONL, and no write
   * failures to explain the absence. The entry hook definitively did not run —
   * governance constraints were never established at task start.
   */
  EVIDENCE_ENTRY_HOOK_MISSING:      'EVIDENCE_ENTRY_HOOK_MISSING',

  /**
   * No entry-stage events in JSONL AND write failures were detected.
   * The entry hook may have run but its bootstrap events were lost.
   * Cannot confirm governance was established.
   */
  EVIDENCE_TOTAL_ENTRY_LOSS:        'EVIDENCE_TOTAL_ENTRY_LOSS',

  /**
   * Write failures detected, zero trace events, and the task had execution
   * obligations (mandatory verification or Lane C). Cannot distinguish
   * "nothing executed" from "trace events silently dropped".
   */
  EVIDENCE_EXECUTION_EVIDENCE_LOST: 'EVIDENCE_EXECUTION_EVIDENCE_LOST',

  /**
   * The count of trace events in events.jsonl is lower than expected given the
   * number of trace-stage StageCompleted entries in hook-events.jsonl, and the
   * deficit is not explained by known write failures. This is the fingerprint of
   * direct trace file truncation — an attempt to erase execution evidence before
   * governance validation.
   */
  EVIDENCE_TRACE_DEFICIT_UNEXPLAINED: 'EVIDENCE_TRACE_DEFICIT_UNEXPLAINED',

  // ── Confidence gate ──────────────────────────────────────────────────────────
  /**
   * envelope.confidence.score is 0 — governance decision reliability cannot be
   * established. The planning stage produced no confidence signal, so the
   * validate stage cannot verify that the outcome is trustworthy.
   *
   * Emitted as an advisory (not blocking) so execution is not prevented, but
   * the gap is visible in the audit trail and the ledger.
   */
  CONFIDENCE_GATE_UNKNOWN: 'CONFIDENCE_GATE_UNKNOWN',

  // ── Stdin transport ──────────────────────────────────────────────────────────
  /**
   * validate was invoked but no hook payload arrived on stdin within the read
   * timeout window, OR the stdin stream emitted an error (e.g. broken pipe).
   *
   * Two root causes share this code:
   *   1. Unsupported invocation — direct CLI call without piping hook JSON,
   *      so stdin never closes and the 30s timeout fires.
   *   2. Hook runner failure — Claude Code crashed or stalled before closing
   *      the write-end of the pipe in the normal hook transport path.
   *
   * Both are emitted as blocking because governance constraints cannot be
   * applied without a valid hook payload. Operators can distinguish cause (1)
   * from cause (2) by context: (1) produces no session state on disk; (2) will
   * have a partial session with an open envelope.
   *
   * Use `nirnex runtime validate --payload '{"session_id":"..."}' ` for
   * manual debugging to bypass stdin entirely.
   */
  STDIN_READ_TIMEOUT: 'STDIN_READ_TIMEOUT',
} as const;

export type ReasonCodeValue = typeof ReasonCode[keyof typeof ReasonCode];

// Universal fields present on every HookEvent
interface HookEventBase {
  event_id: string;
  timestamp: string;
  session_id: string;
  task_id: string;
  run_id: string;
  hook_stage: HookStage;
  event_type: HookEventType;
}

export interface HookInvocationStartedEvent extends HookEventBase {
  event_type: 'HookInvocationStarted';
  payload: {
    stage: HookStage;
    cwd: string;
    repo_root: string;
    pid: number;
    nirnex_version?: string;
  };
}

export interface InputEnvelopeCapturedEvent extends HookEventBase {
  event_type: 'InputEnvelopeCaptured';
  payload: {
    task_id: string;
    lane: string;
    blocked: boolean;
    forced_unknown: boolean;
    acceptance_criteria_count: number;
    constraints_count: number;
    verification_commands_detected: boolean;
    verification_commands: string[];
    mandatory_verification_required: boolean;
    verification_requirement_source: VerificationRequirementSource;
  };
}

export interface ContractViolationDetectedEvent extends HookEventBase {
  event_type: 'ContractViolationDetected';
  status: 'violated';
  payload: {
    reason_code: ReasonCodeValue;
    violated_contract: string;
    expected: string;
    actual: string;
    severity: 'blocking' | 'advisory';
    blocking_action_taken: boolean;
  };
}

export interface StageCompletedEvent extends HookEventBase {
  event_type: 'StageCompleted';
  status: 'pass' | 'fail';
  payload: {
    stage: HookStage;
    blocker_count: number;
    violation_count: number;
    emitted_artifacts?: string[];
  };
}

export interface FinalOutcomeDeclaredEvent extends HookEventBase {
  event_type: 'FinalOutcomeDeclared';
  payload: {
    decision: 'allow' | 'block';
    violation_count: number;
    blocking_violation_count: number;
    advisory_violation_count: number;
    reason_codes: ReasonCodeValue[];
    verification_status: VerificationStatus;
    acceptance_status: VerificationStatus;
    envelope_status: string;
  };
}

/**
 * Emitted when appendHookEvent() cannot write an event to hook-events.jsonl,
 * or when an event is rejected because required universal fields are missing.
 *
 * NOT written to the main hook-events.jsonl (that file may be the source of
 * the failure). Written to the sidecar hook-write-failures.jsonl and to
 * process.stderr so the Claude Code process can capture it.
 *
 * Consumers: validate.ts reads this via loadHookWriteFailures() to detect
 * whether the audit trail for the current session is complete.
 */
export interface HookWriteFailedEvent {
  event_id: string;
  timestamp: string;
  session_id: string;
  task_id: string;
  run_id: string;
  /** 'unknown' only when the source event was malformed and hook_stage was absent. */
  hook_stage: HookStage | 'unknown';
  event_type: 'HookWriteFailed';
  payload: {
    /** 'write_error' — fs.appendFileSync rejected the write.
     *  'malformed_event' — one or more universal fields were absent on the source event. */
    reason: 'write_error' | 'malformed_event';
    /** event_type of the event that failed to be written; 'unknown' when malformed. */
    failed_event_type: HookEventType | 'unknown';
    /** event_id of the event that failed; empty string when malformed. */
    failed_event_id: string;
    /** Human-readable error message from the caught exception or validation check. */
    error: string;
    /** Absolute path of the file that could not be written. */
    target_path: string;
    /** Populated only when reason === 'malformed_event'. */
    missing_fields?: string[];
  };
}

export type HookEvent =
  | HookInvocationStartedEvent
  | InputEnvelopeCapturedEvent
  | ContractViolationDetectedEvent
  | StageCompletedEvent
  | FinalOutcomeDeclaredEvent;

// ─── Claude hook I/O shapes ────────────────────────────────────────────────

// Claude hook I/O shapes

export interface HookSessionStart {
  session_id: string;
  transcript_path?: string;
}

export interface HookPromptSubmit {
  session_id: string;
  transcript_path?: string;
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
}

export interface HookPreToolUse {
  session_id: string;
  transcript_path?: string;
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface HookPostToolUse {
  session_id: string;
  transcript_path?: string;
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: Record<string, unknown>; // Claude Code's actual field name (PostToolUse)
  tool_result?: Record<string, unknown>;   // fallback / forward-compat alias
}

export interface HookStop {
  session_id: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
}

// Hook output shapes

export interface GuardDecision {
  decision: 'allow' | 'deny' | 'ask';
  reason?: string;
  message?: string;
}

export interface ValidateDecision {
  decision: 'allow' | 'block';
  reason?: string;
}

export interface ContextOutput {
  additionalContext?: string;
  blockMessage?: string;
}

// ─── Verification Receipt ──────────────────────────────────────────────────────

/**
 * Canonical verification receipt — written by the trace hook at PostToolUse
 * capture time when a Bash command matches the verification pattern.
 *
 * This is the PRIMARY source of truth for validate.ts verification evidence.
 * It is stored in its own file scoped to the task_id and therefore survives
 * task_id binding failures in events.jsonl (which occur when loadActiveEnvelope()
 * returns null in the trace hook, causing all trace events to have task_id='none').
 *
 * Design:
 *   - Written once per task, for the FIRST verification command (Rule 4).
 *   - Stored at .ai-index/runtime/receipts/<task_id>/verification.json
 *   - validate.ts reads this before falling back to trace event search.
 *   - saveVerificationReceipt() is a no-op if a receipt already exists (Rule 4).
 *
 * String values for session_id, task_id, run_id must match the corresponding
 * fields in the trace event emitted by the same trace hook invocation.
 */
export interface VerificationReceipt {
  /** Unique ID for this receipt (same generator as event_id). */
  receipt_id: string;
  /** Claude Code session this verification belonged to. */
  session_id: string;
  /** Task envelope ID this verification was performed under. */
  task_id: string;
  /** Trace hook run_id that captured this verification. */
  run_id: string;
  /** The exact bash command string as received in the PostToolUse payload. */
  command: string;
  /** Trimmed form of the command — used for pattern comparisons. */
  normalized_command: string;
  /** SHA-256 hex of the command string — durable evidence identity. */
  command_hash: string;
  /**
   * ISO 8601 timestamp when the command started.
   * Not available from PostToolUse — always null when written by the trace hook.
   */
  started_at: string | null;
  /**
   * ISO 8601 timestamp when the command finished (attestation.capture_timestamp).
   * Used as the boundary for Zero-Trust Rule 3 (post-verification edit detection).
   */
  finished_at: string;
  /** Exit code extracted at capture time. null = indeterminate → Rule 2 blocks. */
  exit_code: number | null;
  /** Derived from exit_code: pass=0, fail=non-zero, unknown=null. */
  status: 'pass' | 'fail' | 'unknown';
  /** Always 'trace-hook' — the only trusted capture source. */
  source_stage: 'trace-hook';
  /** ISO 8601 timestamp when this receipt was written to disk. */
  captured_at: string;
}
