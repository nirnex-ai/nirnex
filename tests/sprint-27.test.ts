/**
 * Sprint 27 — Zero-Trust Execution Model (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Core contract:
 *   The Zero-Trust Execution Model treats every Claude action as potentially
 *   unreliable. Decisions derive exclusively from machine-verifiable trace
 *   artifacts (attested exit codes, tool events), never from Claude's prose
 *   or inferred state.
 *
 * Enforced rules:
 *   Rule 1 — No silent verification  (mandatory_verification && no trace → BLOCK)
 *   Rule 2 — No inferred success     (exit_code === null → BLOCK with COMMAND_EXIT_UNKNOWN)
 *   Rule 3 — No post-verification edits (file modified after verification → BLOCK)
 *   Rule 4 — First execution only    (only first verification run counts)
 *
 * Coverage:
 *
 * 1. extractExitCode — shared extraction module
 *    1.1  extracts from tool_result.exit_code (numeric field)
 *    1.2  extracts from tool_result.exitCode (camelCase variant)
 *    1.3  extracts from tool_result.metadata.exit_code (nested)
 *    1.4  parses EXIT_CODE:1 pattern from output string
 *    1.5  returns 1 for is_error=true
 *    1.6  returns null when nothing determinable
 *    1.7  suppresses zero-exit probe for shell composition with ;
 *    1.8  suppresses zero-exit probe for shell composition with &&
 *    1.9  allows zero-exit probe for direct commands (stdout + interrupted=false)
 *    1.10 parses "exit code 0" pattern from output string
 *
 * 2. attestBashExecution — attestation builder
 *    2.1  returns CommandAttestation with 64-char hex command_hash (SHA-256)
 *    2.2  captured_by is always 'trace-hook'
 *    2.3  verified=true when exit_code is 0
 *    2.4  verified=true when exit_code is non-zero (proven bad)
 *    2.5  verified=false when exit_code is null (indeterminate)
 *    2.6  capture_timestamp is a valid ISO 8601 string
 *    2.7  identical commands produce identical command_hash
 *    2.8  different commands produce different command_hash
 *
 * 3. evaluateZeroTrustRules — enforcement engine
 *    3.1  Rule 2: null exit_code → blocking COMMAND_EXIT_UNKNOWN
 *    3.2  Rule 2: exit_code=0 → no violation
 *    3.3  Rule 2: exit_code=1 → blocking COMMAND_EXIT_NONZERO
 *    3.4  Rule 3: Edit after verification → blocking POST_VERIFICATION_EDIT
 *    3.5  Rule 3: Write after verification → blocking POST_VERIFICATION_EDIT
 *    3.6  Rule 3: MultiEdit after verification → blocking POST_VERIFICATION_EDIT
 *    3.7  Rule 3: Edit BEFORE verification → no violation
 *    3.8  Rule 3: no verification run → no POST_VERIFICATION_EDIT violation
 *    3.9  Rule 4: uses FIRST verification event exit code, not last
 *    3.10 Rule 4: second passing run does not rescue a first failing run
 *    3.11 no violations when mandatoryVerificationRequired=false
 *    3.12 no violations when events list is empty and no mandatory verification
 */

import { describe, it, expect } from 'vitest';
import { extractExitCode } from '../packages/cli/src/runtime/exit-code.js';
import { attestBashExecution, evaluateZeroTrustRules } from '../packages/cli/src/runtime/attestation.js';
import type { TraceEvent } from '../packages/cli/src/runtime/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTraceEvent(overrides: Partial<TraceEvent> & { tool: string }): TraceEvent {
  return {
    event_id: 'evt_test',
    session_id: 'sess_test',
    task_id: 'task_test',
    timestamp: new Date().toISOString(),
    tool_input: {},
    tool_result: {},
    affected_files: [],
    deviation_flags: [],
    ...overrides,
  };
}

