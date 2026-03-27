/**
 * Regression Detection — Detectors
 *
 * Rule-based metric regression detection.
 * Compares current window metrics against baseline metrics using thresholds.
 *
 * Design constraints:
 *   - Deterministic: same inputs always produce same findings
 *   - Rule-based: no statistical models or probabilistic inference
 *   - Findings include correlated_markers — these are NOT causal claims
 *   - severity escalate supersedes warn when both thresholds are breached
 */

import type { RunMetrics, RegressionFinding, RegressionThresholds } from './types.js';

// ─── detectRegressions ────────────────────────────────────────────────────────

/**
 * Detect metric regressions by comparing current metrics against baseline.
 *
 * For each tracked metric:
 *   1. Compute delta = current - baseline
 *   2. If delta breaches escalate threshold → escalate finding
 *   3. Else if delta breaches warn threshold → warn finding
 *   4. Otherwise → no finding for this metric
 *
 * @param baseline   - aggregate metrics from the baseline window
 * @param current    - aggregate metrics from the current window
 * @param thresholds - rule-based threshold configuration
 * @returns          - list of detected regression findings (empty if none)
 */
export function detectRegressions(
  baseline: RunMetrics,
  current: RunMetrics,
  thresholds: RegressionThresholds,
): RegressionFinding[] {
  const findings: RegressionFinding[] = [];

  // ── avg_confidence (decline = regression) ──────────────────────────────────
  const confidenceDelta = current.avg_confidence - baseline.avg_confidence;
  if (confidenceDelta <= thresholds.avg_confidence_escalate_delta) {
    findings.push(makeFinding({
      metric_name:     'avg_confidence',
      baseline_value:  baseline.avg_confidence,
      current_value:   current.avg_confidence,
      delta:           confidenceDelta,
      threshold:       Math.abs(thresholds.avg_confidence_escalate_delta),
      severity:        'escalate',
      description:     `avg_confidence dropped by ${Math.abs(confidenceDelta).toFixed(1)} points (baseline: ${baseline.avg_confidence.toFixed(1)}, current: ${current.avg_confidence.toFixed(1)})`,
      correlated: buildCorrelatedMarkers(baseline, current),
    }));
  } else if (confidenceDelta <= thresholds.avg_confidence_warn_delta) {
    findings.push(makeFinding({
      metric_name:     'avg_confidence',
      baseline_value:  baseline.avg_confidence,
      current_value:   current.avg_confidence,
      delta:           confidenceDelta,
      threshold:       Math.abs(thresholds.avg_confidence_warn_delta),
      severity:        'warn',
      description:     `avg_confidence dropped by ${Math.abs(confidenceDelta).toFixed(1)} points (baseline: ${baseline.avg_confidence.toFixed(1)}, current: ${current.avg_confidence.toFixed(1)})`,
      correlated: buildCorrelatedMarkers(baseline, current),
    }));
  }

  // ── refusal_rate (increase = regression) ───────────────────────────────────
  const refusalDelta = current.refusal_rate - baseline.refusal_rate;
  if (refusalDelta >= thresholds.refusal_rate_escalate_delta) {
    findings.push(makeFinding({
      metric_name:    'refusal_rate',
      baseline_value: baseline.refusal_rate,
      current_value:  current.refusal_rate,
      delta:          refusalDelta,
      threshold:      thresholds.refusal_rate_escalate_delta,
      severity:       'escalate',
      description:    `refusal_rate increased by ${(refusalDelta * 100).toFixed(1)}pp (baseline: ${(baseline.refusal_rate * 100).toFixed(1)}%, current: ${(current.refusal_rate * 100).toFixed(1)}%)`,
      correlated: buildCorrelatedMarkers(baseline, current),
    }));
  } else if (refusalDelta >= thresholds.refusal_rate_warn_delta) {
    findings.push(makeFinding({
      metric_name:    'refusal_rate',
      baseline_value: baseline.refusal_rate,
      current_value:  current.refusal_rate,
      delta:          refusalDelta,
      threshold:      thresholds.refusal_rate_warn_delta,
      severity:       'warn',
      description:    `refusal_rate increased by ${(refusalDelta * 100).toFixed(1)}pp (baseline: ${(baseline.refusal_rate * 100).toFixed(1)}%, current: ${(current.refusal_rate * 100).toFixed(1)}%)`,
      correlated: buildCorrelatedMarkers(baseline, current),
    }));
  }

  // ── low_confidence_share (increase = regression) ───────────────────────────
  const lowConfDelta = current.low_confidence_share - baseline.low_confidence_share;
  if (lowConfDelta >= thresholds.low_confidence_share_escalate_delta) {
    findings.push(makeFinding({
      metric_name:    'low_confidence_share',
      baseline_value: baseline.low_confidence_share,
      current_value:  current.low_confidence_share,
      delta:          lowConfDelta,
      threshold:      thresholds.low_confidence_share_escalate_delta,
      severity:       'escalate',
      description:    `low_confidence_share increased by ${(lowConfDelta * 100).toFixed(1)}pp`,
      correlated: buildCorrelatedMarkers(baseline, current),
    }));
  } else if (lowConfDelta >= thresholds.low_confidence_share_warn_delta) {
    findings.push(makeFinding({
      metric_name:    'low_confidence_share',
      baseline_value: baseline.low_confidence_share,
      current_value:  current.low_confidence_share,
      delta:          lowConfDelta,
      threshold:      thresholds.low_confidence_share_warn_delta,
      severity:       'warn',
      description:    `low_confidence_share increased by ${(lowConfDelta * 100).toFixed(1)}pp`,
      correlated: buildCorrelatedMarkers(baseline, current),
    }));
  }

  return findings;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

interface FindingInput {
  metric_name: string;
  baseline_value: number;
  current_value: number;
  delta: number;
  threshold: number;
  severity: 'warn' | 'escalate';
  description: string;
  correlated: string[];
}

function makeFinding(input: FindingInput): RegressionFinding {
  return {
    metric_name:       input.metric_name,
    baseline_value:    input.baseline_value,
    current_value:     input.current_value,
    delta:             input.delta,
    threshold:         input.threshold,
    severity:          input.severity,
    description:       input.description,
    correlated_markers: input.correlated,
  };
}

/**
 * Build correlation markers from metric deltas.
 *
 * NOTE: These are correlation observations — NOT causal explanations.
 * They annotate co-occurring patterns in the comparison window.
 */
function buildCorrelatedMarkers(baseline: RunMetrics, current: RunMetrics): string[] {
  const markers: string[] = [];

  const refusalDelta = current.refusal_rate - baseline.refusal_rate;
  if (Math.abs(refusalDelta) >= 0.05) {
    markers.push(`correlated: refusal_rate ${refusalDelta >= 0 ? '+' : ''}${(refusalDelta * 100).toFixed(1)}pp`);
  }

  const lowConfDelta = current.low_confidence_share - baseline.low_confidence_share;
  if (Math.abs(lowConfDelta) >= 0.1) {
    markers.push(`correlated: low_confidence_share ${lowConfDelta >= 0 ? '+' : ''}${(lowConfDelta * 100).toFixed(1)}pp`);
  }

  if (current.lane_c_rate > baseline.lane_c_rate + 0.1) {
    markers.push(`correlated: lane_c_rate increased (baseline: ${(baseline.lane_c_rate * 100).toFixed(0)}%, current: ${(current.lane_c_rate * 100).toFixed(0)}%)`);
  }

  return markers;
}
