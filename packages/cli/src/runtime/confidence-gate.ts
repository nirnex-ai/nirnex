/**
 * Confidence Gate — Pure Enforcement Helper
 *
 * Determines whether the envelope's confidence score indicates that
 * governance decision reliability cannot be established.
 *
 * A score of exactly 0 means the planning stage produced no confidence
 * signal — either ECO did not run, or every dimension scored 0.
 * This is distinct from a low-but-computed score (e.g. very_low band).
 *
 * Design constraints:
 *   - Pure function: no I/O, no side effects
 *   - Only score === 0 triggers the gate (not negative, not low-positive)
 *   - Callers decide severity; this helper only classifies the condition
 */

/**
 * Returns true when the envelope confidence score is exactly 0,
 * indicating that no confidence signal was produced during planning.
 *
 * A score of 0 means the report will show `band: 'unknown'` because
 * the assembler defaults to 'unknown' when no confidence_snapshot
 * ledger entries exist — i.e. the confidence model was never wired
 * to this run's planning stage.
 */
export function isConfidenceGateUnknown(score: number): boolean {
  return score === 0;
}
