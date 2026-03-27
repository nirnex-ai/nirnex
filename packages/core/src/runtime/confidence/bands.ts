/**
 * Confidence Evolution Tracking — Band Computation
 */

import type { ConfidenceBand } from './types.js';

/**
 * Compute the ConfidenceBand from a numeric score and optional override flags.
 *
 * Priority:
 *   1. blocked=true       → 'blocked'
 *   2. forced_unknown=true → 'forced_unknown'
 *   3. score ≥ 80          → 'high'
 *   4. score ≥ 60          → 'moderate'
 *   5. score ≥ 40          → 'low'
 *   6. score < 40          → 'very_low'
 */
export function computeConfidenceBand(
  score: number,
  opts: { forced_unknown?: boolean; blocked?: boolean } = {},
): ConfidenceBand {
  if (opts.blocked) return 'blocked';
  if (opts.forced_unknown) return 'forced_unknown';
  if (score >= 80) return 'high';
  if (score >= 60) return 'moderate';
  if (score >= 40) return 'low';
  return 'very_low';
}

/**
 * Map an ECO dimension severity string to a numeric confidence score (0–100).
 *
 *   pass     → 100
 *   warn     → 60
 *   escalate → 40
 *   block    → 0
 *   unknown  → 0
 */
export function ecoSeverityToScore(severity: string): number {
  switch (severity) {
    case 'pass':     return 100;
    case 'warn':     return 60;
    case 'escalate': return 40;
    case 'block':    return 0;
    default:         return 0;
  }
}
