/**
 * Evidence Integrity — Unit Tests  (G4 fix)
 *
 * Tests for packages/core/src/runtime/evidence-integrity.ts
 *
 * All tests exercise the pure checkEvidenceIntegrity() function — no filesystem
 * I/O, no mocks, no async. The function is fully deterministic.
 *
 * Coverage:
 *   EV1 — EVIDENCE_ENTRY_HOOK_MISSING (entry hook did not run, zero write failures)
 *   EV2 — EVIDENCE_TOTAL_ENTRY_LOSS   (entry events absent + write failures)
 *   EV3 — EVIDENCE_EXECUTION_EVIDENCE_LOST (write failures + zero trace events + obligations)
 *   EV1/EV2 mutual exclusion
 *   Lane-based severity (A = advisory, B/C = blocking)
 *   ReasonCode alignment: EVIDENCE_* string literals
 *   EvidenceIntegrityResult shape (is_sufficient, counts, checked_at)
 */

import { describe, it, expect } from 'vitest';

import {
  checkEvidenceIntegrity,
  EVIDENCE_INTEGRITY_VERSION,
  EvidenceViolationCode,
  type EvidenceIntegrityInput,
} from '../packages/core/src/runtime/evidence-integrity.js';

import { ReasonCode } from '../packages/cli/src/runtime/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal entry-stage event set (entry hook ran cleanly) */
const entryHookStartedEvent = {
  event_type: 'HookInvocationStarted',
  hook_stage: 'entry',
  task_id:    'task_test_001',
};

const entryCapture = {
  event_type: 'InputEnvelopeCaptured',
  hook_stage: 'entry',
  task_id:    'task_test_001',
};

/** A validate-stage event (always present — added by validate.ts itself) */
const validateStartedEvent = {
  event_type: 'HookInvocationStarted',
  hook_stage: 'validate',
  task_id:    'task_test_001',
};

function input(overrides: Partial<EvidenceIntegrityInput> = {}): EvidenceIntegrityInput {
  return {
    envelope:                     { task_id: 'task_test_001', lane: 'B' },
    hookEvents:                   [validateStartedEvent],
    traceEventCount:              1,
    writeFailureCount:             0,
    mandatoryVerificationRequired: false,
    ...overrides,
  };
}

// ─── Baseline: clean evidence ─────────────────────────────────────────────────

describe('Clean evidence — no violations', () => {
  it('returns is_sufficient=true with entry events and no write failures', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents: [validateStartedEvent, entryHookStartedEvent, entryCapture],
    }));
    expect(result.is_sufficient).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.blocking_violation_count).toBe(0);
    expect(result.advisory_violation_count).toBe(0);
  });

  it('includes integrity_version and checked_at in result', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents: [validateStartedEvent, entryHookStartedEvent],
    }));
    expect(result.integrity_version).toBe(EVIDENCE_INTEGRITY_VERSION);
    expect(typeof result.checked_at).toBe('string');
    expect(result.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('Lane A with write failures but no entry events → advisory (not blocking)', () => {
    const result = checkEvidenceIntegrity(input({
      envelope:         { task_id: 'task_a', lane: 'A' },
      hookEvents:       [validateStartedEvent],
      writeFailureCount: 2,
    }));
    // EV2 fires but as advisory for Lane A
    const violations = result.violations;
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every(v => v.severity === 'advisory')).toBe(true);
    expect(result.blocking_violation_count).toBe(0);
  });
});

// ─── EV1: Entry hook missing (no write failures) ──────────────────────────────

