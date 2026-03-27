/**
 * Regression Detection — Public API
 *
 * Re-exports all types, functions, and defaults for the regression detection module.
 */

export type {
  RunOutcomeSummaryRecord,
  RegressionReportRecord,
  RegressionFinding,
  RunMetrics,
  WindowSpec,
  RegressionThresholds,
} from './types.js';

export { DEFAULT_REGRESSION_THRESHOLDS } from './thresholds.js';

export { buildRunOutcomeSummary, type RunSummaryContext } from './summary.js';

export { computeRunMetrics } from './metrics.js';

export { buildCountWindow, buildTimeWindow } from './windows.js';

export { detectRegressions } from './detectors.js';

export { buildRegressionReport, type RegressionReportInput } from './report.js';
