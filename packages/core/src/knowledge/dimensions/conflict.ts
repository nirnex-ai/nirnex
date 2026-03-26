/**
 * Conflict Dimension Evaluator
 *
 * Wraps the Sprint 8 conflict detection results into the uniform DimensionResult contract.
 *
 * Conflict measures unresolved contradictions in evidence.
 * It is independent of coverage (presence), freshness (currency), mapping (structure),
 * and graph (completeness).
 *
 * Design constraints:
 *   - Delegates severity determination to dominantSeverity() / ecoSeverityLabel() (Sprint 8)
 *   - Must NOT depend on coverage, freshness, mapping, or graph results
 *   - Empty conflict list → unambiguous pass with value=1.0
 */

import type { DimensionResult, DimensionSignals, DimensionThresholds } from './types.js';
import { CONFLICT_REASON_CODES } from './reason-codes.js';
import { scoreConflicts } from '../conflict/score-conflicts.js';

export function computeConflictDimension(
  signals: DimensionSignals,
  _thresholds: DimensionThresholds,
): DimensionResult {
  const { conflicts } = signals;

  // ── Pass: no conflicts ───────────────────────────────────────────────────
  if (!conflicts || conflicts.length === 0) {
    return {
      value: 1.0,
      status: 'pass',
      reason_codes: [CONFLICT_REASON_CODES.CONFLICT_NONE],
      summary: 'No material conflicts detected.',
      provenance: {
        signals: ['conflicts'],
        thresholds: {},
      },
      metrics: {
        conflictCount: 0,
        dominantSeverity: 'none',
        conflictScore: 1.0,
      },
    };
  }

  // ── Delegate to Sprint 8 scoreConflicts ───────────────────────────────────
  const scored = scoreConflicts(conflicts);
  const { severity, score, summary } = scored;

  // Map ECO severity to DimensionResult status
  const status: DimensionResult['status'] =
    severity === 'none'     ? 'pass'     :
    severity === 'warn'     ? 'warn'     :
    severity === 'escalate' ? 'escalate' :
    /* block */               'block';

  // Normalize score (Sprint 8 uses 0..1 where 1 = no conflict)
  const value = Math.max(0, Math.min(1, score));

  // ── Reason codes ──────────────────────────────────────────────────────────
  const reason_codes: string[] = [];
  if (status === 'pass') {
    reason_codes.push(CONFLICT_REASON_CODES.CONFLICT_NONE);
  } else if (status === 'warn') {
    reason_codes.push(CONFLICT_REASON_CODES.CONFLICT_ADVISORY);
  } else if (status === 'escalate') {
    reason_codes.push(CONFLICT_REASON_CODES.CONFLICT_HIGH_SEVERITY);
  } else {
    reason_codes.push(CONFLICT_REASON_CODES.CONFLICT_BLOCKING);
  }

  return {
    value,
    status,
    reason_codes,
    summary,
    provenance: {
      signals: ['conflicts'],
      thresholds: {},
    },
    metrics: {
      conflictCount: conflicts.length,
      dominantSeverity: severity,
      conflictScore: value,
      dominantConflictIds: scored.dominant_conflicts.join(','),
    },
  };
}
