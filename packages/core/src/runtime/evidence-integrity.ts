/**
 * Evidence Integrity — Runtime Contract  (G4 fix)
 *
 * This module checks whether the event stream available to validate.ts is
 * complete enough to support a trustworthy governance decision.
 *
 * Problem: validate.ts previously loaded JSONL events and proceeded without
 * verifying the evidence stream's integrity. If G1 silently dropped events
 * (or the entry hook never ran), validate.ts would make governance decisions
 * based on partial or absent evidence — producing false confidence.
 *
 * Three checks are implemented as a pure function (no I/O):
 *
 *   EV1 — EVIDENCE_ENTRY_HOOK_MISSING
 *     No HookInvocationStarted from the entry stage AND no write failures.
 *     The entry hook genuinely did not run. Governance constraints were never
 *     applied at task start. Severity: blocking for Lane B/C, advisory for Lane A.
 *
 *   EV2 — EVIDENCE_TOTAL_ENTRY_LOSS
 *     No entry-stage events AND write failures > 0.
 *     The entry hook may have run but its events were lost to write failures.
 *     It is impossible to confirm governance was bootstrapped.
 *     Severity: blocking for Lane B/C, advisory for Lane A.
 *
 *   EV3 — EVIDENCE_EXECUTION_EVIDENCE_LOST
 *     Write failures > 0 AND zero trace events AND task had execution obligations
 *     (mandatory verification or Lane C). Cannot distinguish "nothing executed"
 *     from "trace events were silently dropped". Severity: blocking.
 *
 * EV1 and EV2 are mutually exclusive — they differentiate "missing vs valid":
 *   writeFailureCount = 0, no entry events  →  EV1 (entry hook did not run)
 *   writeFailureCount > 0, no entry events  →  EV2 (entry evidence was lost)
 *
 * Design constraints:
 *   - Pure function: no I/O, no imports from cli package
 *   - Deterministic: same inputs always produce same output
 *   - Backward-compatible: all input fields are optional / have safe defaults
 *   - EvidenceViolationCode string values MUST match the corresponding ReasonCode
 *     keys added in packages/cli/src/runtime/types.ts (EVIDENCE_* prefix)
 */

// ─── Version & codes ──────────────────────────────────────────────────────────

export const EVIDENCE_INTEGRITY_VERSION = '1.0.0' as const;

/**
 * Machine-readable codes for evidence integrity violations.
 *
 * String values MUST match the corresponding keys added to ReasonCode in
 * packages/cli/src/runtime/types.ts so ContractViolationDetected events in
 * the JSONL stream and the Ledger payload share a consistent, queryable code.
 */
export const EvidenceViolationCode = {
  /**
   * No HookInvocationStarted from the entry stage in JSONL, and no write
   * failures that could explain the absence. The entry hook definitively did
   * not run — governance constraints were never established for this task.
   */
  ENTRY_HOOK_MISSING:      'EVIDENCE_ENTRY_HOOK_MISSING',

  /**
   * No entry-stage events in JSONL and write failures were detected.
   * The entry hook may have run but its events were lost. It is impossible to
   * confirm governance was bootstrapped. Differentiated from ENTRY_HOOK_MISSING
   * by the presence of write failures.
   */
  TOTAL_ENTRY_LOSS:        'EVIDENCE_TOTAL_ENTRY_LOSS',

  /**
   * Write failures detected, zero trace events, and the task had execution
   * obligations (mandatory verification or Lane C). Cannot distinguish
   * "nothing was executed" from "trace events were silently dropped".
   */
  EXECUTION_EVIDENCE_LOST: 'EVIDENCE_EXECUTION_EVIDENCE_LOST',
} as const;

export type EvidenceViolationCodeValue = typeof EvidenceViolationCode[keyof typeof EvidenceViolationCode];

// ─── Result types ─────────────────────────────────────────────────────────────

