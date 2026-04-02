/**
 * Zero-Trust Execution Attestation Layer.
 *
 * Every Bash execution must produce a CommandAttestation — a machine-verifiable
 * record capturing the exit code and command identity at the moment of execution,
 * not at validation time.
 *
 * The Zero-Trust rules enforced here:
 *
 *   Rule 2 — No inferred success
 *     exit_code === null → COMMAND_EXIT_UNKNOWN (blocking)
 *     Only exit_code === 0 is a pass; anything else is a failure or unknown.
 *
 *   Rule 3 — No post-verification edits
 *     Any Edit / Write / MultiEdit event occurring AFTER the first verification
 *     Bash event in the trace is a contract violation.
 *
 *   Rule 4 — First execution only
 *     Only the FIRST matching verification Bash event determines the outcome.
 *     Subsequent runs (retries, re-runs) cannot upgrade a failed verification.
 */

import { createHash } from 'node:crypto';
import { extractExitCode } from './exit-code.js';
import type { TraceEvent } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandAttestation {
  /** SHA-256 of the command string. Identifies what was run without storing it. */
  command_hash: string;
  /** Exit code extracted at capture time. null means indeterminate → Rule 2 blocks. */
  exit_code: number | null;
  /** Always 'trace-hook' — the only trusted capture source. */
  captured_by: 'trace-hook';
  /** true iff exit_code was deterministically extracted (not null). */
  verified: boolean;
  /** ISO 8601 timestamp when the attestation was created. */
  capture_timestamp: string;
}

export interface ZeroTrustViolation {
  reason_code: 'COMMAND_EXIT_NONZERO' | 'COMMAND_EXIT_UNKNOWN' | 'POST_VERIFICATION_EDIT';
  /** Human-readable description — used as violatedContract in the hook event. */
  detail: string;
  /**
   * Machine-observed value — used as the `actual` field in ContractViolationDetectedEvent.
   * Always a concrete fact: "exit_code = 1", "exit_code = unknown", or "file: src/foo.ts".
   * Never a prose description.
   */
  observed: string;
  severity: 'blocking';
}

// ─── Attestation builder ──────────────────────────────────────────────────────

/**
 * Build a CommandAttestation from a Bash tool result.
 * Called in trace-hook.ts at capture time — the exit code is frozen here
 * and does not need to be re-extracted later in validate.ts.
 */
export function attestBashExecution(
  command: string,
  toolResult: Record<string, unknown>,
): CommandAttestation {
  const exit_code = extractExitCode(toolResult, command);
  return {
    command_hash: createHash('sha256').update(command).digest('hex'),
    exit_code,
    captured_by: 'trace-hook',
    verified: exit_code !== null,
    capture_timestamp: new Date().toISOString(),
  };
}

// ─── Enforcement engine ───────────────────────────────────────────────────────

const VERIFICATION_PATTERN = /\b(test|jest|pytest|vitest|mocha|cargo\s+test|go\s+test|npm\s+test|yarn\s+test|pnpm\s+test|make\s+test|npm\s+run|yarn\s+run|pnpm\s+run)\b/i;

function isVerificationCommand(event: TraceEvent, storedCmds: string[]): boolean {
  const cmd = String((event.tool_input as Record<string, unknown>)?.command ?? '');
  if (!cmd) return false;
  if (storedCmds.length > 0 && storedCmds.some(vc => cmd.includes(vc))) return true;
  return VERIFICATION_PATTERN.test(cmd);
}

/**
 * Evaluate Zero-Trust rules 2, 3, and 4 against a session's trace events.
 *
 * Pure function — no I/O, no side effects. Called from validate.ts after
 * Rule 1 (VERIFICATION_REQUIRED_NOT_RUN) has already been checked.
 *
 * @param events                      Ordered trace events for the session.
 * @param mandatoryVerificationRequired  Whether the task requires verification.
 * @param storedVerificationCommands  Commands extracted at task entry time.
 * @returns Array of zero-trust violations (may be empty).
 */
export function evaluateZeroTrustRules(
  events: TraceEvent[],
  mandatoryVerificationRequired: boolean,
  storedVerificationCommands: string[],
): ZeroTrustViolation[] {
  if (!mandatoryVerificationRequired) return [];

  const bashEvents = events.filter(e => e.tool === 'Bash');

  // Rule 4: FIRST matching verification event only — never last.
  const firstVerification = bashEvents.find(e =>
    isVerificationCommand(e, storedVerificationCommands),
  );

  if (!firstVerification) return []; // Rule 1 handles the "not run" case elsewhere

  const violations: ZeroTrustViolation[] = [];

  // Rule 2: No inferred success — derive exit code from attestation if present,
  // fall back to live extraction only if attestation is absent (pre-attestation traces).
  const cmd = String((firstVerification.tool_input as Record<string, unknown>)?.command ?? '');
  const exitCode = firstVerification.attestation?.exit_code !== undefined
    ? firstVerification.attestation.exit_code
    : extractExitCode(firstVerification.tool_result, cmd);

  if (exitCode === null) {
    violations.push({
      reason_code: 'COMMAND_EXIT_UNKNOWN',
      detail: 'Verification command ran but exit code could not be determined — cannot confirm pass (Zero-Trust Rule 2)',
      observed: 'exit_code = unknown',
      severity: 'blocking',
    });
  } else if (exitCode !== 0) {
    violations.push({
      reason_code: 'COMMAND_EXIT_NONZERO',
      detail: `Verification command exited with a non-zero code (Zero-Trust Rule 2)`,
      observed: `exit_code = ${exitCode}`,
      severity: 'blocking',
    });
  }

  // Rule 3: No post-verification edits — any Edit/Write/MultiEdit after the
  // first verification event is a contract violation.
  const verificationIndex = events.indexOf(firstVerification);
  const postVerificationEdits = events
    .slice(verificationIndex + 1)
    .filter(e => e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit');

  for (const edit of postVerificationEdits) {
    const files = edit.affected_files.length > 0
      ? edit.affected_files.join(', ')
      : String((edit.tool_input as Record<string, unknown>)?.file_path ?? 'unknown');
    violations.push({
      reason_code: 'POST_VERIFICATION_EDIT',
      detail: 'File modified after verification was run (Zero-Trust Rule 3)',
      observed: `file: ${files}`,
      severity: 'blocking',
    });
  }

  return violations;
}
