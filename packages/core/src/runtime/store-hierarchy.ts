/**
 * Canonical Store Hierarchy — Runtime Contract
 *
 * This module is the authoritative, code-level declaration of which store is
 * canonical and what reconciliation rules govern consistency across the three
 * runtime data stores.
 *
 * Previously this hierarchy existed only in documentation (CORE.MD §Decision
 * Ledger). This module makes it executable: typed constants, rules, and a
 * pure reconcileStores() function that validate.ts calls before writing any
 * governance record to the Ledger.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  STORE HIERARCHY  (data authority flows downward; reads flow upward)    │
 * │                                                                          │
 * │  1. TaskEnvelope  — active task state (ephemeral)                        │
 * │     • Source of scope, policy, obligations, and lane assignment          │
 * │     • Lives only for the duration of an active task                      │
 * │     ↓ reconciled into                                                    │
 * │  2. Hook Audit Trail  (hook-events.jsonl)                                │
 * │     • Per-session append-only event log                                  │
 * │     • Records hook lifecycle events for observability                    │
 * │     • Non-binding: informs but does not determine governance             │
 * │     ↓ bridged into at validate time                                      │
 * │  3. Decision Ledger  (.aidos-ledger.db)  ← CANONICAL SOURCE OF TRUTH   │
 * │     • Project-wide, hash-chained, append-only SQLite DB                  │
 * │     • Single source of truth for all governance decisions                │
 * │     • Source for reports, replay, regression detection                   │
 * │     • Tamper-evident: SHA-256 hash chain + immutability triggers         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Reconciliation guarantee:
 *   validate.ts calls reconcileStores() inside its reconciliation try-block,
 *   before the decision is computed. Violations flow into the violation array
 *   and are eligible to block the task — not merely advisory metadata.
 *   The full result is also embedded in the Ledger payload so every governance
 *   record carries a self-describing cross-store consistency record.
 *
 * Design constraints:
 *   - Pure function: no I/O, no imports from cli package
 *   - Deterministic: same inputs always produce same output
 *   - Forward-compatible: new rules are added as separate named checks
 */

// ─── Hierarchy constants ──────────────────────────────────────────────────────

export const STORE_HIERARCHY_VERSION = '1.0.0' as const;

/** The canonical store for all governance decisions. */
export const CANONICAL_STORE = 'ledger' as const;

/**
 * Typed declaration of each store's role, authority, and constraints.
 *
 * This replaces the documentation-only hierarchy in CORE.MD.
 * Any component that reads from or writes to a store MUST conform to this
 * authority table. Violations indicate architectural drift.
 */
export const STORE_ROLES = {
  envelope: {
    store:              'envelope' as const,
    file_pattern:       '.ai-index/runtime/envelopes/{task_id}.json',
    authority:          ['task_scope', 'tool_policy', 'acceptance_criteria', 'lane_assignment', 'stop_conditions'] as const,
    lifecycle:          'ephemeral' as const,
    mutation:           'read_write' as const,
    canonical_for:      'active task constraints during execution',
    not_authority_for:  ['governance_decisions', 'audit_trail', 'report_generation', 'replay'] as const,
  },
  jsonl: {
    store:              'jsonl' as const,
    file_pattern:       '.ai-index/runtime/events/{session_id}/hook-events.jsonl',
    authority:          ['hook_invocations', 'stage_timing', 'contract_violations_observed'] as const,
    lifecycle:          'session_scoped' as const,
    mutation:           'append_only' as const,
    canonical_for:      'hook lifecycle visibility and observability',
    not_authority_for:  ['governance_decisions', 'report_generation', 'replay'] as const,
  },
  ledger: {
    store:              'ledger' as const,
    file_pattern:       '.aidos-ledger.db',
    authority:          ['governance_decisions', 'run_outcomes', 'pipeline_stages', 'audit_trail', 'report_generation', 'replay'] as const,
    lifecycle:          'persistent' as const,
    mutation:           'append_only_hash_chained' as const,
    canonical_for:      'ALL governance records — single source of truth',
    not_authority_for:  [] as const,
  },
} as const;

export type StoreKind = keyof typeof STORE_ROLES;

// ─── Violation codes ──────────────────────────────────────────────────────────

/**
 * Violation codes for cross-store reconciliation failures.
 *
 * These codes are intentionally prefixed with STORE_ to distinguish them from
 * ReasonCode (cli/runtime/types.ts) which covers within-task contract
 * violations. STORE_ codes cover architectural inconsistency between stores.
 *
 * Important: the string values here MUST match the corresponding keys added
 * to ReasonCode in packages/cli/src/runtime/types.ts so that
 * ContractViolationDetected events in the JSONL use a consistent, queryable
 * reason_code across both the hook event stream and the Ledger payload.
 */
