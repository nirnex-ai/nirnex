/**
 * Regression Detection — Report Builder
 *
 * Constructs a RegressionReportRecord from detection inputs.
 * The report is the persisted artifact — written to the ledger.
 *
 * overall_severity derivation:
 *   any escalate finding  → 'escalate'
 *   any warn finding      → 'warn'
 *   no findings           → 'none'
 */

import type {
  RegressionReportRecord,
  RegressionFinding,
  RunMetrics,
  WindowSpec,
} from './types.js';

// ─── buildRegressionReport ────────────────────────────────────────────────────

export interface RegressionReportInput {
  baselineWindow:    WindowSpec;
  currentWindow:     WindowSpec;
  baselineRunCount:  number;
  currentRunCount:   number;
  baselineMetrics:   RunMetrics;
  currentMetrics:    RunMetrics;
  findings:          RegressionFinding[];
  scopeTraceId?:     string;
}

/**
 * Build a RegressionReportRecord from detection inputs.
 *
 * @param input - detection inputs including windows, metrics, and findings
 * @returns     - RegressionReportRecord ready to persist to the ledger
 */
export function buildRegressionReport(input: RegressionReportInput): RegressionReportRecord {
  const overall_severity = computeOverallSeverity(input.findings);

  return {
    kind:                'regression_report',
    scope_trace_id:      input.scopeTraceId,
    baseline_window:     input.baselineWindow,
    current_window:      input.currentWindow,
    baseline_run_count:  input.baselineRunCount,
    current_run_count:   input.currentRunCount,
    baseline_metrics:    input.baselineMetrics,
    current_metrics:     input.currentMetrics,
    findings:            input.findings,
    overall_severity,
    generated_at:        new Date().toISOString(),
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function computeOverallSeverity(
  findings: RegressionFinding[],
): RegressionReportRecord['overall_severity'] {
  if (findings.some(f => f.severity === 'escalate')) return 'escalate';
  if (findings.some(f => f.severity === 'warn'))     return 'warn';
  return 'none';
}
