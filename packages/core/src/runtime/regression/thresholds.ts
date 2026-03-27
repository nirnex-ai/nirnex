/**
 * Regression Detection — Default Thresholds
 *
 * Deterministic rule-based thresholds for metric regression classification.
 *
 * Threshold semantics:
 *   avg_confidence_*_delta — negative number (confidence decline triggers detection)
 *   *_rate_*_delta         — positive number (rate increase triggers detection)
 */

import type { RegressionThresholds } from './types.js';

/**
 * Default regression thresholds.
 *
 * avg_confidence:
 *   warn     — confidence dropped ≥ 10 points from baseline
 *   escalate — confidence dropped ≥ 20 points from baseline
 *
 * refusal_rate:
 *   warn     — refusal rate increased ≥ 10 percentage points
 *   escalate — refusal rate increased ≥ 20 percentage points
 *
 * low_confidence_share:
 *   warn     — low-confidence share increased ≥ 15 percentage points
 *   escalate — low-confidence share increased ≥ 25 percentage points
 */
export const DEFAULT_REGRESSION_THRESHOLDS: RegressionThresholds = {
  avg_confidence_warn_delta:     -10,
  avg_confidence_escalate_delta: -20,

  refusal_rate_warn_delta:     0.10,
  refusal_rate_escalate_delta: 0.20,

  low_confidence_share_warn_delta:     0.15,
  low_confidence_share_escalate_delta: 0.25,
};