export interface EvidenceIntegrityViolation {
  /** Machine-readable code. Matches a ReasonCode value in the CLI package. */
  code:     EvidenceViolationCodeValue;
  /** Human-readable description of the integrity problem. */
  message:  string;
  /** blocking → eligible to change the governance decision; advisory → recorded only. */
  severity: 'blocking' | 'advisory';
  /** What an intact evidence stream should contain. */
  expected: string;
  /** What was observed. */
  actual:   string;
}

/**
 * Lightweight input to checkEvidenceIntegrity().
 *
 * All fields are already in scope within validate.ts at the point the check
 * runs — no additional I/O is needed.
 */
export interface EvidenceIntegrityInput {
  /** Active envelope fields needed for lane-based severity decisions. */
  envelope: {
    task_id: string;
    lane:    string;
  };
  /**
   * Hook events loaded from hook-events.jsonl for this session.
   * Only event_type and hook_stage are inspected.
   */
  hookEvents: ReadonlyArray<{
    event_type:  string;
    hook_stage?: string;
    task_id?:    string;
  }>;
  /**
   * Number of trace events (tool calls captured during execution).
   * Pass `traceEvents.length` from validate.ts.
   */
  traceEventCount: number;
  /**
   * Number of hook events that failed to write to hook-events.jsonl
   * (from the G1 sidecar hook-write-failures.jsonl). Pass 0 if absent.
   */
  writeFailureCount: number;
  /**
   * Whether the envelope declared mandatory verification (from the
   * InputEnvelopeCaptured obligation event). Pass false if unknown.
   */
  mandatoryVerificationRequired: boolean;
}

export interface EvidenceIntegrityResult {
  /** Version of this contract module. Stored in the Ledger for forward-compat queries. */
  integrity_version:        typeof EVIDENCE_INTEGRITY_VERSION;
  /** ISO 8601 timestamp when the check ran. */
  checked_at:               string;
  /** true iff zero violations were found (evidence is sufficiently complete). */
  is_sufficient:            boolean;
  violations:               EvidenceIntegrityViolation[];
  blocking_violation_count: number;
  advisory_violation_count: number;
}

// ─── Integrity engine ─────────────────────────────────────────────────────────

/**
 * Check whether the evidence stream is complete enough for a trustworthy
 * governance decision.
 *
 * Called by validate.ts inside its reconciliation try-block, after G2 store
 * reconciliation and before the final decision is computed. Violations feed
 * directly into the violation array — blocking violations can change the
 * decision from 'allow' to 'block'.
 *
 * This function is pure (no I/O). Unit tests call it directly without any
 * filesystem setup.
 */