function makeBashEvent(command: string, exitCode: number | null, msOffset = 0): TraceEvent {
  const toolResult: Record<string, unknown> =
    exitCode !== null ? { exit_code: exitCode } : {};
  const ts = new Date(Date.now() + msOffset).toISOString();
  return makeTraceEvent({
    tool: 'Bash',
    timestamp: ts,
    tool_input: { command },
    tool_result: toolResult,
  });
}

function makeEditEvent(filePath: string, msOffset = 0): TraceEvent {
  return makeTraceEvent({
    tool: 'Edit',
    timestamp: new Date(Date.now() + msOffset).toISOString(),
    tool_input: { file_path: filePath },
    affected_files: [filePath],
  });
}

function makeWriteEvent(filePath: string, msOffset = 0): TraceEvent {
  return makeTraceEvent({
    tool: 'Write',
    timestamp: new Date(Date.now() + msOffset).toISOString(),
    tool_input: { file_path: filePath },
    affected_files: [filePath],
  });
}

function makeMultiEditEvent(filePath: string, msOffset = 0): TraceEvent {
  return makeTraceEvent({
    tool: 'MultiEdit',
    timestamp: new Date(Date.now() + msOffset).toISOString(),
    tool_input: { edits: [{ file_path: filePath }] },
    affected_files: [filePath],
  });
}

const VERIFY_CMD = 'npm run test';
const STORED_CMDS = ['npm run test'];

// ─── Section 1: extractExitCode ───────────────────────────────────────────────

describe('1. extractExitCode', () => {
  it('1.1 extracts from tool_result.exit_code (numeric)', () => {
    expect(extractExitCode({ exit_code: 0 })).toBe(0);
    expect(extractExitCode({ exit_code: 1 })).toBe(1);
    expect(extractExitCode({ exit_code: 127 })).toBe(127);
  });

  it('1.2 extracts from tool_result.exitCode (camelCase)', () => {
    expect(extractExitCode({ exitCode: 0 })).toBe(0);
    expect(extractExitCode({ exitCode: 2 })).toBe(2);
  });

  it('1.3 extracts from tool_result.metadata.exit_code (nested)', () => {
    expect(extractExitCode({ metadata: { exit_code: 0 } })).toBe(0);
    expect(extractExitCode({ metadata: { exitCode: 1 } })).toBe(1);
  });

  it('1.4 parses EXIT_CODE:1 pattern from output string', () => {
    expect(extractExitCode({ output: 'some output\nEXIT_CODE:1' })).toBe(1);
    expect(extractExitCode({ output: 'EXIT_CODE: 0' })).toBe(0);
  });

  it('1.5 returns 1 for is_error=true', () => {
    expect(extractExitCode({ is_error: true })).toBe(1);
    expect(extractExitCode({ isError: true })).toBe(1);
  });

  it('1.6 returns null when nothing determinable', () => {
    expect(extractExitCode({})).toBeNull();
    expect(extractExitCode({ output: 'no code here' })).toBeNull();
  });

  it('1.7 suppresses zero-exit probe for ; composition', () => {
    const result = { stdout: 'output', interrupted: false };
    expect(extractExitCode(result, 'npm run lint; echo done')).toBeNull();
  });

  it('1.8 suppresses zero-exit probe for || composition (last cmd can mask failure)', () => {
    // `npm run build || echo "ok"` — the echo always exits 0 even if build failed.
    // Probe 6 must not infer 0 here because the evidence is unreliable.
    const result = { stdout: 'output', interrupted: false };
    expect(extractExitCode(result, 'npm run build || echo "build failed"')).toBeNull();
  });

  it('1.8b suppresses zero-exit probe for mixed && + || composition', () => {
    const result = { stdout: 'output', interrupted: false };
    expect(extractExitCode(result, 'npm run build && npm run test || echo "failed"')).toBeNull();
  });

  it('1.8c allows zero-exit probe for &&-only composition (PATH-setup + run pattern)', () => {
    // &&-only chains exit with the first failing command's code.
    // interrupted===false + stdout present reliably means the chain passed.
    // This is the production pattern: export PATH=... && cd /path && npm run lint
    // FAILS before fix: current code treats && as unsafe and returns null.
    const result = { stdout: 'output', interrupted: false };
    expect(extractExitCode(result, 'export PATH="/usr/local/bin:$PATH" && cd /proj && npm run lint')).toBe(0);
  });

  it('1.8d allows zero-exit probe for simple && chain without PATH setup', () => {
    // FAILS before fix.
    const result = { stdout: 'Lint passed', interrupted: false };
    expect(extractExitCode(result, 'npm run build && npm run lint')).toBe(0);
  });

  it('1.9 allows zero-exit probe for direct commands (stdout + interrupted=false)', () => {
    const result = { stdout: 'all good', interrupted: false };
    expect(extractExitCode(result, 'npm run test')).toBe(0);
  });

  it('1.10 parses "exit code 0" pattern from output string', () => {
    expect(extractExitCode({ output: 'Process exited with exit code 0' })).toBe(0);
  });
});

