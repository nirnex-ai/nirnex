/**
 * Graph Completeness Dimension Evaluator
 *
 * Measures whether the graph/index is sufficiently complete for the requested
 * reasoning path — NOT graph quality in general.
 *
 * "Complete enough for this request" vs. "complete in general" is the
 * critical distinction. A large but irrelevant gap is less dangerous than
 * a small but critical gap in the requested scope.
 *
 * Inputs (from DimensionSignals):
 *   - parseFailureCount    → files in scope that failed to parse
 *   - brokenSymbolCount    → symbol refs that couldn't be resolved
 *   - totalSymbolCount     → 0 means unknown state → emit warn (not pass)
 *   - graphDepthAchieved/Requested → depth truncation
 *   - fallbackUsageRate    → approximation usage
 *   - criticalNodesMissing → hard block condition
 *
 * Design constraints:
 *   - Must not depend on coverage, freshness, mapping, or conflict results
 *   - criticalNodesMissing > 0 → always block
 *   - totalSymbolCount == 0 → unknown state → warn (never silent pass)
 */

import type { DimensionResult, DimensionSignals, DimensionThresholds } from './types.js';
import { GRAPH_REASON_CODES } from './reason-codes.js';

export function computeGraphCompletenessDimension(
  signals: DimensionSignals,
  thresholds: DimensionThresholds,
): DimensionResult {
  const { graph: t } = thresholds;
  const {
    parseFailureCount,
    brokenSymbolCount,
    totalSymbolCount,
    symbolsResolved,
    symbolsUnresolved,
    graphDepthAchieved,
    graphDepthRequested,
    fallbackUsageRate,
    criticalNodesMissing,
  } = signals;

  const reason_codes: string[] = [];

  // ── Hard block: critical nodes missing ────────────────────────────────────
  if (criticalNodesMissing > 0) {
    reason_codes.push(GRAPH_REASON_CODES.GRAPH_CRITICAL_NODES_MISSING);
    return {
      value: 0.05,
      status: 'block',
      reason_codes,
      summary: `Graph incomplete — ${criticalNodesMissing} critical node(s) missing from required scope.`,
      provenance: {
        signals: ['criticalNodesMissing'],
        thresholds: { pass: t.pass, warn: t.warn, escalate: t.escalate },
      },
      metrics: {
        parseFailureCount,
        criticalNodesMissing,
        symbolResolutionRate: 0,
        depthRatio: 0,
      },
    };
  }

  // ── Unknown symbol state (totalSymbolCount = 0) ────────────────────────────
  // We cannot verify symbol resolution when total count is unknown.
  // Emit warn — do not silently pass.
  if (totalSymbolCount === 0 && parseFailureCount === 0 && fallbackUsageRate === 0) {
    reason_codes.push(GRAPH_REASON_CODES.GRAPH_SYMBOL_RESOLUTION_UNKNOWN);
    return {
      value: 0.70,
      status: 'warn',
      reason_codes,
      summary: 'Graph symbol state unknown — unable to verify resolution completeness.',
      provenance: {
        signals: ['totalSymbolCount'],
        thresholds: { pass: t.pass, warn: t.warn, escalate: t.escalate },
      },
      metrics: {
        parseFailureCount: 0,
        totalSymbolCount: 0,
        symbolResolutionRate: 0,
        depthRatio: graphDepthRequested > 0
          ? Math.min(graphDepthAchieved / graphDepthRequested, 1)
          : 1,
      },
    };
  }

  // ── Symbol resolution rate ────────────────────────────────────────────────
  // Priority: use symbolsResolved + symbolsUnresolved when available (direct observation).
  // Fall back to totalSymbolCount - brokenSymbolCount when that's all we have.
  const directObservedTotal = symbolsResolved + symbolsUnresolved + brokenSymbolCount;
  const symbolResolutionRate: number = (() => {
    if (directObservedTotal > 0) {
      // Use directly observed resolved/unresolved counts
      return symbolsResolved / directObservedTotal;
    }
    if (totalSymbolCount > 0) {
      return Math.max(0, 1 - (brokenSymbolCount / totalSymbolCount));
    }
    return 1.0; // no symbols in scope → not applicable
  })();

  // ── Depth ratio ───────────────────────────────────────────────────────────
  const depthRatio = graphDepthRequested > 0
    ? Math.min(graphDepthAchieved / graphDepthRequested, 1.0)
    : 1.0; // no specific depth required → full

  // ── Parse failure penalty ─────────────────────────────────────────────────
  const parseFailurePenalty = Math.min(parseFailureCount * 0.20, 0.60);

  // ── Fallback penalty ──────────────────────────────────────────────────────
  const fallbackPenalty = Math.min(fallbackUsageRate * 0.30, 0.30);

  // ── Composite value ───────────────────────────────────────────────────────
  const value = Math.max(
    0,
    symbolResolutionRate * (1 - parseFailurePenalty) * depthRatio * (1 - fallbackPenalty),
  );

  // ── Reason codes ──────────────────────────────────────────────────────────
  if (parseFailureCount > 0) {
    reason_codes.push(GRAPH_REASON_CODES.GRAPH_SCOPE_PARSE_FAILURE);
  }
  if (symbolResolutionRate < 0.95 && directObservedTotal > 0) {
    reason_codes.push(GRAPH_REASON_CODES.GRAPH_SYMBOL_RESOLUTION_DEGRADED);
  }
  if (depthRatio < 0.80) {
    reason_codes.push(GRAPH_REASON_CODES.GRAPH_DEPTH_TRUNCATED);
  }
  if (fallbackUsageRate >= 0.30) {
    reason_codes.push(GRAPH_REASON_CODES.GRAPH_FALLBACK_HIGH);
  }

  // ── Status determination ──────────────────────────────────────────────────
  let status: DimensionResult['status'];

  if (value >= t.pass && parseFailureCount === 0 && symbolsUnresolved === 0) {
    // Fully clean: no parse failures, no unresolved symbols, high value
    status = 'pass';
    if (reason_codes.length === 0) {
      reason_codes.push(GRAPH_REASON_CODES.GRAPH_COMPLETE);
    }
  } else if ((value >= t.warn && parseFailureCount === 0) || parseFailureCount === 1) {
    // Value in warn range with no hard failures; or exactly 1 parse failure
    // Note: symbolsUnresolved > 0 prevents 'pass' above but still allows 'warn' here
    status = 'warn';
  } else if (value >= t.escalate || parseFailureCount >= 2) {
    status = 'escalate';
  } else {
    status = 'block';
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const resolutionPct = Math.round(symbolResolutionRate * 100);
  const summary =
    status === 'pass'
      ? 'Graph complete — no parse failures, full symbol resolution.'
      : status === 'warn'
        ? `Graph mostly complete — ${parseFailureCount > 0 ? `${parseFailureCount} parse failure(s)` : `${resolutionPct}% symbol resolution`}.`
        : status === 'escalate'
          ? `Graph degraded — ${parseFailureCount} parse failure(s), ${resolutionPct}% symbol resolution.`
          : `Graph seriously incomplete — critical resolution failures in required scope.`;

  return {
    value,
    status,
    reason_codes: [...new Set(reason_codes)],
    summary,
    provenance: {
      signals: ['parseFailureCount', 'brokenSymbolCount', 'totalSymbolCount', 'graphDepthAchieved', 'graphDepthRequested', 'fallbackUsageRate', 'criticalNodesMissing'],
      thresholds: { pass: t.pass, warn: t.warn, escalate: t.escalate },
    },
    metrics: {
      parseFailureCount,
      symbolResolutionRate: Number(symbolResolutionRate.toFixed(4)),
      depthRatio: Number(depthRatio.toFixed(4)),
      fallbackUsageRate: Number(fallbackUsageRate.toFixed(4)),
      brokenSymbolCount,
      totalSymbolCount,
      criticalNodesMissing,
    },
  };
}