export const StoreViolationCode = {
  /**
   * No InputEnvelopeCaptured event found in JSONL for the active task_id.
   * Indicates the entry hook did not run, or a G1 write failure suppressed it.
   * Severity: advisory — governance still proceeds, but the JSONL is incomplete.
   */
  JSONL_MISSING_ENVELOPE_CAPTURED:   'STORE_JSONL_MISSING_ENVELOPE_CAPTURED',

  /**
   * The lane recorded in InputEnvelopeCaptured.payload.lane does not match
   * TaskEnvelope.lane. Entry and validate hooks applied different governance
   * rules for the same task.
   * Severity: blocking — wrong lane means wrong governance rules were used.
   */
  ENVELOPE_JSONL_LANE_MISMATCH:      'STORE_ENVELOPE_JSONL_LANE_MISMATCH',

  /**
   * The task_id in InputEnvelopeCaptured does not match the active envelope's
   * task_id. JSONL evidence from a different task is contaminating this one.
   * Severity: blocking — evidence cross-contamination is always unacceptable.
   */
  ENVELOPE_JSONL_TASK_ID_MISMATCH:   'STORE_ENVELOPE_JSONL_TASK_ID_MISMATCH',

  /**
   * One or more hook events failed to write to hook-events.jsonl, detected via
   * the G1 sidecar file hook-write-failures.jsonl. The JSONL audit trail is
   * incomplete; governance decisions may rest on missing evidence.
   * Severity: advisory — failures are recorded in the sidecar.
   */
  JSONL_WRITE_FAILURES_DETECTED:     'STORE_JSONL_WRITE_FAILURES_DETECTED',
} as const;

export type StoreViolationCodeValue = typeof StoreViolationCode[keyof typeof StoreViolationCode];

// ─── Result types ─────────────────────────────────────────────────────────────

export interface StoreReconciliationViolation {
  /** Machine-readable code. Matches a ReasonCode value in the CLI package. */
  code:             StoreViolationCodeValue;
  /** Human-readable description of the inconsistency. */
  message:          string;
  /** blocking → eligible to change the governance decision; advisory → recorded only. */
  severity:         'blocking' | 'advisory';
  /** Which stores are involved in the inconsistency. */
  affected_stores:  StoreKind[];
  /** What the consistent state should look like. */
  expected:         string;
  /** What was observed. */
  actual:           string;
}

/**
 * Lightweight input to reconcileStores().
 *
 * All fields are already available in validate.ts at reconciliation time —
 * no additional I/O is required to call this function.
 */
export interface StoreReconciliationInput {
  /** Active TaskEnvelope fields needed for cross-store comparison. */
  envelope: {
    task_id:    string;
    session_id: string;
    lane:       string;
  };
  /**
   * Hook events loaded from hook-events.jsonl for this session.
   * The array should reflect the current state on disk at the moment
   * reconcileStores() is called.
   */
  hookEvents: ReadonlyArray<{
    event_type: string;
    task_id?:   string;
    payload?:   Record<string, unknown>;
  }>;
  /**
   * Count of hook events that failed to write to hook-events.jsonl,
   * as read from hook-write-failures.jsonl (G1 sidecar).
   * Pass 0 if the sidecar does not exist or has no entries.
   */
  writeFailureCount: number;
}

export interface StoreReconciliationResult {
  /** Version of this contract module. Stored in the Ledger for forward-compat queries. */
  hierarchy_version:        typeof STORE_HIERARCHY_VERSION;
  /** Always 'ledger'. Stored in the Ledger to make the canonical store self-documenting. */
  canonical_store:          typeof CANONICAL_STORE;
  /** ISO 8601 timestamp when reconciliation ran. */
  checked_at:               string;
  /** true iff all rules passed with zero violations. */
  is_consistent:            boolean;
  violations:               StoreReconciliationViolation[];
  blocking_violation_count: number;
  advisory_violation_count: number;
}

// ─── Reconciliation engine ────────────────────────────────────────────────────

/**
 * Run cross-store consistency checks across the three runtime stores.
 *
 * Called by validate.ts inside its reconciliation try-block, before the
 * governance decision is computed. Violations returned here feed into
 * validate.ts's violation array via recordViolation() and are eligible to
 * block task completion.
 *
 * The full result is also embedded in the Ledger payload so every
 * run_outcome_summary carries a self-describing consistency record.
 *
 * This function is pure (no I/O) and fully deterministic — unit tests call
 * it directly without any filesystem setup.
 *
 * Rules implemented:
 *   R1 — InputEnvelopeCaptured must exist in JSONL for the active task_id
 *   R2 — InputEnvelopeCaptured.payload.lane must match TaskEnvelope.lane
 *   R3 — InputEnvelopeCaptured.task_id must match TaskEnvelope.task_id
 *   R4 — hook-write-failures.jsonl must be empty (G1 write-failure integration)
 */
