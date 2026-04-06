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
 *      (suppressed for || and ; compositions; &&-only chains are allowed)
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
  // Suppressed for compositions where the LAST command can exit 0 even when a
  // prior command failed, making zero-exit inference unreliable:
  //
  //   ;   — always runs the next command; `cmd1; echo done` exits 0 regardless
  //   ||  — right-hand side runs only on failure; may always exit 0
  //
  // &&-only chains are NOT suppressed: `a && b && c` exits with the first
  // failing command's code. If interrupted===false + stdout is present, the
  // entire chain — including the final verification step — passed with exit 0.
  // This is the standard PATH-setup pattern:
  //   export PATH="..." && cd /path && npm run lint
  const usesUnsafeComposition = command.length > 0 && /;|\|\|/.test(command);
  if (!usesUnsafeComposition && typeof toolResult.stdout === 'string' && toolResult.interrupted === false) return 0;

  return null;
}
