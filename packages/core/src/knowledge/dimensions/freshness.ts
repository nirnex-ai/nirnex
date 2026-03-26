/**
 * Freshness Dimension Evaluator
 *
 * Wraps the Sprint 9 scope-aware freshness impact into the uniform DimensionResult contract.
 *
 * Freshness is SCOPE-AWARE: stale files that do not intersect the required scope
 * are explicitly NOT penalized. This prevents unrelated staleness from polluting
 * confidence for bounded requests.
 *
 * Design constraints:
 *   - Delegates severity determination to FreshnessImpact.severity (Sprint 9)
 *   - Must NOT depend on coverage, mapping, conflict, or graph results
 *   - Null freshnessImpact → emit warn with FRESHNESS_INPUTS_UNAVAILABLE
 *     (unavailable data must not silently pass)
 */

import type { DimensionResult, DimensionSignals, DimensionThresholds } from './types.js';
import { FRESHNESS_DIMENSION_REASON_CODES } from './reason-codes.js';

// Freshness severity → normalized value
const SEVERITY_TO_VALUE: Record<string, number> = {
  none:     1.0,
  warn:     0.75,
  escalate: 0.45,
  block:    0.10,
};

export function computeFreshnessDimension(
  signals: DimensionSignals,
  _thresholds: DimensionThresholds,
): DimensionResult {
  const impact = signals.freshnessImpact;

  // ── Unavailable freshness data — emit warn, not pass ──────────────────────
  if (impact === null || impact === undefined) {
    return {
      value: 0.70,
      status: 'warn',
      reason_codes: [FRESHNESS_DIMENSION_REASON_CODES.FRESHNESS_INPUTS_UNAVAILABLE],
      summary: 'Freshness data unavailable — unable to confirm index currency.',
      provenance: {
        signals: ['freshnessImpact'],
        thresholds: {},
      },
      metrics: {
        impactRatio: 0,
        intersectedScopeCount: 0,
        staleScopeCount: 0,
      },
    };
  }

  // ── Map FreshnessImpact severity to DimensionResult ───────────────────────
  const severity = impact.severity;
  const value = SEVERITY_TO_VALUE[severity] ?? 0.70;

  // Map to status
  const status: DimensionResult['status'] =
    severity === 'none'     ? 'pass' :
    severity === 'warn'     ? 'warn' :
    severity === 'escalate' ? 'escalate' :
    /* block */               'block';

  // ── Reason codes — pass through from FreshnessImpact ─────────────────────
  const reason_codes: string[] = [...(impact.reasonCodes ?? [])];

  // Add semantic codes
  if (severity === 'none' && !impact.isStale) {
    reason_codes.push(FRESHNESS_DIMENSION_REASON_CODES.FRESHNESS_INDEX_FRESH);
  } else if (severity === 'none' && impact.isStale) {
    // Stale but no intersection — explicitly note this
    reason_codes.push(FRESHNESS_DIMENSION_REASON_CODES.FRESHNESS_STALE_UNRELATED);
  } else if (severity !== 'none') {
    reason_codes.push(FRESHNESS_DIMENSION_REASON_CODES.FRESHNESS_SCOPE_STALE);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const pct = Math.round(impact.impactRatio * 100);
  const summary =
    status === 'pass'
      ? impact.isStale
        ? 'Index is stale but no required scope is impacted.'
        : 'Index is current — no freshness penalty.'
      : status === 'warn'
        ? `Index is stale — ${impact.intersectedScopeCount} required scope(s) affected (${pct}% impact ratio).`
        : status === 'escalate'
          ? `Staleness affecting ${impact.intersectedScopeCount} required scope(s) — ${pct}% impact. Reindex recommended.`
          : `Critical staleness — ${impact.intersectedScopeCount} required scope(s) blocked (${pct}% impact). Reindex required.`;

  return {
    value,
    status,
    reason_codes: [...new Set(reason_codes)],
    summary,
    provenance: {
      signals: ['freshnessImpact.severity', 'freshnessImpact.impactRatio', 'freshnessImpact.intersectedScopeCount'],
      thresholds: {},
    },
    metrics: {
      impactRatio: impact.impactRatio,
      intersectedScopeCount: impact.intersectedScopeCount,
      staleScopeCount: impact.staleScopeCount,
      requiredScopeCount: impact.requiredScopeCount,
      isStale: impact.isStale,
    },
  };
}