describe('EV1 — EVIDENCE_ENTRY_HOOK_MISSING', () => {
  it('fires when no entry events AND writeFailureCount=0, Lane B', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],   // validate-only, no entry
      writeFailureCount: 0,
      envelope:          { task_id: 't', lane: 'B' },
    }));
    const ev1 = result.violations.find(v => v.code === EvidenceViolationCode.ENTRY_HOOK_MISSING);
    expect(ev1).toBeDefined();
    expect(ev1!.severity).toBe('blocking');
  });

  it('fires as blocking for Lane C', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 0,
      envelope:          { task_id: 't', lane: 'C' },
    }));
    const ev1 = result.violations.find(v => v.code === EvidenceViolationCode.ENTRY_HOOK_MISSING);
    expect(ev1).toBeDefined();
    expect(ev1!.severity).toBe('blocking');
  });

  it('fires as advisory for Lane A', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 0,
      envelope:          { task_id: 't', lane: 'A' },
    }));
    const ev1 = result.violations.find(v => v.code === EvidenceViolationCode.ENTRY_HOOK_MISSING);
    expect(ev1).toBeDefined();
    expect(ev1!.severity).toBe('advisory');
    expect(result.blocking_violation_count).toBe(0);
  });

  it('does NOT fire when entry events are present', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent, entryHookStartedEvent],
      writeFailureCount: 0,
    }));
    expect(result.violations.find(v => v.code === EvidenceViolationCode.ENTRY_HOOK_MISSING)).toBeUndefined();
  });

  it('does NOT fire when writeFailureCount > 0 (EV2 fires instead)', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 3,
    }));
    expect(result.violations.find(v => v.code === EvidenceViolationCode.ENTRY_HOOK_MISSING)).toBeUndefined();
    expect(result.violations.find(v => v.code === EvidenceViolationCode.TOTAL_ENTRY_LOSS)).toBeDefined();
  });

  it('sets is_sufficient=false and increments blocking_violation_count for Lane B', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 0,
    }));
    expect(result.is_sufficient).toBe(false);
    expect(result.blocking_violation_count).toBe(1);
  });
});

// ─── EV2: Total entry loss (write failures + no entry events) ─────────────────

describe('EV2 — EVIDENCE_TOTAL_ENTRY_LOSS', () => {
  it('fires when no entry events AND writeFailureCount > 0, Lane B', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 2,
      envelope:          { task_id: 't', lane: 'B' },
    }));
    const ev2 = result.violations.find(v => v.code === EvidenceViolationCode.TOTAL_ENTRY_LOSS);
    expect(ev2).toBeDefined();
    expect(ev2!.severity).toBe('blocking');
  });

  it('fires as advisory for Lane A', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 1,
      envelope:          { task_id: 't', lane: 'A' },
    }));
    const ev2 = result.violations.find(v => v.code === EvidenceViolationCode.TOTAL_ENTRY_LOSS);
    expect(ev2).toBeDefined();
    expect(ev2!.severity).toBe('advisory');
    expect(result.blocking_violation_count).toBe(0);
  });

  it('does NOT fire when entry events are present (even with write failures)', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent, entryHookStartedEvent],
      writeFailureCount: 5,
    }));
    expect(result.violations.find(v => v.code === EvidenceViolationCode.TOTAL_ENTRY_LOSS)).toBeUndefined();
  });

  it('does NOT fire when writeFailureCount=0 (EV1 fires instead)', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 0,
    }));
    expect(result.violations.find(v => v.code === EvidenceViolationCode.TOTAL_ENTRY_LOSS)).toBeUndefined();
    expect(result.violations.find(v => v.code === EvidenceViolationCode.ENTRY_HOOK_MISSING)).toBeDefined();
  });

  it('includes writeFailureCount in the message', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 7,
    }));
    const ev2 = result.violations.find(v => v.code === EvidenceViolationCode.TOTAL_ENTRY_LOSS);
    expect(ev2!.message).toContain('7');
  });
});

// ─── EV1/EV2 mutual exclusion ─────────────────────────────────────────────────

describe('EV1 and EV2 are mutually exclusive', () => {
  it('only EV1 fires when writeFailureCount=0 and no entry events', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 0,
    }));
    const codes = result.violations.map(v => v.code);
    expect(codes).toContain(EvidenceViolationCode.ENTRY_HOOK_MISSING);
    expect(codes).not.toContain(EvidenceViolationCode.TOTAL_ENTRY_LOSS);
  });

  it('only EV2 fires when writeFailureCount>0 and no entry events', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent],
      writeFailureCount: 1,
    }));
    const codes = result.violations.map(v => v.code);
    expect(codes).toContain(EvidenceViolationCode.TOTAL_ENTRY_LOSS);
    expect(codes).not.toContain(EvidenceViolationCode.ENTRY_HOOK_MISSING);
  });

  it('neither EV1 nor EV2 fires when entry events are present', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:        [validateStartedEvent, entryHookStartedEvent],
      writeFailureCount: 5,
    }));
    const codes = result.violations.map(v => v.code);
    expect(codes).not.toContain(EvidenceViolationCode.ENTRY_HOOK_MISSING);
    expect(codes).not.toContain(EvidenceViolationCode.TOTAL_ENTRY_LOSS);
  });
});

