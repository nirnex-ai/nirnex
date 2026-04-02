/**
 * Shared exit-code extraction for the Nirnex runtime.
 *
 * Used by both trace-hook.ts (at capture time) and validate.ts (at
 * validation time) so the extraction logic is a single source of truth.
 *
 * Claude Code's PostToolUse hook sends Bash results in varying shapes
 * depending on version. We try every known location before giving up:
 *   1. tool_result.exit_code          (number — primary field)
 *   2. tool_result.exitCode           (camelCase variant)
 *   3. tool_result.metadata.exit_code (nested metadata)
 *   4. Parse output / content / text / stdout for "EXIT_CODE:N" patterns
 *   5. tool_result.is_error / isError  (boolean error flag → treat as exit 1)
 *   6. Claude Code zero-exit signature — stdout present + interrupted===false
 *      (suppressed for shell-composition commands)
 *
 * Returns the exit code as a number, or null if it cannot be determined.
 * null MUST be treated as blocking under Zero-Trust Rule 2.
 */
export function extractExitCode(
  toolResult: Record<string, unknown> | undefined,
  command = '',
): number | null {
  if (!toolResult) return null;

  // 1 & 2: direct numeric fields
  if (typeof toolResult.exit_code === 'number') return toolResult.exit_code;
  if (typeof toolResult.exitCode  === 'number') return toolResult.exitCode as number;

  // 3: nested metadata
  const meta = toolResult.metadata as Record<string, unknown> | undefined;
  if (meta) {
    if (typeof meta.exit_code === 'number') return meta.exit_code as number;
    if (typeof meta.exitCode  === 'number') return meta.exitCode  as number;
  }

  // 4: parse output string for EXIT_CODE:N or "exit code N" patterns.
  const outputStr = String(
    toolResult.output ?? toolResult.content ?? toolResult.text ?? toolResult.result ?? toolResult.stdout ?? ''
  );
  if (outputStr) {
    const m = outputStr.match(/EXIT_CODE[:\s]+(\d+)/i)
           ?? outputStr.match(/exit(?:\s+code)?[:\s]+(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }

  // 5: boolean error flag
  if (toolResult.is_error === true || toolResult.isError === true) return 1;

  // 6: Claude Code zero-exit signature — stdout present + interrupted===false.
  //
  // IMPORTANT: suppressed for shell-composition commands (; && ||).
  // When a command wraps another in shell composition the outer shell
  // exits 0 (e.g. `echo EXIT_CODE:$?` always exits 0). If the inner
  // command's output is truncated, probe 4 finds nothing and probe 6
  // would wrongly infer exit 0. For composition commands, null is the
  // safe answer — Zero-Trust Rule 2 will block on null rather than
  // allow a false pass.
  const usesShellComposition = command.length > 0 && /;|&&|\|\|/.test(command);
  if (!usesShellComposition && typeof toolResult.stdout === 'string' && toolResult.interrupted === false) return 0;

  return null;
}
