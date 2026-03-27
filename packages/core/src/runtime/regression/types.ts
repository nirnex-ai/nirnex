/**
 * Regression Detection — Types
 *
 * Defines canonical types for historical regression detection using the
 * Decision Ledger as the authoritative source of truth.
 *
 * Design constraints:
 *   - Comparisons are deterministic and rule-based — no probabilistic models
 *   - Windows are count-based (primary) or time-based (secondary)
 *   - Findings report correlation markers — never causal claims
 *   - run_outcome_summary is the normalized per-run ledger record
 *   - regression_report is the analysis output — persisted to the ledger
 */

// ─── Outcome summary ──────────────────────────────────────────────────────────

/**
 * Normalized per-run summary record.
 * Emitted by the orchestrator at run completion (opt-in: enableOutcomeSummary).
 * Written to the ledger under stage='analysis'.
 *
 * This record is the primary input to regression detection.
 * All metrics are derived from this record family — not from raw pipeline state.
 */
export type RunOutcomeSummaryRecord = {
  kind: 'run_outcome_summary';

  /** trace_id of the run being summarized */
  summarized_trace_id: string;

  /** Terminal completion state for this run */
  completion_state: 'merged' | 'escalated' | 'abandoned' | 'refused';

  /** Final lane from CLASSIFY_LANE, null if pipeline was blocked before lane assignment */
  final_lane: 'A' | 'B' | 'C' | null;

  /** Final effective_confidence from eco stage, null if not available */
  final_confidence: number | null;

  /** true when completion_state === 'refused' */
  had_refusal: boolean;

  /** true when at least one override was applied during this run */
  had_override: boolean;

  /** true when forced_unknown was applied during evidence gate evaluation */
  forced_unknown_applied: boolean;

  /** true when evidence gate did not pass (behavior !== 'pass') */
  evidence_gate_failed: boolean;

  /** Number of pipeline stages that completed with status 'ok' */
  stages_completed: number;

  /** ISO 8601 timestamp of when the run occurred */
  run_timestamp: string;
};

// ─── Window spec ──────────────────────────────────────────────────────────────

/**
 * Window specification for baseline or current period selection.
 * Count-based windows are the primary comparison mechanism.
 * Time-based windows are the secondary mechanism.
 */
export type WindowSpec =
  | { kind: 'count'; count: number; label: string }
  | { kind: 'time'; days: number; label: string };

// ─── Run metrics ──────────────────────────────────────────────────────────────

/**
 * Aggregate metrics computed from a window of RunOutcomeSummaryRecords.
 * All rate metrics are in [0, 1]. Confidence metrics are in [0, 100].
 */
export interface RunMetrics {
  /** Number of runs in the window */
  run_count: number;

  /** Arithmetic mean of final_confidence (excluding null) */
  avg_confidence: number;

  /** Median of final_confidence (excluding null) */
  median_confidence: number;

  /** Fraction of runs with final_confidence < 60 */
  low_confidence_share: number;

  /** Fraction of runs where completion_state === 'refused' */
  refusal_rate: number;

  /** Fraction of runs where forced_unknown_applied === true */
  forced_unknown_rate: number;

  /** Fraction of runs where had_override === true */
  override_rate: number;

  /** Fraction of runs where evidence_gate_failed === true */
  evidence_gate_fail_rate: number;

  /** Fraction of runs where final_lane === 'C' */
  lane_c_rate: number;
}

// ─── Regression finding ───────────────────────────────────────────────────────

/**
 * A single detected metric regression.
 *
 * delta = current_value - baseline_value
 *   Negative delta = metric declined (e.g., confidence dropped)
 *   Positive delta = metric increased (e.g., refusal rate rose)
 *
 * correlated_markers: non-causal annotations. These describe co-occurring
 * patterns in the data — NOT causal explanations. Consumers must not interpret
 * these as root cause analysis.
 */
export interface RegressionFinding {
  /** Which metric regressed */
  metric_name: string;

  /** Value in the baseline window */
  baseline_value: number;

  /** Value in the current window */
  current_value: number;

  /** current_value - baseline_value */
  delta: number;

  /** Threshold that was breached (absolute value of required delta) */
  threshold: number;

  /** Severity classification based on threshold comparison */
  severity: 'warn' | 'escalate';

  /** Human-readable description of the regression */
  description: string;

  /**
   * Co-occurring patterns in the same window.
   * NOTE: These are correlation observations, NOT causal claims.
   * Do not infer cause-and-effect relationships from these markers.
   */
  correlated_markers: string[];
}

// ─── Regression thresholds ────────────────────────────────────────────────────

/**
 * Rule-based threshold configuration for regression detection.
 * All delta values represent the minimum change magnitude that triggers the
 * corresponding severity level.
 *
 * For confidence metrics: negative deltas trigger (decline = regression).
 * For rate metrics: positive deltas trigger (increase = regression).
 */
export interface RegressionThresholds {
  /** Confidence drop (negative number) that triggers warn */
  avg_confidence_warn_delta: number;

  /** Confidence drop (negative number) that triggers escalate */
  avg_confidence_escalate_delta: number;

  /** Refusal rate increase that triggers warn */
  refusal_rate_warn_delta: number;

  /** Refusal rate increase that triggers escalate */
  refusal_rate_escalate_delta: number;

  /** Low confidence share increase that triggers warn */
  low_confidence_share_warn_delta: number;

  /** Low confidence share increase that triggers escalate */
  low_confidence_share_escalate_delta: number;
}

// ─── Regression report ────────────────────────────────────────────────────────

/**
 * Full regression detection report.
 * Persisted to the ledger under stage='analysis', record_type='regression_report'.
 *
 * overall_severity reflects the worst severity across all findings:
 *   'none'     — no regressions detected
 *   'warn'     — at least one warn finding, no escalate findings
 *   'escalate' — at least one escalate finding
 */
export type RegressionReportRecord = {
  kind: 'regression_report';

  /** Optional: scope this report to a specific run context */
  scope_trace_id?: string;

  /** Description of the baseline comparison window */
  baseline_window: WindowSpec;

  /** Description of the current comparison window */
  current_window: WindowSpec;

  /** Number of runs in the baseline window */
  baseline_run_count: number;

  /** Number of runs in the current window */
  current_run_count: number;

  /** Aggregate metrics from the baseline window */
  baseline_metrics: RunMetrics;

  /** Aggregate metrics from the current window */
  current_metrics: RunMetrics;

  /** All detected regression findings */
  findings: RegressionFinding[];

  /** Worst severity across all findings */
  overall_severity: 'none' | 'warn' | 'escalate';

  /** ISO 8601 timestamp when this report was generated */
  generated_at: string;
};