// ─── Section 2: attestBashExecution ───────────────────────────────────────────

describe('2. attestBashExecution', () => {
  it('2.1 returns CommandAttestation with 64-char hex command_hash (SHA-256)', () => {
    const attest = attestBashExecution('npm run test', { exit_code: 0 });
    expect(typeof attest.command_hash).toBe('string');
    expect(attest.command_hash).toHaveLength(64);
    expect(attest.command_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2.2 captured_by is always trace-hook', () => {
    const attest = attestBashExecution('npm run lint', { exit_code: 1 });
    expect(attest.captured_by).toBe('trace-hook');
  });

  it('2.3 verified=true when exit_code is 0', () => {
    const attest = attestBashExecution('npm run test', { exit_code: 0 });
    expect(attest.verified).toBe(true);
    expect(attest.exit_code).toBe(0);
  });

  it('2.4 verified=true when exit_code is non-zero (proven bad)', () => {
    const attest = attestBashExecution('npm run test', { exit_code: 1 });
    expect(attest.verified).toBe(true);
    expect(attest.exit_code).toBe(1);
  });

  it('2.5 verified=false when exit_code is null (indeterminate)', () => {
    const attest = attestBashExecution('npm run test', {});
    expect(attest.verified).toBe(false);
    expect(attest.exit_code).toBeNull();
  });

  it('2.6 capture_timestamp is a valid ISO 8601 string', () => {
    const attest = attestBashExecution('npm run test', { exit_code: 0 });
    expect(typeof attest.capture_timestamp).toBe('string');
    expect(() => new Date(attest.capture_timestamp).toISOString()).not.toThrow();
  });

  it('2.7 identical commands produce identical command_hash', () => {
    const a = attestBashExecution('npm run test', { exit_code: 0 });
    const b = attestBashExecution('npm run test', { exit_code: 1 });
    expect(a.command_hash).toBe(b.command_hash);
  });

  it('2.8 different commands produce different command_hash', () => {
    const a = attestBashExecution('npm run test', { exit_code: 0 });
    const b = attestBashExecution('npm run lint', { exit_code: 0 });
    expect(a.command_hash).not.toBe(b.command_hash);
  });
});

// ─── Section 3: evaluateZeroTrustRules ────────────────────────────────────────

describe('3. evaluateZeroTrustRules', () => {
  it('3.1 Rule 2: null exit_code → blocking COMMAND_EXIT_UNKNOWN with machine-observed value', () => {
    const events: TraceEvent[] = [makeBashEvent(VERIFY_CMD, null)];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    const v = violations.find(v => v.reason_code === 'COMMAND_EXIT_UNKNOWN');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('blocking');
    expect(v?.observed).toBe('exit_code = unknown');
  });

  it('3.2 Rule 2: exit_code=0 → no violation', () => {
    const events: TraceEvent[] = [makeBashEvent(VERIFY_CMD, 0)];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    expect(violations).toHaveLength(0);
  });

  it('3.3 Rule 2: exit_code=1 → blocking COMMAND_EXIT_NONZERO with exact observed exit code', () => {
    const events: TraceEvent[] = [makeBashEvent(VERIFY_CMD, 1)];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    const v = violations.find(v => v.reason_code === 'COMMAND_EXIT_NONZERO');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('blocking');
    expect(v?.observed).toBe('exit_code = 1');
  });

  it('3.4 Rule 3: Edit after verification → blocking POST_VERIFICATION_EDIT with file in observed', () => {
    const events: TraceEvent[] = [
      makeBashEvent(VERIFY_CMD, 0, 0),
      makeEditEvent('src/foo.ts', 100),
    ];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    const v = violations.find(v => v.reason_code === 'POST_VERIFICATION_EDIT');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('blocking');
    expect(v?.observed).toContain('src/foo.ts');
  });

  it('3.5 Rule 3: Write after verification → blocking POST_VERIFICATION_EDIT', () => {
    const events: TraceEvent[] = [
      makeBashEvent(VERIFY_CMD, 0, 0),
      makeWriteEvent('src/bar.ts', 100),
    ];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    expect(violations.map(v => v.reason_code)).toContain('POST_VERIFICATION_EDIT');
  });

  it('3.6 Rule 3: MultiEdit after verification → blocking POST_VERIFICATION_EDIT', () => {
    const events: TraceEvent[] = [
      makeBashEvent(VERIFY_CMD, 0, 0),
      makeMultiEditEvent('src/baz.ts', 100),
    ];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    expect(violations.map(v => v.reason_code)).toContain('POST_VERIFICATION_EDIT');
  });

  it('3.7 Rule 3: Edit BEFORE verification → no POST_VERIFICATION_EDIT', () => {
    const events: TraceEvent[] = [
      makeEditEvent('src/foo.ts', 0),
      makeBashEvent(VERIFY_CMD, 0, 100),
    ];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    expect(violations.map(v => v.reason_code)).not.toContain('POST_VERIFICATION_EDIT');
  });

  it('3.8 Rule 3: no verification run → no POST_VERIFICATION_EDIT', () => {
    const events: TraceEvent[] = [
      makeEditEvent('src/foo.ts', 0),
    ];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    expect(violations.map(v => v.reason_code)).not.toContain('POST_VERIFICATION_EDIT');
  });

  it('3.9 Rule 4: uses FIRST verification event, not last', () => {
    // First run: exit 1. Second run: exit 0. Rule 4 says first counts → NONZERO violation.
    const events: TraceEvent[] = [
      makeBashEvent(VERIFY_CMD, 1, 0),   // first: FAIL
      makeBashEvent(VERIFY_CMD, 0, 100), // second: PASS — must be ignored
    ];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    expect(violations.map(v => v.reason_code)).toContain('COMMAND_EXIT_NONZERO');
  });

  it('3.10 Rule 4: second passing run does not rescue a first failing run', () => {
    const events: TraceEvent[] = [
      makeBashEvent(VERIFY_CMD, 1, 0),
      makeBashEvent(VERIFY_CMD, 0, 100),
    ];
    const violations = evaluateZeroTrustRules(events, true, STORED_CMDS);
    // Should have exactly one exit-related violation (the first run's failure), not zero
    const exitViolations = violations.filter(v =>
      v.reason_code === 'COMMAND_EXIT_NONZERO' || v.reason_code === 'COMMAND_EXIT_UNKNOWN',
    );
    expect(exitViolations.length).toBeGreaterThan(0);
  });

  it('3.11 no violations when mandatoryVerificationRequired=false', () => {
    const events: TraceEvent[] = [
      makeBashEvent(VERIFY_CMD, 1, 0), // would normally fail
      makeEditEvent('src/foo.ts', 100),
    ];
    const violations = evaluateZeroTrustRules(events, false, STORED_CMDS);
    expect(violations).toHaveLength(0);
  });

  it('3.12 no violations when events empty and no mandatory verification', () => {
    const violations = evaluateZeroTrustRules([], false, []);
    expect(violations).toHaveLength(0);
  });
});
