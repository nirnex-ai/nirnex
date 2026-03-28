/**
 * Runtime Reporting — Public API
 *
 * Non-blocking, performance-optimised report system for Nirnex.
 * Consumes ledger events after run completion and produces:
 *   1. RunEvidenceBundle (canonical JSON)
 *   2. Static HTML report
 *
 * Architecture:
 *   execution writes events → ledger → assembleReport → renderHtml
 *
 * Usage:
 *   const entries = reader.buildTimeline(traceId);
 *   const bundle  = assembleReport(entries, { input_ref: specPath });
 *   bundle.optimisation_hints = generateOptimisationHints(bundle);
 *   const html    = renderHtml(bundle);
 *   fs.writeFileSync(outputPath, html, 'utf-8');
 *
 * Comparison:
 *   const comparison = compareRuns(bundleA, bundleB);
 *   bundleB.comparison = comparison;
 *   const html = renderHtml(bundleB);
 */

// ─── Core types ───────────────────────────────────────────────────────────────

export type {
  FailureSeverity,
  FailureClass,
  CausalRelationship,
  ReportEvent,
  StageRecord,
  FailureRecord,
  CausalNode,
  CausalEdge,
  CausalChain,
  CausalGraph,
  ConfidenceCheckpoint,
  ConfidencePenalty,
  ConfidenceReportSnapshot,
  EvidenceItem,
  KnowledgeHealthSnapshot,
  OptimisationHint,
  Delta,
  RunComparison,
  ReportValidationIssue,
  ReportIntegrityResult,
  RunSummary,
  RunEvidenceBundle,
} from './types.js';

export { REPORT_SCHEMA_VERSION } from './types.js';

// ─── Failure taxonomy ─────────────────────────────────────────────────────────

export type { TaxonomyEntry } from './failure-taxonomy.js';
export {
  FAILURE_TAXONOMY,
  lookupFailureCode,
  getAllFailureCodes,
} from './failure-taxonomy.js';

// ─── Causality ────────────────────────────────────────────────────────────────

export {
  buildCausalGraph,
  findPrimaryChains,
  buildCausalChain,
  extractCausalContext,
} from './causality.js';

// ─── Assembler ────────────────────────────────────────────────────────────────

export type { AssemblerOptions } from './assembler.js';
export { assembleReport } from './assembler.js';

// ─── Validators ───────────────────────────────────────────────────────────────

export { validateBundle, computeIntegrityStatus } from './validators.js';

// ─── Optimisation rules ───────────────────────────────────────────────────────

export { generateOptimisationHints } from './optimization-rules.js';

// ─── HTML renderer ────────────────────────────────────────────────────────────

export { renderHtml } from './renderer/html.js';

// ─── Run comparison ───────────────────────────────────────────────────────────

import type { RunEvidenceBundle, RunComparison, Delta } from './types.js';

/**
 * Compares two RunEvidenceBundles and produces a RunComparison.
 *
 * bundleA is treated as the baseline.
 * bundleB is treated as the current run.
 *
 * Deltas are computed for: duration, confidence, failure count, lane, override count.
 * Direction is determined by whether change is an improvement or degradation.
 */
export function compareRuns(bundleA: RunEvidenceBundle, bundleB: RunEvidenceBundle): RunComparison {
  const deltas: RunComparison['deltas'] = {};

  // Duration: lower is improved
  if (bundleA.summary.duration_ms != null && bundleB.summary.duration_ms != null) {
    const baseline = bundleA.summary.duration_ms;
    const current  = bundleB.summary.duration_ms;
    deltas.duration_ms = {
      baseline,
      current,
      direction: current < baseline ? 'improved' : current > baseline ? 'degraded' : 'unchanged',
    };
  }

  // Confidence: higher is improved
  const baseConf = bundleA.confidence.overall_confidence;
  const currConf = bundleB.confidence.overall_confidence;
  if (baseConf !== currConf || (baseConf === 0 && currConf === 0)) {
    deltas.confidence = {
      baseline: baseConf,
      current:  currConf,
      direction: currConf > baseConf ? 'improved' : currConf < baseConf ? 'degraded' : 'unchanged',
    };
  }

  // Failure count: lower is improved
  const baseFailures = bundleA.failures.length;
  const currFailures = bundleB.failures.length;
  deltas.failure_count = {
    baseline:  baseFailures,
    current:   currFailures,
    direction: currFailures < baseFailures ? 'improved' : currFailures > baseFailures ? 'degraded' : 'unchanged',
  };

  // Lane: changed if different
  const baseLane = bundleA.summary.lane;
  const currLane = bundleB.summary.lane;
  if (baseLane != null || currLane != null) {
    deltas.lane = {
      baseline:  baseLane ?? '—',
      current:   currLane ?? '—',
      direction: baseLane === currLane ? 'unchanged' : 'changed',
    };
  }

  // Override count: lower is improved
  const baseOverrides = bundleA.raw_events.filter(e => e.kind === 'override').length;
  const currOverrides = bundleB.raw_events.filter(e => e.kind === 'override').length;
  if (baseOverrides > 0 || currOverrides > 0) {
    deltas.override_count = {
      baseline:  baseOverrides,
      current:   currOverrides,
      direction: currOverrides < baseOverrides ? 'improved' : currOverrides > baseOverrides ? 'degraded' : 'unchanged',
    };
  }

  // Regression findings: collect degraded delta descriptions
  const regression_findings: string[] = [];
  for (const [metric, delta] of Object.entries(deltas)) {
    if (delta && delta.direction === 'degraded') {
      regression_findings.push(
        `${metric} degraded from ${String(delta.baseline)} to ${String(delta.current)}`
      );
    }
  }

  return {
    baseline_run_id: bundleA.run_id,
    current_run_id:  bundleB.run_id,
    generated_at:    new Date().toISOString(),
    deltas,
    regression_findings,
  };
}
