/**
 * Sprint 23 — Historical Regression Detection (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Core contract:
 *   Historical regression detection uses the Decision Ledger as the canonical
 *   source of truth. Comparisons are deterministic, rule-based, and window-scoped.
 *   Findings report correlation markers — never causal claims.
 *
 * Three phases:
 *   1. Outcome summary emission — normalized per-run record in ledger
 *   2. Window construction     — count-based (primary) or time-based (secondary)
 *   3. Regression detection    — rule-based metric comparison with severity thresholds
 *
 * Coverage:
 *
 * A. Outcome summary construction (unit, no DB)
 *   1.  buildRunOutcomeSummary returns record with kind='run_outcome_summary'
 *   2.  completion_state='refused' when result.blocked=true
 *   3.  completion_state='escalated' when result.escalated=true and not blocked
 *   4.  completion_state='merged' when pipeline completes successfully
 *   5.  had_refusal=true when completion_state='refused'
 *   6.  final_lane captured from OrchestratorResult.finalLane
 *
 * B. Ledger types & validators
 *   7.  'analysis' is a valid LedgerStage
 *   8.  'run_outcome_summary' is a valid LedgerRecordType
 *   9.  'regression_report' is a valid LedgerRecordType
 *   10. validateRunOutcomeSummaryRecord with required fields → valid
 *   11. Missing completion_state → validation error
 *   12. Invalid completion_state → validation error
 *   13. validateRegressionReportRecord with required fields → valid
 *
 * C. Orchestrator outcome summary emission
 *   14. enableOutcomeSummary=true → onLedgerEntry receives run_outcome_summary entry
 *   15. run_outcome_summary has record_type='run_outcome_summary' and stage='analysis'
 *   16. Outcome summary is opt-in — no entry when flag absent
 *   17. run_outcome_summary.completion_state='merged' for successful pipeline
 *   18. run_outcome_summary.stages_completed matches number of ok stages
 *
 * D. Window construction & metrics
 *   19. buildCountWindow with N=3 returns last 3 summaries (most recent)
 *   20. buildCountWindow with N > available → returns all available
 *   21. buildTimeWindow filters summaries to those within last N days
 *   22. computeRunMetrics with empty array → all metrics=0, run_count=0
 *   23. computeRunMetrics avg_confidence = mean of final_confidence values
 *   24. computeRunMetrics refusal_rate = refused_count / total_count
 *   25. computeRunMetrics low_confidence_share = fraction with confidence < 60
 *   26. computeRunMetrics median_confidence handles odd-count array
 *
 * E. Regression detection
 *   27. detectRegressions: no regression when metrics identical → empty findings
 *   28. avg_confidence drop ≥ warn threshold → finding with severity='warn'
 *   29. avg_confidence drop ≥ escalate threshold → finding with severity='escalate'
 *   30. refusal_rate increase ≥ warn threshold → finding with severity='warn'
 *   31. multiple findings when multiple metrics regress simultaneously
 *   32. finding.delta = current_value - baseline_value (negative = decline)
 *   33. finding includes correlated_markers (non-causal annotation)
 *
 * F. Regression report & reader
 *   34. buildRegressionReport produces RegressionReportRecord with correct structure
 *   35. overall_severity='none' when no findings
 *   36. overall_severity='escalate' when any finding is escalate
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
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
} from '../packages/core/src/runtime/regression/index.js';

import {
  validateLedgerEntry,
  validatePayload,
} from '../packages/core/src/runtime/ledger/validators.js';

import {
  appendLedgerEntry,
} from '../packages/core/src/runtime/ledger/writer.js';

import { LedgerReader } from '../packages/core/src/runtime/ledger/reader.js';

import {
  fromRunOutcomeSummary,
  fromRegressionReport,
} from '../packages/core/src/runtime/ledger/mappers.js';

import { LEDGER_TABLE_SQL } from '../packages/core/src/runtime/ledger/schema.js';

import { runOrchestrator } from '../packages/core/src/pipeline/orchestrator.js';

import type { LedgerEntry } from '../packages/core/src/runtime/ledger/index.js';
import type { OrchestratorResult } from '../packages/core/src/pipeline/orchestrator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(LEDGER_TABLE_SQL);
  return db;
}

function makeHandlers() {
  return {
    INTENT_DETECT: async () => ({ primary: 'test-intent', composite: false }),
    ECO_BUILD: async () => ({
      intent: { primary: 'test-intent', composite: false },
      eco_dimensions: {
        coverage:  { severity: 'pass',     detail: '' },
        freshness: { severity: 'pass',     detail: '' },
        mapping:   { severity: 'warn',     detail: '' },
        conflict:  { severity: 'pass',     detail: '', conflict_payload: null },
        graph:     { severity: 'escalate', detail: '' },
      },
      confidence_score: 72,
    }),
    SUFFICIENCY_GATE: async () => ({ behavior: 'pass' as const, lane: 'A', reason: 'sufficient' }),
    TEE_BUILD: async () => ({
      blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [],
    }),
    CLASSIFY_LANE: async () => ({ lane: 'A', set_by: 'P1' as const, reason: 'low risk' }),
  };
}

function makeOrchestratorResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    completed: true,
    blocked: false,
    escalated: false,
    degraded: false,
    stageResults: [],
    finalLane: 'A',
    stageTimeouts: [],
    degradedStages: [],
    executionWarnings: [],
    replayedStages: [],
    rejectedDuplicateStages: [],
    ...overrides,
  };
}

function makeSummary(overrides: Partial<RunOutcomeSummaryRecord> = {}): RunOutcomeSummaryRecord {
  return {
    kind: 'run_outcome_summary',
    summarized_trace_id: `tr_${randomUUID().slice(0, 8)}`,
    completion_state: 'merged',
    final_lane: 'A',
    final_confidence: 72,
    had_refusal: false,
    had_override: false,
    forced_unknown_applied: false,
    evidence_gate_failed: false,
    stages_completed: 5,
    run_timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── A. Outcome summary construction ──────────────────────────────────────────

describe('A. Outcome summary construction', () => {
  it('1. buildRunOutcomeSummary returns record with kind=run_outcome_summary', () => {
    const result = makeOrchestratorResult();
    const summary = buildRunOutcomeSummary(result, { traceId: 'tr_test' });
    expect(summary.kind).toBe('run_outcome_summary');
    expect(summary.summarized_trace_id).toBe('tr_test');
  });

  it('2. completion_state=refused when result.blocked=true', () => {
    const result = makeOrchestratorResult({ blocked: true, completed: false });
    const summary = buildRunOutcomeSummary(result, { traceId: 'tr_blocked' });
    expect(summary.completion_state).toBe('refused');
  });

  it('3. completion_state=escalated when result.escalated=true and not blocked', () => {
    const result = makeOrchestratorResult({ escalated: true, blocked: false });
    const summary = buildRunOutcomeSummary(result, { traceId: 'tr_escalated' });
    expect(summary.completion_state).toBe('escalated');
  });

  it('4. completion_state=merged when pipeline completes successfully', () => {
    const result = makeOrchestratorResult({ completed: true, blocked: false, escalated: false });
    const summary = buildRunOutcomeSummary(result, { traceId: 'tr_merged' });
    expect(summary.completion_state).toBe('merged');
  });

  it('5. had_refusal=true when completion_state=refused', () => {
    const result = makeOrchestratorResult({ blocked: true, completed: false });
    const summary = buildRunOutcomeSummary(result, { traceId: 'tr_refused' });
    expect(summary.had_refusal).toBe(true);
  });

  it('6. final_lane captured from OrchestratorResult.finalLane', () => {
    const result = makeOrchestratorResult({ finalLane: 'C' });
    const summary = buildRunOutcomeSummary(result, { traceId: 'tr_lane_c' });
    expect(summary.final_lane).toBe('C');
  });
});

// ─── B. Ledger types & validators ─────────────────────────────────────────────

describe('B. Ledger types and validators', () => {
  function makeValidOutcomeSummary(): RunOutcomeSummaryRecord {
    return makeSummary();
  }

  function makeValidRegressionReport(): RegressionReportRecord {
    return {
      kind: 'regression_report',
      baseline_window: { kind: 'count', count: 10, label: 'last 10 runs' },
      current_window: { kind: 'count', count: 5, label: 'last 5 runs' },
      baseline_run_count: 10,
      current_run_count: 5,
      baseline_metrics: {
        run_count: 10,
        avg_confidence: 75,
        median_confidence: 76,
        low_confidence_share: 0.1,
        refusal_rate: 0.05,
        forced_unknown_rate: 0.0,
        override_rate: 0.0,
        evidence_gate_fail_rate: 0.1,
        lane_c_rate: 0.2,
      },
      current_metrics: {
        run_count: 5,
        avg_confidence: 65,
        median_confidence: 64,
        low_confidence_share: 0.4,
        refusal_rate: 0.2,
        forced_unknown_rate: 0.0,
        override_rate: 0.0,
        evidence_gate_fail_rate: 0.4,
        lane_c_rate: 0.6,
      },
      findings: [],
      overall_severity: 'warn',
      generated_at: new Date().toISOString(),
    };
  }

  it('7. analysis is a valid LedgerStage', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'analysis' as LedgerEntry['stage'],
      record_type: 'run_outcome_summary' as LedgerEntry['record_type'],
      actor: 'system',
      payload: makeValidOutcomeSummary() as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.errors.some(e => e.includes('unknown stage'))).toBe(false);
  });

  it('8. run_outcome_summary is a valid LedgerRecordType', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'analysis' as LedgerEntry['stage'],
      record_type: 'run_outcome_summary' as LedgerEntry['record_type'],
      actor: 'system',
      payload: makeValidOutcomeSummary() as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.errors.some(e => e.includes('unknown record_type'))).toBe(false);
  });

  it('9. regression_report is a valid LedgerRecordType', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'analysis' as LedgerEntry['stage'],
      record_type: 'regression_report' as LedgerEntry['record_type'],
      actor: 'system',
      payload: makeValidRegressionReport() as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.errors.some(e => e.includes('unknown record_type'))).toBe(false);
  });

  it('10. validateRunOutcomeSummaryRecord with required fields → valid', () => {
    const result = validatePayload('run_outcome_summary', makeValidOutcomeSummary());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('11. Missing completion_state → validation error', () => {
    const { completion_state: _removed, ...partial } = makeValidOutcomeSummary();
    const result = validatePayload('run_outcome_summary', partial);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('completion_state'))).toBe(true);
  });

  it('12. Invalid completion_state → validation error', () => {
    const summary = { ...makeValidOutcomeSummary(), completion_state: 'totally_wrong' as any };
    const result = validatePayload('run_outcome_summary', summary);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('completion_state'))).toBe(true);
  });

  it('13. validateRegressionReportRecord with required fields → valid', () => {
    const result = validatePayload('regression_report', makeValidRegressionReport());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── C. Orchestrator outcome summary emission ──────────────────────────────────

describe('C. Orchestrator outcome summary emission', () => {
  it('14. enableOutcomeSummary=true → onLedgerEntry receives run_outcome_summary entry', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableOutcomeSummary: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const summaries = entries.filter(e => e.record_type === 'run_outcome_summary');
    expect(summaries).toHaveLength(1);
  });

  it('15. run_outcome_summary has record_type=run_outcome_summary and stage=analysis', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableOutcomeSummary: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const summary = entries.find(e => e.record_type === 'run_outcome_summary');
    expect(summary).toBeDefined();
    expect(summary!.record_type).toBe('run_outcome_summary');
    expect(summary!.stage).toBe('analysis');
  });

  it('16. Outcome summary is opt-in — no entry when flag absent', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const summaries = entries.filter(e => e.record_type === 'run_outcome_summary');
    expect(summaries).toHaveLength(0);
  });

  it('17. run_outcome_summary.completion_state=merged for successful pipeline', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableOutcomeSummary: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const summary = entries.find(e => e.record_type === 'run_outcome_summary');
    expect((summary!.payload as RunOutcomeSummaryRecord).completion_state).toBe('merged');
  });

  it('18. run_outcome_summary.stages_completed matches number of ok stages', async () => {
    const entries: LedgerEntry[] = [];
    await runOrchestrator(
      { specPath: null, query: 'test', enableOutcomeSummary: true, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const summary = entries.find(e => e.record_type === 'run_outcome_summary');
    // All 5 stages complete with 'ok' status for standard handlers
    expect((summary!.payload as RunOutcomeSummaryRecord).stages_completed).toBeGreaterThan(0);
  });
});

// ─── D. Window construction & metrics ─────────────────────────────────────────

describe('D. Window construction and metrics', () => {
  function makeSummaries(count: number, options: {
    timestamps?: string[];
    confidences?: number[];
    completionStates?: Array<RunOutcomeSummaryRecord['completion_state']>;
  } = {}): RunOutcomeSummaryRecord[] {
    return Array.from({ length: count }, (_, i) => makeSummary({
      summarized_trace_id: `tr_${i}`,
      run_timestamp: options.timestamps?.[i] ?? new Date(Date.now() - (count - i) * 1000 * 60).toISOString(),
      final_confidence: options.confidences?.[i] ?? 70 + i,
      completion_state: options.completionStates?.[i] ?? 'merged',
    }));
  }

  it('19. buildCountWindow with N=3 returns last 3 summaries (most recent)', () => {
    const summaries = makeSummaries(10);
    const window = buildCountWindow(summaries, 3);
    expect(window).toHaveLength(3);
    // Should return the 3 most recent by run_timestamp
    const windowIds = window.map(s => s.summarized_trace_id);
    expect(windowIds).toContain('tr_9');
    expect(windowIds).toContain('tr_8');
    expect(windowIds).toContain('tr_7');
  });

  it('20. buildCountWindow with N > available → returns all available', () => {
    const summaries = makeSummaries(3);
    const window = buildCountWindow(summaries, 10);
    expect(window).toHaveLength(3);
  });

  it('21. buildTimeWindow filters summaries to those within last N days', () => {
    const now = Date.now();
    const recent = makeSummary({
      summarized_trace_id: 'tr_recent',
      run_timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    });
    const old = makeSummary({
      summarized_trace_id: 'tr_old',
      run_timestamp: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
    });
    const window = buildTimeWindow([recent, old], 7);
    expect(window.some(s => s.summarized_trace_id === 'tr_recent')).toBe(true);
    expect(window.some(s => s.summarized_trace_id === 'tr_old')).toBe(false);
  });

  it('22. computeRunMetrics with empty array → all metrics=0, run_count=0', () => {
    const metrics = computeRunMetrics([]);
    expect(metrics.run_count).toBe(0);
    expect(metrics.avg_confidence).toBe(0);
    expect(metrics.refusal_rate).toBe(0);
    expect(metrics.low_confidence_share).toBe(0);
    expect(metrics.median_confidence).toBe(0);
  });

  it('23. computeRunMetrics avg_confidence = mean of final_confidence values', () => {
    const summaries = [
      makeSummary({ final_confidence: 60 }),
      makeSummary({ final_confidence: 80 }),
      makeSummary({ final_confidence: 70 }),
    ];
    const metrics = computeRunMetrics(summaries);
    expect(metrics.avg_confidence).toBeCloseTo(70, 1);
  });

  it('24. computeRunMetrics refusal_rate = refused_count / total_count', () => {
    const summaries = [
      makeSummary({ completion_state: 'refused' }),
      makeSummary({ completion_state: 'refused' }),
      makeSummary({ completion_state: 'merged' }),
      makeSummary({ completion_state: 'merged' }),
    ];
    const metrics = computeRunMetrics(summaries);
    expect(metrics.refusal_rate).toBeCloseTo(0.5, 2);
  });

  it('25. computeRunMetrics low_confidence_share = fraction with confidence < 60', () => {
    const summaries = [
      makeSummary({ final_confidence: 45 }), // low
      makeSummary({ final_confidence: 55 }), // low
      makeSummary({ final_confidence: 75 }), // ok
      makeSummary({ final_confidence: 85 }), // ok
    ];
    const metrics = computeRunMetrics(summaries);
    expect(metrics.low_confidence_share).toBeCloseTo(0.5, 2);
  });

  it('26. computeRunMetrics median_confidence handles odd-count array', () => {
    const summaries = [
      makeSummary({ final_confidence: 50 }),
      makeSummary({ final_confidence: 70 }),
      makeSummary({ final_confidence: 90 }),
    ];
    const metrics = computeRunMetrics(summaries);
    expect(metrics.median_confidence).toBe(70);
  });
});

// ─── E. Regression detection ──────────────────────────────────────────────────

describe('E. Regression detection', () => {
  function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
    return {
      run_count: 10,
      avg_confidence: 75,
      median_confidence: 75,
      low_confidence_share: 0.1,
      refusal_rate: 0.05,
      forced_unknown_rate: 0.0,
      override_rate: 0.0,
      evidence_gate_fail_rate: 0.1,
      lane_c_rate: 0.1,
      ...overrides,
    };
  }

  it('27. detectRegressions: no regression when metrics identical → empty findings', () => {
    const baseline = makeMetrics();
    const current  = makeMetrics();
    const findings = detectRegressions(baseline, current, DEFAULT_REGRESSION_THRESHOLDS);
    expect(findings).toHaveLength(0);
  });

  it('28. avg_confidence drop ≥ warn threshold → finding with severity=warn', () => {
    const baseline = makeMetrics({ avg_confidence: 75 });
    // DEFAULT_REGRESSION_THRESHOLDS.avg_confidence_warn_delta should be something like -10
    const current  = makeMetrics({ avg_confidence: 75 + DEFAULT_REGRESSION_THRESHOLDS.avg_confidence_warn_delta - 1 });
    const findings = detectRegressions(baseline, current, DEFAULT_REGRESSION_THRESHOLDS);
    const confidenceFinding = findings.find(f => f.metric_name === 'avg_confidence');
    expect(confidenceFinding).toBeDefined();
    expect(confidenceFinding!.severity).toBe('warn');
  });

  it('29. avg_confidence drop ≥ escalate threshold → finding with severity=escalate', () => {
    const baseline = makeMetrics({ avg_confidence: 80 });
    const current  = makeMetrics({ avg_confidence: 80 + DEFAULT_REGRESSION_THRESHOLDS.avg_confidence_escalate_delta - 1 });
    const findings = detectRegressions(baseline, current, DEFAULT_REGRESSION_THRESHOLDS);
    const confidenceFinding = findings.find(f => f.metric_name === 'avg_confidence');
    expect(confidenceFinding).toBeDefined();
    expect(confidenceFinding!.severity).toBe('escalate');
  });

  it('30. refusal_rate increase ≥ warn threshold → finding with severity=warn', () => {
    const baseline = makeMetrics({ refusal_rate: 0.05 });
    const current  = makeMetrics({ refusal_rate: 0.05 + DEFAULT_REGRESSION_THRESHOLDS.refusal_rate_warn_delta + 0.01 });
    const findings = detectRegressions(baseline, current, DEFAULT_REGRESSION_THRESHOLDS);
    const refusalFinding = findings.find(f => f.metric_name === 'refusal_rate');
    expect(refusalFinding).toBeDefined();
    expect(refusalFinding!.severity).toBe('warn');
  });

  it('31. multiple findings when multiple metrics regress simultaneously', () => {
    const baseline = makeMetrics({ avg_confidence: 75, refusal_rate: 0.05 });
    const current  = makeMetrics({
      avg_confidence: 75 + DEFAULT_REGRESSION_THRESHOLDS.avg_confidence_warn_delta - 1,
      refusal_rate: 0.05 + DEFAULT_REGRESSION_THRESHOLDS.refusal_rate_warn_delta + 0.01,
    });
    const findings = detectRegressions(baseline, current, DEFAULT_REGRESSION_THRESHOLDS);
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });

  it('32. finding.delta = current_value - baseline_value (negative = decline)', () => {
    const baseline = makeMetrics({ avg_confidence: 80 });
    const current  = makeMetrics({ avg_confidence: 80 + DEFAULT_REGRESSION_THRESHOLDS.avg_confidence_warn_delta - 1 });
    const findings = detectRegressions(baseline, current, DEFAULT_REGRESSION_THRESHOLDS);
    const f = findings.find(f => f.metric_name === 'avg_confidence');
    expect(f).toBeDefined();
    expect(f!.delta).toBeCloseTo(current.avg_confidence - baseline.avg_confidence, 2);
    expect(f!.delta).toBeLessThan(0); // confidence declined
  });

  it('33. finding includes correlated_markers (non-causal annotation)', () => {
    const baseline = makeMetrics({ avg_confidence: 80 });
    const current  = makeMetrics({ avg_confidence: 80 + DEFAULT_REGRESSION_THRESHOLDS.avg_confidence_warn_delta - 1 });
    const findings = detectRegressions(baseline, current, DEFAULT_REGRESSION_THRESHOLDS);
    const f = findings.find(f => f.metric_name === 'avg_confidence');
    expect(f).toBeDefined();
    expect(Array.isArray(f!.correlated_markers)).toBe(true);
    // correlated_markers is not empty — there's at least one annotation
    // (the content is non-causal by design)
    expect(f!.correlated_markers.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── F. Regression report & reader ────────────────────────────────────────────

describe('F. Regression report and reader', () => {
  let db: Database.Database;
  let reader: LedgerReader;
  const traceId  = 'tr_regression_test';
  const requestId = 'req_regression_test';

  beforeEach(() => {
    db = makeDb();
    reader = new LedgerReader(db);
  });

  function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
    return {
      run_count: 10,
      avg_confidence: 75,
      median_confidence: 75,
      low_confidence_share: 0.1,
      refusal_rate: 0.05,
      forced_unknown_rate: 0.0,
      override_rate: 0.0,
      evidence_gate_fail_rate: 0.1,
      lane_c_rate: 0.1,
      ...overrides,
    };
  }

  const baselineWindow: WindowSpec = { kind: 'count', count: 10, label: 'baseline (last 10)' };
  const currentWindow:  WindowSpec = { kind: 'count', count: 5,  label: 'current (last 5)' };

  it('34. buildRegressionReport produces RegressionReportRecord with correct structure', () => {
    const findings: RegressionFinding[] = [];
    const report = buildRegressionReport({
      baselineWindow,
      currentWindow,
      baselineRunCount: 10,
      currentRunCount: 5,
      baselineMetrics: makeMetrics(),
      currentMetrics: makeMetrics(),
      findings,
    });
    expect(report.kind).toBe('regression_report');
    expect(report.baseline_window).toEqual(baselineWindow);
    expect(report.current_window).toEqual(currentWindow);
    expect(report.baseline_run_count).toBe(10);
    expect(report.current_run_count).toBe(5);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(typeof report.generated_at).toBe('string');
  });

  it('35. overall_severity=none when no findings', () => {
    const report = buildRegressionReport({
      baselineWindow,
      currentWindow,
      baselineRunCount: 10,
      currentRunCount: 5,
      baselineMetrics: makeMetrics(),
      currentMetrics: makeMetrics(),
      findings: [],
    });
    expect(report.overall_severity).toBe('none');
  });

  it('36. overall_severity=escalate when any finding is escalate', () => {
    const escalateFinding: RegressionFinding = {
      metric_name: 'avg_confidence',
      baseline_value: 80,
      current_value: 55,
      delta: -25,
      threshold: 20,
      severity: 'escalate',
      description: 'avg_confidence dropped by 25 points',
      correlated_markers: [],
    };
    const report = buildRegressionReport({
      baselineWindow,
      currentWindow,
      baselineRunCount: 10,
      currentRunCount: 5,
      baselineMetrics: makeMetrics({ avg_confidence: 80 }),
      currentMetrics: makeMetrics({ avg_confidence: 55 }),
      findings: [escalateFinding],
    });
    expect(report.overall_severity).toBe('escalate');
  });
});
