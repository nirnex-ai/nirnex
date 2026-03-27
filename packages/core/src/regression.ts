/**
 * Regression — Public Entry Point
 *
 * Sprint 23: Historical regression detection using the Decision Ledger
 * as the canonical source of truth.
 *
 * Design contract:
 *   - Every completed run emits a normalized run_outcome_summary to the ledger
 *   - Historical summaries are queried from the ledger for window analysis
 *   - Regression detection is deterministic and rule-based (no statistical models)
 *   - Findings report correlated markers — never causal claims
 *
 * Typical usage:
 *   1. Enable outcome summary emission: runOrchestrator({ enableOutcomeSummary: true, ... })
 *   2. Query summaries: reader.fetchOutcomeSummaries()
 *   3. Build windows: buildCountWindow(summaries, 20) vs buildCountWindow(summaries, 5)
 *   4. Compute metrics: computeRunMetrics(window)
 *   5. Detect regressions: detectRegressions(baselineMetrics, currentMetrics, DEFAULT_REGRESSION_THRESHOLDS)
 *   6. Build report: buildRegressionReport({ ... })
 */

export {
  buildRunOutcomeSummary,
  computeRunMetrics,
  buildCountWindow,
  buildTimeWindow,
  detectRegressions,
  buildRegressionReport,
  DEFAULT_REGRESSION_THRESHOLDS,
  type RunOutcomeSummaryRecord,
  type RegressionReportRecord,
  type RegressionFinding,
  type RunMetrics,
  type WindowSpec,
  type RegressionThresholds,
  type RunSummaryContext,
  type RegressionReportInput,
} from './runtime/regression/index.js';