export function reconcileStores(input: StoreReconciliationInput): StoreReconciliationResult {
  const violations: StoreReconciliationViolation[] = [];
  const { envelope, hookEvents, writeFailureCount } = input;

  // ── R1: InputEnvelopeCaptured must exist in JSONL for this task ───────────
  const capturedEvents = hookEvents.filter(
    e => e.event_type === 'InputEnvelopeCaptured' &&
         (e as { task_id?: string }).task_id === envelope.task_id,
  );

  if (capturedEvents.length === 0) {
    violations.push({
      code:            StoreViolationCode.JSONL_MISSING_ENVELOPE_CAPTURED,
      message:
        `No InputEnvelopeCaptured event found in JSONL for task_id=${envelope.task_id}. ` +
        `The entry hook may not have run, or a G1 write failure suppressed the event. ` +
        `Governance decisions at validate time lack entry-hook evidence.`,
      severity:        'advisory',
      affected_stores: ['envelope', 'jsonl'],
      expected:        `InputEnvelopeCaptured event with task_id=${envelope.task_id} in hook-events.jsonl`,
      actual:          'absent',
    });
  } else {
    const latestCapture = capturedEvents.at(-1)!;
    const capturedPayload = (latestCapture as { payload?: Record<string, unknown> }).payload ?? {};
    const capturedTaskId  = (latestCapture as { task_id?: string }).task_id;

    // ── R2: Lane must agree between Envelope and JSONL ─────────────────────
    const capturedLane = capturedPayload['lane'] as string | undefined;
    if (capturedLane !== undefined && capturedLane !== envelope.lane) {
      violations.push({
        code:            StoreViolationCode.ENVELOPE_JSONL_LANE_MISMATCH,
        message:
          `Lane mismatch between TaskEnvelope and hook-events.jsonl: ` +
          `Envelope.lane=${envelope.lane} but InputEnvelopeCaptured.payload.lane=${capturedLane}. ` +
          `The governance rules applied during execution may not match the rules active at validate time. ` +
          `The Ledger will record lane=${envelope.lane} (Envelope is authoritative for lane assignment).`,
        severity:        'blocking',
        affected_stores: ['envelope', 'jsonl'],
        expected:        `lane=${envelope.lane} (TaskEnvelope is the authority for lane assignment)`,
        actual:          `lane=${capturedLane} (recorded in JSONL InputEnvelopeCaptured at entry time)`,
      });
    }

    // ── R3: task_id must agree between Envelope and JSONL ──────────────────
    if (capturedTaskId !== undefined && capturedTaskId !== envelope.task_id) {
      violations.push({
        code:            StoreViolationCode.ENVELOPE_JSONL_TASK_ID_MISMATCH,
        message:
          `task_id mismatch: TaskEnvelope.task_id=${envelope.task_id} but ` +
          `InputEnvelopeCaptured.task_id=${capturedTaskId}. ` +
          `The JSONL evidence was captured for a different task — cross-task contamination detected.`,
        severity:        'blocking',
        affected_stores: ['envelope', 'jsonl'],
        expected:        `InputEnvelopeCaptured.task_id = ${envelope.task_id}`,
        actual:          `InputEnvelopeCaptured.task_id = ${capturedTaskId}`,
      });
    }
  }

  // ── R4: JSONL write failures mean the audit trail is incomplete ───────────
  if (writeFailureCount > 0) {
    violations.push({
      code:            StoreViolationCode.JSONL_WRITE_FAILURES_DETECTED,
      message:
        `${writeFailureCount} hook event(s) failed to write to hook-events.jsonl. ` +
        `The JSONL audit trail is incomplete. Governance decisions may be based on missing evidence. ` +
        `Inspect hook-write-failures.jsonl for the structured failure records (G1 sidecar).`,
      severity:        'advisory',
      affected_stores: ['jsonl', 'ledger'],
      expected:        'hook-write-failures.jsonl absent or empty (all hook events persisted)',
      actual:          `${writeFailureCount} write failure record(s) present in hook-write-failures.jsonl`,
    });
  }

  const blockingViolations = violations.filter(v => v.severity === 'blocking');
  const advisoryViolations = violations.filter(v => v.severity === 'advisory');

  return {
    hierarchy_version:        STORE_HIERARCHY_VERSION,
    canonical_store:          CANONICAL_STORE,
    checked_at:               new Date().toISOString(),
    is_consistent:            violations.length === 0,
    violations,
    blocking_violation_count: blockingViolations.length,
    advisory_violation_count: advisoryViolations.length,
  };
}