// ─── EV3: Execution evidence lost ─────────────────────────────────────────────

describe('EV3 — EVIDENCE_EXECUTION_EVIDENCE_LOST', () => {
  it('fires when write failures + zero trace events + mandatoryVerification', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:                    [validateStartedEvent, entryHookStartedEvent],
      writeFailureCount:              3,
      traceEventCount:               0,
      mandatoryVerificationRequired: true,
    }));
    const ev3 = result.violations.find(v => v.code === EvidenceViolationCode.EXECUTION_EVIDENCE_LOST);
    expect(ev3).toBeDefined();
    expect(ev3!.severity).toBe('blocking');
  });

  it('fires when write failures + zero trace events + Lane C', () => {
    const result = checkEvidenceIntegrity(input({
      envelope:                      { task_id: 't', lane: 'C' },
      hookEvents:                    [validateStartedEvent, entryHookStartedEvent],
      writeFailureCount:              1,
      traceEventCount:               0,
      mandatoryVerificationRequired: false,
    }));
    const ev3 = result.violations.find(v => v.code === EvidenceViolationCode.EXECUTION_EVIDENCE_LOST);
    expect(ev3).toBeDefined();
    expect(ev3!.severity).toBe('blocking');
  });

  it('does NOT fire for Lane A with no mandatory verification (no obligations)', () => {
    const result = checkEvidenceIntegrity(input({
      envelope:                      { task_id: 't', lane: 'A' },
      hookEvents:                    [validateStartedEvent, entryHookStartedEvent],
      writeFailureCount:              5,
      traceEventCount:               0,
      mandatoryVerificationRequired: false,
    }));
    expect(result.violations.find(v => v.code === EvidenceViolationCode.EXECUTION_EVIDENCE_LOST)).toBeUndefined();
  });

  it('does NOT fire when traceEventCount > 0 (execution evidence present)', () => {
    const result = checkEvidenceIntegrity(input({
      hookEvents:                    [validateStartedEvent, entryHookStartedEvent],
      writeFailureCount:              3,
      traceEventCount:               4,
      mandatoryVerificationRequired: true,
    }));
    expect(result.violations.find(v => v.code === EvidenceViolationCode.EXECUTION_EVIDENCE_LOST)).toBeUndefined();
  });

  it('does NOT fire when writeFailureCount=0 (LANE_C_EMPTY_TRACE handles zero trace case)', () => {
    const result = checkEvidenceIntegrity(input({
      envelope:                      { task_id: 't', lane: 'C' },
      hookEvents:                    [validateStartedEvent, entryHookStartedEvent],
      writeFailureCount:              0,
      traceEventCount:               0,
      mandatoryVerificationRequired: false,
    }));
    expect(result.violations.find(v => v.code === EvidenceViolationCode.EXECUTION_EVIDENCE_LOST)).toBeUndefined();
  });

  it('is always blocking regardless of lane', () => {
    for (const lane of ['A', 'B', 'C'] as const) {
      const result = checkEvidenceIntegrity(input({
        envelope:                      { task_id: 't', lane },
        hookEvents:                    [validateStartedEvent, entryHookStartedEvent],
        writeFailureCount:              2,
        traceEventCount:               0,
        mandatoryVerificationRequired: true,
      }));
      const ev3 = result.violations.find(v => v.code === EvidenceViolationCode.EXECUTION_EVIDENCE_LOST);
      expect(ev3?.severity).toBe('blocking');
    }
  });
});

// ─── Multi-violation combinations ────────────────────────────────────────────