export function checkEvidenceIntegrity(input: EvidenceIntegrityInput): EvidenceIntegrityResult {
  const violations: EvidenceIntegrityViolation[] = [];
  const { envelope, hookEvents, traceEventCount, writeFailureCount, mandatoryVerificationRequired } = input;

  // Pre-compute: does the hook-events stream contain any entry-stage evidence?
  const entryStageEvents = hookEvents.filter(e => e.hook_stage === 'entry');
  const hasEntryHookStarted = entryStageEvents.some(e => e.event_type === 'HookInvocationStarted');

  // Lane-based severity helper: blocking for B/C (governed lanes); advisory for A
  const governedLaneSeverity: 'blocking' | 'advisory' =
    envelope.lane === 'A' ? 'advisory' : 'blocking';

  // ── EV1: Entry hook definitively did not run ──────────────────────────────
  //
  // Predicate: no HookInvocationStarted from entry stage AND write failures = 0.
  //
  // The absence of write failures is the critical differentiator: if no events
  // failed to write, then the missing entry events are not a write-failure
  // artefact — they were simply never emitted because the entry hook did not run.
  //
  // EV1 and EV2 are mutually exclusive (different writeFailureCount conditions).
  if (!hasEntryHookStarted && writeFailureCount === 0) {
    violations.push({
      code: EvidenceViolationCode.ENTRY_HOOK_MISSING,
      message:
        `No HookInvocationStarted event from the entry hook stage found in hook-events.jsonl. ` +
        `No write failures were detected (writeFailureCount=0), so the entry hook ` +
        `definitively did not run — governance constraints were not established at task start. ` +
        `Validation at the Stop hook has no entry-hook evidence to compare against.`,
      severity: governedLaneSeverity,
      expected: `HookInvocationStarted event with hook_stage='entry' in hook-events.jsonl`,
      actual:   `absent (writeFailureCount=0 confirms this is not a write-failure scenario)`,
    });
  }

  // ── EV2: Entry hook ran but all evidence was lost (total entry loss) ──────
  //
  // Predicate: no HookInvocationStarted from entry stage AND write failures > 0.
  //
  // Write failures exist, which means some hook events failed to reach disk.
  // The absence of ALL entry-stage events combined with known write failures
  // implies the entry hook's bootstrap events were completely lost.
  // "May have run" — not definitively missing, but evidence is gone.
  //
  // EV1 and EV2 are mutually exclusive: exactly one fires per evaluation.
  if (!hasEntryHookStarted && writeFailureCount > 0) {
    violations.push({
      code: EvidenceViolationCode.TOTAL_ENTRY_LOSS,
      message:
        `${writeFailureCount} write failure(s) detected AND no entry-stage events in hook-events.jsonl. ` +
        `The entry hook's governance bootstrap evidence was likely lost to write failures. ` +
        `It is impossible to confirm that governance constraints were applied at task start. ` +
        `This is differentiated from ENTRY_HOOK_MISSING by the presence of write failures ` +
        `(the entry hook may have run but its events never reached disk).`,
      severity: governedLaneSeverity,
      expected: `HookInvocationStarted event with hook_stage='entry' in hook-events.jsonl`,
      actual:
        `absent with writeFailureCount=${writeFailureCount} — entry evidence likely lost to write failures`,
    });
  }

  // ── EV3: Execution evidence lost under mandatory obligations ──────────────
  //
  // Predicate: writeFailureCount > 0 AND traceEventCount = 0 AND obligations.
  //
  // This fires when the task had execution obligations (mandatory verification
  // or Lane C) but zero trace events exist — AND we know write failures occurred.
  //
  // Without write failures, LANE_C_EMPTY_TRACE and VERIFICATION_REQUIRED_NOT_RUN
  // already handle the "no execution" case (blocking). This check adds the case
  // where trace events may have been silently dropped: we cannot distinguish
  // "nothing was executed" from "trace events were lost". Both are blocking because
  // governance cannot be verified without execution evidence.
  const hasExecutionObligations = mandatoryVerificationRequired || envelope.lane === 'C';
  if (writeFailureCount > 0 && traceEventCount === 0 && hasExecutionObligations) {
    violations.push({
      code: EvidenceViolationCode.EXECUTION_EVIDENCE_LOST,
      message:
        `${writeFailureCount} write failure(s) detected AND zero trace events for a task with ` +
        `execution obligations (lane=${envelope.lane}, mandatoryVerificationRequired=${mandatoryVerificationRequired}). ` +
        `Cannot distinguish "nothing was executed" from "trace events were silently dropped". ` +
        `Governance obligations (verification / Lane C scope) cannot be verified without ` +
        `execution evidence — the decision cannot safely be 'allow'.`,
      severity: 'blocking',
      expected:
        `trace events present, or writeFailureCount=0 ` +
        `(which would confirm "nothing executed" rather than "evidence lost")`,
      actual:
        `traceEventCount=0 with writeFailureCount=${writeFailureCount} — ambiguous state`,
    });
  }

  const blockingViolations = violations.filter(v => v.severity === 'blocking');
  const advisoryViolations = violations.filter(v => v.severity === 'advisory');

  return {
    integrity_version:        EVIDENCE_INTEGRITY_VERSION,
    checked_at:               new Date().toISOString(),
    is_sufficient:            violations.length === 0,
    violations,
    blocking_violation_count: blockingViolations.length,
    advisory_violation_count: advisoryViolations.length,
  };
}
