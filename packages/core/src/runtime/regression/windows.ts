/**
 * Regression Detection — Window Construction
 *
 * Builds comparison windows from a collection of RunOutcomeSummaryRecords.
 * Count-based windows are the primary comparison mechanism.
 * Time-based windows are the secondary mechanism.
 *
 * Design constraints:
 *   - Windows never mutate the input array
 *   - Count windows return the N most recent summaries by run_timestamp DESC
 *   - Time windows return all summaries within the last N calendar days
 *   - If N > available summaries, all available summaries are returned
 */

import type { RunOutcomeSummaryRecord } from './types.js';

// ─── buildCountWindow ─────────────────────────────────────────────────────────

/**
 * Build a count-based window: the N most recent run summaries.
 *
 * Summaries are sorted by run_timestamp DESC before slicing.
 * If count > available summaries, returns all summaries.
 *
 * @param summaries - all available run summaries
 * @param count     - maximum number of summaries to include
 * @returns         - up to count summaries, most recent first
 */
export function buildCountWindow(
  summaries: RunOutcomeSummaryRecord[],
  count: number,
): RunOutcomeSummaryRecord[] {
  const sorted = [...summaries].sort(
    (a, b) => new Date(b.run_timestamp).getTime() - new Date(a.run_timestamp).getTime(),
  );
  return sorted.slice(0, count);
}

// ─── buildTimeWindow ──────────────────────────────────────────────────────────

/**
 * Build a time-based window: all summaries within the last N calendar days.
 *
 * The cutoff is computed as: now - (days * 24 * 60 * 60 * 1000)
 * Summaries with run_timestamp >= cutoff are included.
 *
 * @param summaries - all available run summaries
 * @param days      - number of days to look back
 * @returns         - summaries within the window, sorted by run_timestamp DESC
 */
export function buildTimeWindow(
  summaries: RunOutcomeSummaryRecord[],
  days: number,
): RunOutcomeSummaryRecord[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return summaries
    .filter(s => new Date(s.run_timestamp).getTime() >= cutoff)
    .sort((a, b) => new Date(b.run_timestamp).getTime() - new Date(a.run_timestamp).getTime());
}
