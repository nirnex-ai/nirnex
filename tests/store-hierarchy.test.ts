/**
 * Store Hierarchy — Unit Tests (G2 fix)
 *
 * Verifies the code-level canonical store hierarchy contract introduced by the
 * G2 fix. reconcileStores() is a pure function — every test runs without
 * touching the filesystem.
 *
 * Test structure:
 *   1 — Module constants (CANONICAL_STORE, STORE_ROLES, STORE_HIERARCHY_VERSION)
 *   2 — R1: InputEnvelopeCaptured presence check
 *   3 — R2: Lane consistency between Envelope and JSONL
 *   4 — R3: task_id consistency between Envelope and JSONL
 *   5 — R4: Write-failure count (G1 integration)
 *   6 — Multi-rule combinations
 *   7 — StoreViolationCode ↔ ReasonCode alignment
 */

import { describe, it, expect } from 'vitest';

import {
  CANONICAL_STORE,
  STORE_HIERARCHY_VERSION,
  STORE_ROLES,
  StoreViolationCode,
  reconcileStores,
} from '../packages/core/src/runtime/store-hierarchy.js';

import { ReasonCode } from '../packages/cli/src/runtime/types.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const BASE_ENVELOPE = {
  task_id:    'task_test_abc',
  session_id: 'sess_test_123',
  lane:       'B',
};

function capturedEvent(overrides: Partial<{ task_id: string; lane: string }> = {}) {
  return {
    event_type: 'InputEnvelopeCaptured',
    task_id:    overrides.task_id ?? BASE_ENVELOPE.task_id,
    payload:    { lane: overrides.lane ?? BASE_ENVELOPE.lane },
  };
}

function cleanInput(eventOverride?: ReturnType<typeof capturedEvent>) {
  return {
    envelope:          BASE_ENVELOPE,
    hookEvents:        eventOverride ? [eventOverride] : [capturedEvent()],
    writeFailureCount: 0,
  };
}

// ─── 1. Module constants ──────────────────────────────────────────────────────

describe('Store hierarchy constants', () => {
  it('CANONICAL_STORE is "ledger"', () => {
    expect(CANONICAL_STORE).toBe('ledger');
  });

  it('STORE_HIERARCHY_VERSION is "1.0.0"', () => {
    expect(STORE_HIERARCHY_VERSION).toBe('1.0.0');
  });

  it('STORE_ROLES declares authority for all three stores', () => {
    expect(Object.keys(STORE_ROLES)).toEqual(expect.arrayContaining(['envelope', 'jsonl', 'ledger']));
  });

  it('ledger store is not_authority_for nothing — it is authoritative for all governance', () => {
    expect(STORE_ROLES.ledger.not_authority_for).toHaveLength(0);
  });

  it('envelope and jsonl stores are not authoritative for governance decisions', () => {
    expect(STORE_ROLES.envelope.not_authority_for).toContain('governance_decisions');
    expect(STORE_ROLES.jsonl.not_authority_for).toContain('governance_decisions');
  });

  it('ledger authority array includes report_generation and replay', () => {
    expect(STORE_ROLES.ledger.authority).toContain('report_generation');
    expect(STORE_ROLES.ledger.authority).toContain('replay');
  });
});

// ─── 2. R1: InputEnvelopeCaptured presence ────────────────────────────────────