describe('Multi-violation combinations', () => {
  it('EV2 + EV3 can fire together (entry loss AND execution loss)', () => {
    const result = checkEvidenceIntegrity(input({
      envelope:                      { task_id: 't', lane: 'B' },
      hookEvents:                    [validateStartedEvent],  // only validate events
      writeFailureCount:              3,
      traceEventCount:               0,
      mandatoryVerificationRequired: true,
    }));
    const codes = result.violations.map(v => v.code);
    expect(codes).toContain(EvidenceViolationCode.TOTAL_ENTRY_LOSS);     // EV2
    expect(codes).toContain(EvidenceViolationCode.EXECUTION_EVIDENCE_LOST); // EV3
    expect(result.blocking_violation_count).toBe(2);
  });

  it('EV1 + EV3 can fire together (entry missing AND execution loss)', () => {
    // EV1: no entry events, no write failures
    // EV3: zero trace events, write failures — but EV1 requires write failures = 0
    // So EV1 + EV3 cannot co-occur (EV3 requires writeFailureCount > 0).
    // This test confirms EV1 and EV3 cannot fire simultaneously.
    const result = checkEvidenceIntegrity(input({
      envelope:                      { task_id: 't', lane: 'C' },
      hookEvents:                    [validateStartedEvent],
      writeFailureCount:              0,
      traceEventCount:               0,
      mandatoryVerificationRequired: true,
    }));
    const codes = result.violations.map(v => v.code);
    // EV1 fires (no write failures, no entry)
    expect(codes).toContain(EvidenceViolationCode.ENTRY_HOOK_MISSING);
    // EV3 CANNOT fire (requires writeFailureCount > 0)
    expect(codes).not.toContain(EvidenceViolationCode.EXECUTION_EVIDENCE_LOST);
  });

  it('all three checks pass cleanly for a well-formed evidence set', () => {
    const result = checkEvidenceIntegrity(input({
      envelope:                      { task_id: 't', lane: 'C' },
      hookEvents:                    [validateStartedEvent, entryHookStartedEvent, entryCapture],
      writeFailureCount:              0,
      traceEventCount:               3,
      mandatoryVerificationRequired: true,
    }));
    expect(result.is_sufficient).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ─── ReasonCode alignment ─────────────────────────────────────────────────────

describe('ReasonCode ↔ EvidenceViolationCode alignment', () => {
  it('EVIDENCE_ENTRY_HOOK_MISSING string values match in both enums', () => {
    expect(EvidenceViolationCode.ENTRY_HOOK_MISSING)
      .toBe(ReasonCode.EVIDENCE_ENTRY_HOOK_MISSING);
  });

  it('EVIDENCE_TOTAL_ENTRY_LOSS string values match in both enums', () => {
    expect(EvidenceViolationCode.TOTAL_ENTRY_LOSS)
      .toBe(ReasonCode.EVIDENCE_TOTAL_ENTRY_LOSS);
  });

  it('EVIDENCE_EXECUTION_EVIDENCE_LOST string values match in both enums', () => {
    expect(EvidenceViolationCode.EXECUTION_EVIDENCE_LOST)
      .toBe(ReasonCode.EVIDENCE_EXECUTION_EVIDENCE_LOST);
  });

  it('All three EVIDENCE_* codes are present in ReasonCode', () => {
    const rcValues = Object.values(ReasonCode) as string[];
    expect(rcValues).toContain('EVIDENCE_ENTRY_HOOK_MISSING');
    expect(rcValues).toContain('EVIDENCE_TOTAL_ENTRY_LOSS');
    expect(rcValues).toContain('EVIDENCE_EXECUTION_EVIDENCE_LOST');
  });

  it('No EVIDENCE_* code collides with another ReasonCode value', () => {
    const evidenceCodes = [
      ReasonCode.EVIDENCE_ENTRY_HOOK_MISSING,
      ReasonCode.EVIDENCE_TOTAL_ENTRY_LOSS,
      ReasonCode.EVIDENCE_EXECUTION_EVIDENCE_LOST,
    ] as const;
    const allValues = Object.values(ReasonCode) as string[];
    for (const code of evidenceCodes) {
      const count = allValues.filter(v => v === code).length;
      expect(count).toBe(1);
    }
  });
});

// ─── EvidenceViolationCode constants ─────────────────────────────────────────

describe('EvidenceViolationCode constants', () => {
  it('ENTRY_HOOK_MISSING has the expected string literal', () => {
    expect(EvidenceViolationCode.ENTRY_HOOK_MISSING).toBe('EVIDENCE_ENTRY_HOOK_MISSING');
  });

  it('TOTAL_ENTRY_LOSS has the expected string literal', () => {
    expect(EvidenceViolationCode.TOTAL_ENTRY_LOSS).toBe('EVIDENCE_TOTAL_ENTRY_LOSS');
  });

  it('EXECUTION_EVIDENCE_LOST has the expected string literal', () => {
    expect(EvidenceViolationCode.EXECUTION_EVIDENCE_LOST).toBe('EVIDENCE_EXECUTION_EVIDENCE_LOST');
  });

  it('EVIDENCE_INTEGRITY_VERSION is a semver string', () => {
    expect(EVIDENCE_INTEGRITY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
