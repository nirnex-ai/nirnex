/**
 * Governance Bugfix Tests — Production Feedback Analysis
 *
 * Three bugs identified from a production hook-log where Nirnex produced
 * incorrect results on a project that ran `npm run lint` successfully:
 *
 * Bug 1 — G3 idempotency guard returns `allow` after a BLOCK decision.
 *   isEnvelopeFinalized() checked only `finalized_at` presence, not `status`.
 *   A `status=failed` (block outcome) envelope was treated as "finalized" and
 *   the G3 path returned `allow` — the opposite of the original decision.
 *
 *   Fix: isEnvelopeFinalized() requires BOTH finalized_at AND status==='completed'.
 *        Block-path validate.ts must NOT set finalized_at on the envelope.
 *
 * Bug 2 — Report confidence inconsistency: overall_confidence=0, final_confidence=40.
 *   assembler.ts pulled overall_confidence from confidence_snapshot ledger events.
 *   When none exist (new project, no knowledge graph), it defaulted to 0 even
 *   though the run_outcome_summary contained final_confidence=40.
 *
 *   Fix: fall back to run_outcome_summary.final_confidence when no snapshot exists.
 *
 * Bug 3 — VERIFICATION_REQUIRED_NOT_RUN fires for direct node tool invocations.
 *   The verification heuristic only covered `npm run`, `yarn run`, `jest`, etc.
 *   Direct invocations like `node node_modules/.bin/eslint .` and
 *   `./node_modules/.bin/eslint .` (npx equivalents) were not recognised.
 *
 *   Fix: extend VERIFICATION_PATTERN (attestation.ts) with a direct-invocation arm
 *        that matches `node .../eslint`, `./node_modules/.bin/vitest`, etc.
 *
 * All tests are written BEFORE the implementation (TDD).
 * Tests must fail on the original code and pass after the fix.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

import { isEnvelopeFinalized } from '../packages/cli/src/runtime/session.js';
import { isBashVerificationCommand } from '../packages/cli/src/runtime/attestation.js';
import { assembleReport } from '../packages/core/src/runtime/reporting/assembler.js';
import type { TaskEnvelope } from '../packages/cli/src/runtime/types.js';
import type { LedgerEntry } from '../packages/core/src/runtime/ledger/types.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function baseEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    task_id:    `task_${randomUUID().slice(0, 8)}`,
    session_id: `sess_${randomUUID().slice(0, 8)}`,
    created_at: new Date().toISOString(),
    prompt:     'test prompt',
    lane:       'B',
    scope:      { allowed_paths: [], blocked_paths: [], modules_expected: [] },
    constraints:         [],
    acceptance_criteria: [],
    tool_policy:         { allowed_tools: [], requires_guard: [], denied_patterns: [] },
    stop_conditions:     { required_validations: [], forbidden_files: [] },
    confidence:          { score: 80, label: 'high', penalties: [] },
    eco_summary: {
      intent: 'test', recommended_lane: 'B',
      forced_unknown: false, blocked: false,
      escalation_reasons: [], boundary_warnings: [],
    },
    status: 'active',
    ...overrides,
  };
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const ts = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    ledger_id:      randomUUID(),
    trace_id:       'trace_bugfix_test',
    request_id:     'req_bugfix_test',
    session_id:     'sess_bugfix_test',
    timestamp:      ts,
    stage:          'outcome',
    record_type:    'run_outcome_summary',
    actor:          'system',
    payload:        {} as LedgerEntry['payload'],
    ...overrides,
  };
}

// ─── Bug 1: G3 idempotency guard — block-outcome envelope must NOT be finalized ──

describe('Bug 1 — isEnvelopeFinalized: block-outcome envelopes must not be treated as finalized', () => {
  it('B1.1 returns false when status="failed" and finalized_at is set (block-outcome envelope)', () => {
    // FAILS before fix: current code returns true for any non-empty finalized_at.
    // After fix: requires status==='completed'.
    const env = baseEnvelope({ status: 'failed', finalized_at: new Date().toISOString() });
    expect(isEnvelopeFinalized(env)).toBe(false);
  });

  it('B1.2 returns false when status="active" even with finalized_at set', () => {
    // Edge-case: malformed envelope where finalized_at is set but status is active.
    const env = baseEnvelope({ status: 'active', finalized_at: new Date().toISOString() });
    expect(isEnvelopeFinalized(env)).toBe(false);
  });

  it('B1.3 returns true ONLY when status="completed" AND finalized_at is a non-empty string', () => {
    const ts = new Date().toISOString();
    expect(isEnvelopeFinalized(baseEnvelope({ status: 'completed', finalized_at: ts }))).toBe(true);
    expect(isEnvelopeFinalized(baseEnvelope({ status: 'failed',    finalized_at: ts }))).toBe(false);
    expect(isEnvelopeFinalized(baseEnvelope({ status: 'active',    finalized_at: ts }))).toBe(false);
  });

  it('B1.4 returns false when status="completed" but finalized_at is absent', () => {
    // completed-but-not-finalized should not happen in practice but must be guarded.
    const env = baseEnvelope({ status: 'completed' });
    expect(isEnvelopeFinalized(env)).toBe(false);
  });

  it('B1.5 returns false when status="completed" but finalized_at is empty string', () => {
    const env = baseEnvelope({ status: 'completed', finalized_at: '' });
    expect(isEnvelopeFinalized(env)).toBe(false);
  });

  it('B1.6 backward-compatible: envelope missing both status and finalized_at returns false', () => {
    const raw = { ...baseEnvelope() };
    delete (raw as any).finalized_at;
    expect(isEnvelopeFinalized(raw)).toBe(false);
  });
});

// ─── Bug 2: Confidence fallback — overall_confidence must not be 0 when run_outcome_summary has final_confidence ──

describe('Bug 2 — assembleReport: overall_confidence falls back to run_outcome_summary.final_confidence', () => {
  it('B2.1 overall_confidence is 0 when no snapshot and no run_outcome_summary (baseline)', () => {
    // Control: nothing → 0. This should pass both before and after the fix.
    const entries: LedgerEntry[] = [];
    const bundle = assembleReport(entries);
    expect(bundle.confidence.overall_confidence).toBe(0);
  });

  it('B2.2 overall_confidence uses confidence_snapshot when present (existing behaviour preserved)', () => {
    const snapshotEntry = makeLedgerEntry({
      stage:       'confidence',
      record_type: 'confidence_snapshot',
      payload: {
        kind:                 'confidence_snapshot',
        snapshot_index:       0,
        computed_confidence:  78,
        effective_confidence: 78,
        confidence_band:      'medium',
        stage_name:           'eco',
      } as unknown as LedgerEntry['payload'],
    });
    const bundle = assembleReport([snapshotEntry]);
    expect(bundle.confidence.overall_confidence).toBe(78);
  });

  it('B2.3 overall_confidence falls back to run_outcome_summary.final_confidence when no snapshot exists', () => {
    // FAILS before fix: code defaults to 0 when latestSnapshot is undefined.
    // After fix: reads final_confidence from the run_outcome_summary entry.
    const outcomeEntry = makeLedgerEntry({
      stage:       'outcome',
      record_type: 'run_outcome_summary',
      payload: {
        kind:                   'run_outcome_summary',
        summarized_trace_id:    'trace_bugfix_test',
        completion_state:       'merged',
        final_lane:             'B',
        final_confidence:       40,
        had_refusal:            false,
        had_override:           false,
        forced_unknown_applied: false,
        evidence_gate_failed:   false,
        stages_completed:       3,
        run_timestamp:          new Date().toISOString(),
      } as unknown as LedgerEntry['payload'],
    });
    const bundle = assembleReport([outcomeEntry]);
    expect(bundle.confidence.overall_confidence).toBe(40);
  });

  it('B2.4 confidence_snapshot takes precedence over run_outcome_summary.final_confidence', () => {
    // When both exist, the snapshot value wins (it is more granular and up-to-date).
    const snapshotEntry = makeLedgerEntry({
      stage:       'confidence',
      record_type: 'confidence_snapshot',
      payload: {
        kind:                 'confidence_snapshot',
        snapshot_index:       0,
        computed_confidence:  85,
        effective_confidence: 85,
        confidence_band:      'high',
        stage_name:           'classification',
      } as unknown as LedgerEntry['payload'],
    });
    const outcomeEntry = makeLedgerEntry({
      stage:       'outcome',
      record_type: 'run_outcome_summary',
      payload: {
        kind:                   'run_outcome_summary',
        summarized_trace_id:    'trace_bugfix_test',
        completion_state:       'merged',
        final_lane:             'B',
        final_confidence:       40,   // lower than snapshot — must be ignored
        had_refusal:            false,
        had_override:           false,
        forced_unknown_applied: false,
        evidence_gate_failed:   false,
        stages_completed:       4,
        run_timestamp:          new Date().toISOString(),
      } as unknown as LedgerEntry['payload'],
    });
    const bundle = assembleReport([snapshotEntry, outcomeEntry]);
    expect(bundle.confidence.overall_confidence).toBe(85);
  });

  it('B2.5 overall_confidence is 0 when run_outcome_summary.final_confidence is null or absent', () => {
    const outcomeEntry = makeLedgerEntry({
      stage:       'outcome',
      record_type: 'run_outcome_summary',
      payload: {
        kind:                   'run_outcome_summary',
        summarized_trace_id:    'trace_bugfix_test',
        completion_state:       'merged',
        final_lane:             'B',
        final_confidence:       null,   // explicitly null — no confidence signal
        had_refusal:            false,
        had_override:           false,
        forced_unknown_applied: false,
        evidence_gate_failed:   false,
        stages_completed:       1,
        run_timestamp:          new Date().toISOString(),
      } as unknown as LedgerEntry['payload'],
    });
    const bundle = assembleReport([outcomeEntry]);
    expect(bundle.confidence.overall_confidence).toBe(0);
  });
});

// ─── Bug 3: Verification heuristic — direct node tool invocations ─────────────

describe('Bug 3 — isBashVerificationCommand: direct node tool invocations must be recognised', () => {
  // These all FAIL before fix: VERIFICATION_PATTERN has no arm for `node .../tool`
  // or `./node_modules/.bin/tool` invocations.

  it('B3.1 recognises "node node_modules/.bin/eslint ." as verification', () => {
    expect(isBashVerificationCommand('node node_modules/.bin/eslint .', [])).toBe(true);
  });

  it('B3.2 recognises "node node_modules/.bin/jest" as verification', () => {
    expect(isBashVerificationCommand('node node_modules/.bin/jest', [])).toBe(true);
  });

  it('B3.3 recognises "node node_modules/.bin/vitest run" as verification', () => {
    expect(isBashVerificationCommand('node node_modules/.bin/vitest run', [])).toBe(true);
  });

  it('B3.4 recognises "node node_modules/.bin/mocha" as verification', () => {
    expect(isBashVerificationCommand('node node_modules/.bin/mocha', [])).toBe(true);
  });

  it('B3.5 recognises "./node_modules/.bin/eslint src/" as verification', () => {
    expect(isBashVerificationCommand('./node_modules/.bin/eslint src/', [])).toBe(true);
  });

  it('B3.6 recognises "./node_modules/.bin/jest --coverage" as verification', () => {
    expect(isBashVerificationCommand('./node_modules/.bin/jest --coverage', [])).toBe(true);
  });

  it('B3.7 recognises "npx eslint ." as verification', () => {
    expect(isBashVerificationCommand('npx eslint .', [])).toBe(true);
  });

  it('B3.8 recognises "npx jest --runInBand" as verification', () => {
    expect(isBashVerificationCommand('npx jest --runInBand', [])).toBe(true);
  });

  it('B3.9 does NOT treat arbitrary node scripts as verification', () => {
    // node index.js is not a verification command
    expect(isBashVerificationCommand('node index.js', [])).toBe(false);
    expect(isBashVerificationCommand('node server.js', [])).toBe(false);
  });

  it('B3.10 does NOT treat npx with non-verification tools as verification', () => {
    expect(isBashVerificationCommand('npx create-react-app my-app', [])).toBe(false);
  });

  it('B3.11 existing patterns still work after the fix (regression guard)', () => {
    // Ensure the new arm does not break the existing pattern matches.
    expect(isBashVerificationCommand('npm run lint', [])).toBe(true);
    expect(isBashVerificationCommand('yarn run test', [])).toBe(true);
    expect(isBashVerificationCommand('jest --coverage', [])).toBe(true);
    expect(isBashVerificationCommand('vitest run', [])).toBe(true);
    expect(isBashVerificationCommand('git commit -m "fix"', [])).toBe(false);
  });

  it('B3.12 stored commands still take priority over the pattern (regression guard)', () => {
    // 'make check' does not match any pattern, but is stored — must still detect.
    expect(isBashVerificationCommand('make check', ['make check'])).toBe(true);
  });
});