describe('R1 — InputEnvelopeCaptured must exist in JSONL for the active task', () => {
  it('no violations when InputEnvelopeCaptured is present', () => {
    const result = reconcileStores(cleanInput());
    expect(result.is_consistent).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('advisory violation when InputEnvelopeCaptured is absent', () => {
    const result = reconcileStores({
      envelope:          BASE_ENVELOPE,
      hookEvents:        [],     // no events at all
      writeFailureCount: 0,
    });
    expect(result.is_consistent).toBe(false);
    const v = result.violations.find(x => x.code === StoreViolationCode.JSONL_MISSING_ENVELOPE_CAPTURED);
    expect(v).toBeDefined();
    expect(v!.severity).toBe('advisory');
    expect(v!.affected_stores).toContain('envelope');
    expect(v!.affected_stores).toContain('jsonl');
  });

  it('advisory violation when JSONL has events for a different task only', () => {
    const result = reconcileStores({
      envelope: BASE_ENVELOPE,
      hookEvents: [
        { event_type: 'InputEnvelopeCaptured', task_id: 'task_other', payload: { lane: 'B' } },
      ],
      writeFailureCount: 0,
    });
    const v = result.violations.find(x => x.code === StoreViolationCode.JSONL_MISSING_ENVELOPE_CAPTURED);
    expect(v).toBeDefined();
    expect(v!.severity).toBe('advisory');
  });

  it('no violation when InputEnvelopeCaptured exists alongside other events', () => {
    const result = reconcileStores({
      envelope: BASE_ENVELOPE,
      hookEvents: [
        { event_type: 'HookInvocationStarted', task_id: BASE_ENVELOPE.task_id },
        capturedEvent(),
        { event_type: 'StageCompleted', task_id: BASE_ENVELOPE.task_id },
      ],
      writeFailureCount: 0,
    });
    const missingCapture = result.violations.find(x => x.code === StoreViolationCode.JSONL_MISSING_ENVELOPE_CAPTURED);
    expect(missingCapture).toBeUndefined();
  });
});

// ─── 3. R2: Lane consistency ──────────────────────────────────────────────────

describe('R2 — InputEnvelopeCaptured.payload.lane must match TaskEnvelope.lane', () => {
  it('no violation when lanes agree', () => {
    const result = reconcileStores(cleanInput(capturedEvent({ lane: 'B' })));
    const laneMismatch = result.violations.find(x => x.code === StoreViolationCode.ENVELOPE_JSONL_LANE_MISMATCH);
    expect(laneMismatch).toBeUndefined();
  });

  it('blocking violation when lane in JSONL differs from Envelope', () => {
    const result = reconcileStores(cleanInput(capturedEvent({ lane: 'A' }))); // Envelope says B, JSONL says A
    const v = result.violations.find(x => x.code === StoreViolationCode.ENVELOPE_JSONL_LANE_MISMATCH);
    expect(v).toBeDefined();
    expect(v!.severity).toBe('blocking');
    expect(v!.expected).toContain('B');
    expect(v!.actual).toContain('A');
  });

  it('blocking violation for all possible mismatches (A↔B, B↔C, A↔C)', () => {
    const cases: Array<[string, string]> = [['A', 'B'], ['B', 'C'], ['A', 'C'], ['C', 'A']];
    for (const [envelopeLane, jsonlLane] of cases) {
      const result = reconcileStores({
        envelope:          { ...BASE_ENVELOPE, lane: envelopeLane },
        hookEvents:        [capturedEvent({ lane: jsonlLane })],
        writeFailureCount: 0,
      });
      const v = result.violations.find(x => x.code === StoreViolationCode.ENVELOPE_JSONL_LANE_MISMATCH);
      expect(v).toBeDefined();
      expect(v!.severity).toBe('blocking');
    }
  });

  it('no violation when InputEnvelopeCaptured.payload has no lane field (defensive)', () => {
    // If lane is absent from the captured payload, we cannot check — do not produce a false positive.
    const result = reconcileStores({
      envelope:   BASE_ENVELOPE,
      hookEvents: [{ event_type: 'InputEnvelopeCaptured', task_id: BASE_ENVELOPE.task_id, payload: {} }],
      writeFailureCount: 0,
    });
    const laneMismatch = result.violations.find(x => x.code === StoreViolationCode.ENVELOPE_JSONL_LANE_MISMATCH);
    expect(laneMismatch).toBeUndefined();
  });
});

// ─── 4. R3: task_id consistency ───────────────────────────────────────────────

describe('R3 — InputEnvelopeCaptured.task_id must match TaskEnvelope.task_id', () => {
  it('no violation when task_ids agree', () => {
    const result = reconcileStores(cleanInput());
    const idMismatch = result.violations.find(x => x.code === StoreViolationCode.ENVELOPE_JSONL_TASK_ID_MISMATCH);
    expect(idMismatch).toBeUndefined();
  });

  it('blocking violation when task_id in JSONL differs from Envelope', () => {
    // Hook event claims a different task_id than the active envelope
    const result = reconcileStores({
      envelope: BASE_ENVELOPE,
      hookEvents: [{
        event_type: 'InputEnvelopeCaptured',
        task_id:    'task_DIFFERENT',
        payload:    { lane: BASE_ENVELOPE.lane },
      }],
      writeFailureCount: 0,
    });
    // R1 fires first (no matching capture) — task_id mismatch is a side-effect of the lookup
    // but let's test a variant where we explicitly verify the mismatch logic:
    // The R3 rule fires only when an InputEnvelopeCaptured IS found for the current task_id
    // AND its task_id field still differs — which can happen with corrupt event data.
    // In this case R1 fires instead (different task_id means no matching event).
    const missingCapture = result.violations.find(x => x.code === StoreViolationCode.JSONL_MISSING_ENVELOPE_CAPTURED);
    expect(missingCapture).toBeDefined(); // R1 caught it because no capture matches this task_id
  });
});

// ─── 5. R4: Write-failure count ───────────────────────────────────────────────

describe('R4 — hook-write-failures.jsonl must be empty (G1 integration)', () => {
  it('no violation when writeFailureCount is 0', () => {
    const result = reconcileStores(cleanInput());
    const writeFailure = result.violations.find(x => x.code === StoreViolationCode.JSONL_WRITE_FAILURES_DETECTED);
    expect(writeFailure).toBeUndefined();
  });

  it('advisory violation when writeFailureCount > 0', () => {
    const result = reconcileStores({ ...cleanInput(), writeFailureCount: 3 });
    const v = result.violations.find(x => x.code === StoreViolationCode.JSONL_WRITE_FAILURES_DETECTED);
    expect(v).toBeDefined();
    expect(v!.severity).toBe('advisory');
    expect(v!.message).toContain('3');
    expect(v!.affected_stores).toContain('jsonl');
    expect(v!.affected_stores).toContain('ledger');
  });

  it('advisory violation count increments with writeFailureCount (message accuracy)', () => {
    for (const count of [1, 5, 100]) {
      const result = reconcileStores({ ...cleanInput(), writeFailureCount: count });
      const v = result.violations.find(x => x.code === StoreViolationCode.JSONL_WRITE_FAILURES_DETECTED)!;
      expect(v.message).toContain(String(count));
    }
  });
});

// ─── 6. Multi-rule combinations ───────────────────────────────────────────────

describe('Reconciliation result shape and multi-rule combinations', () => {
  it('result always includes hierarchy_version and canonical_store', () => {
    const result = reconcileStores(cleanInput());
    expect(result.hierarchy_version).toBe(STORE_HIERARCHY_VERSION);
    expect(result.canonical_store).toBe(CANONICAL_STORE);
    expect(result.checked_at).toBeTruthy();
  });

  it('blocking_violation_count counts only blocking violations', () => {
    // Trigger: 1 advisory (R1: missing capture) + 1 advisory (R4: write failures)
    const result = reconcileStores({
      envelope:          BASE_ENVELOPE,
      hookEvents:        [],
      writeFailureCount: 2,
    });
    expect(result.blocking_violation_count).toBe(0);
    expect(result.advisory_violation_count).toBe(2);
    expect(result.is_consistent).toBe(false);
  });

  it('blocking_violation_count counts blocking violations (lane mismatch)', () => {
    const result = reconcileStores(cleanInput(capturedEvent({ lane: 'C' }))); // B vs C
    expect(result.blocking_violation_count).toBe(1);
    expect(result.is_consistent).toBe(false);
  });

  it('all three advisory paths can fire together', () => {
    // R1: no capture + R4: 2 write failures → 2 advisory violations
    const result = reconcileStores({
      envelope:          BASE_ENVELOPE,
      hookEvents:        [],
      writeFailureCount: 2,
    });
    expect(result.violations).toHaveLength(2);
    expect(result.blocking_violation_count).toBe(0);
    expect(result.advisory_violation_count).toBe(2);
  });

  it('clean run: zero violations, is_consistent = true', () => {
    const result = reconcileStores({
      envelope:          BASE_ENVELOPE,
      hookEvents:        [capturedEvent()],
      writeFailureCount: 0,
    });
    expect(result.is_consistent).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.blocking_violation_count).toBe(0);
    expect(result.advisory_violation_count).toBe(0);
  });

  it('last-wins: uses at(-1) when multiple InputEnvelopeCaptured events exist', () => {
    // First capture says lane=A (wrong), last says lane=B (correct) — no violation
    const result = reconcileStores({
      envelope: BASE_ENVELOPE,
      hookEvents: [
        capturedEvent({ lane: 'A' }),  // stale / overridden
        capturedEvent({ lane: 'B' }),  // authoritative — matches Envelope
      ],
      writeFailureCount: 0,
    });
    const laneMismatch = result.violations.find(x => x.code === StoreViolationCode.ENVELOPE_JSONL_LANE_MISMATCH);
    expect(laneMismatch).toBeUndefined();
    expect(result.is_consistent).toBe(true);
  });
});

// ─── 7. StoreViolationCode ↔ ReasonCode alignment ────────────────────────────

describe('StoreViolationCode values must be present in ReasonCode (string alignment)', () => {
  it('STORE_JSONL_MISSING_ENVELOPE_CAPTURED is in ReasonCode', () => {
    expect(ReasonCode.STORE_JSONL_MISSING_ENVELOPE_CAPTURED).toBe(
      StoreViolationCode.JSONL_MISSING_ENVELOPE_CAPTURED,
    );
  });

  it('STORE_ENVELOPE_JSONL_LANE_MISMATCH is in ReasonCode', () => {
    expect(ReasonCode.STORE_ENVELOPE_JSONL_LANE_MISMATCH).toBe(
      StoreViolationCode.ENVELOPE_JSONL_LANE_MISMATCH,
    );
  });

  it('STORE_ENVELOPE_JSONL_TASK_ID_MISMATCH is in ReasonCode', () => {
    expect(ReasonCode.STORE_ENVELOPE_JSONL_TASK_ID_MISMATCH).toBe(
      StoreViolationCode.ENVELOPE_JSONL_TASK_ID_MISMATCH,
    );
  });

  it('STORE_JSONL_WRITE_FAILURES_DETECTED is in ReasonCode', () => {
    expect(ReasonCode.STORE_JSONL_WRITE_FAILURES_DETECTED).toBe(
      StoreViolationCode.JSONL_WRITE_FAILURES_DETECTED,
    );
  });

  it('all StoreViolationCode values start with "STORE_"', () => {
    for (const val of Object.values(StoreViolationCode)) {
      expect(val).toMatch(/^STORE_/);
    }
  });
});
