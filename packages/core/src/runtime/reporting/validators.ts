/**
 * Runtime Reporting — Bundle Validator
 *
 * Validates RunEvidenceBundle completeness and internal consistency.
 * If validation fails, the bundle gets a visible integrity section — never silently lying.
 *
 * Design constraints:
 *   - Validation is non-destructive — it only reads and annotates
 *   - Missing expected stages are listed explicitly
 *   - Every causal reference must resolve to a known event_id
 *   - Unclassified failures are flagged, not suppressed
 *   - Confidence totals are checked for rough consistency (not exact math)
 */

import {
  RunEvidenceBundle,
  ReportValidationIssue,
  ReportIntegrityResult,
  FailureRecord,
} from './types.js';

import { FAILURE_TAXONOMY } from './failure-taxonomy.js';

// ─── Expected stages ──────────────────────────────────────────────────────────

const EXPECTED_STAGES = ['knowledge', 'eco', 'classification', 'strategy', 'implementation'] as const;

// ─── validateBundle ───────────────────────────────────────────────────────────

/**
 * Validates a RunEvidenceBundle for completeness and internal consistency.
 * Collects all issues — does not short-circuit on first failure.
 * Returns a ReportIntegrityResult with valid=true only when no 'error' severity issues exist.
 *
 * Hook-only runs: a bundle that has a `run_outcome_summary` event but no pipeline
 * stage records is a valid hook-only run (written by the validate hook, not the
 * orchestrator). For such runs, `missing_outcome` and `missing_stage` checks are
 * skipped — the `run_outcome_summary` record IS the terminal outcome.
 */
export function validateBundle(bundle: RunEvidenceBundle): ReportIntegrityResult {
  const issues: ReportValidationIssue[] = [];
  const missing_stages: string[] = [];
  const broken_causal_refs: string[] = [];
  const unclassified_failure_codes: string[] = [];

  // Detect hook-only runs: have a run_outcome_summary but no pipeline stages.
  // These are written by the validate hook (not the orchestrator) and must not
  // be validated against orchestrator-pipeline expectations.
  //
  // NOTE: the assembler synthesises a single "outcome" stage from run_outcome_summary,
  // so bundle.stages may have length 1 even for hook-only runs. Exclude that synthetic
  // stage from the pipeline-stage count — only knowledge/eco/classification/strategy/
  // implementation constitute "real" pipeline stages.
  const PIPELINE_STAGE_IDS = new Set(['knowledge', 'eco', 'classification', 'strategy', 'implementation']);
  const hasRunOutcomeSummary = bundle.raw_events.some((e) => e.kind === 'run_outcome_summary');
  const hasPipelineStages    = bundle.stages.some((s) => PIPELINE_STAGE_IDS.has(s.stage_id));
  const isHookOnlyRun        = hasRunOutcomeSummary && !hasPipelineStages;

  // ── 1. Missing outcome ────────────────────────────────────────────────────

  // Hook-only runs satisfy the outcome requirement via run_outcome_summary.
  if (!isHookOnlyRun) {
    const hasOutcome = bundle.raw_events.some((e) => e.kind === 'outcome');
    if (!hasOutcome) {
      issues.push({
        kind: 'missing_outcome',
        severity: 'error',
        message: 'No terminal outcome record found in run events',
      });
    }
  }

  // ── 2. Missing expected stages ────────────────────────────────────────────

  // Hook-only runs do not have pipeline stages by design — suppress these warnings.
  if (!isHookOnlyRun) {
    const presentStageIds = new Set(bundle.stages.map((s) => s.stage_id));
    for (const stage of EXPECTED_STAGES) {
      if (!presentStageIds.has(stage)) {
        issues.push({
          kind: 'missing_stage',
          severity: 'warning',
          message: `Expected stage not present: ${stage}`,
          affected_id: stage,
        });
        missing_stages.push(stage);
      }
    }
  }

  // ── 3. Broken causal references ───────────────────────────────────────────

  const knownEventIds = new Set(bundle.raw_events.map((e) => e.event_id));

  // Check failure cause_event_ids
  for (const failure of bundle.failures) {
    for (const id of failure.cause_event_ids) {
      if (!knownEventIds.has(id) && !broken_causal_refs.includes(id)) {
        issues.push({
          kind: 'broken_causal_ref',
          severity: 'error',
          message: `Causal reference ${id} does not resolve to a known event`,
          affected_id: id,
        });
        broken_causal_refs.push(id);
      }
    }
  }

  // Check raw_events causes arrays
  for (const event of bundle.raw_events) {
    for (const id of event.causes) {
      if (!knownEventIds.has(id) && !broken_causal_refs.includes(id)) {
        issues.push({
          kind: 'broken_causal_ref',
          severity: 'error',
          message: `Causal reference ${id} does not resolve to a known event`,
          affected_id: id,
        });
        broken_causal_refs.push(id);
      }
    }
  }

  // Check causal graph edge node references
  const knownNodeIds = new Set(bundle.causal_graph.nodes.map((n) => n.node_id));
  for (const edge of bundle.causal_graph.edges) {
    if (!knownNodeIds.has(edge.from_node_id) && !broken_causal_refs.includes(edge.from_node_id)) {
      issues.push({
        kind: 'broken_causal_ref',
        severity: 'error',
        message: `Causal reference ${edge.from_node_id} does not resolve to a known event`,
        affected_id: edge.from_node_id,
      });
      broken_causal_refs.push(edge.from_node_id);
    }
    if (!knownNodeIds.has(edge.to_node_id) && !broken_causal_refs.includes(edge.to_node_id)) {
      issues.push({
        kind: 'broken_causal_ref',
        severity: 'error',
        message: `Causal reference ${edge.to_node_id} does not resolve to a known event`,
        affected_id: edge.to_node_id,
      });
      broken_causal_refs.push(edge.to_node_id);
    }
  }

  // ── 4. Unclassified failures ──────────────────────────────────────────────

  for (const failure of bundle.failures) {
    if (failure.code === 'UNCLASSIFIED_FAILURE') {
      issues.push({
        kind: 'unclassified_failure',
        severity: 'warning',
        message: `Failure ${failure.failure_id} uses UNCLASSIFIED_FAILURE code`,
        affected_id: failure.failure_id,
      });
      unclassified_failure_codes.push(failure.failure_id);
    }
  }

  // ── 5. Data snapshot incomplete ───────────────────────────────────────────

  if (bundle.stages.length === 0 && bundle.raw_events.length === 0) {
    issues.push({
      kind: 'data_snapshot_incomplete',
      severity: 'error',
      message: 'Bundle has no stages and no events — snapshot is incomplete',
    });
  }

  // ── 6. Confidence consistency ─────────────────────────────────────────────

  if (bundle.confidence.checkpoints.length > 0) {
    // Check snapshot_index monotonicity in checkpoints array
    const indices = bundle.confidence.checkpoints.map((c) => c.snapshot_index);
    let monotonic = true;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] <= indices[i - 1]) {
        monotonic = false;
        break;
      }
    }
    if (!monotonic) {
      issues.push({
        kind: 'confidence_inconsistent',
        severity: 'warning',
        message: 'Confidence snapshots are not in monotonically increasing order',
      });
    }

    // Cross-check: checkpoint stage_names should follow known pipeline order.
    // If a later checkpoint (higher index) names a stage that comes earlier in
    // the pipeline than the previous checkpoint's stage, the sequence is inverted.
    const PIPELINE_STAGE_ORDER: Record<string, number> = {
      knowledge: 0, eco: 1, classification: 2, strategy: 3,
    };
    for (let i = 1; i < bundle.confidence.checkpoints.length; i++) {
      const prev = bundle.confidence.checkpoints[i - 1];
      const curr = bundle.confidence.checkpoints[i];
      const prevPos = PIPELINE_STAGE_ORDER[prev.stage_name] ?? -1;
      const currPos = PIPELINE_STAGE_ORDER[curr.stage_name] ?? -1;
      if (prevPos !== -1 && currPos !== -1 && currPos < prevPos) {
        issues.push({
          kind: 'confidence_inconsistent',
          severity: 'warning',
          message: `Confidence checkpoint stage ordering is inconsistent: ${prev.stage_name} (index ${prev.snapshot_index}) appears before ${curr.stage_name} (index ${curr.snapshot_index}) but ${curr.stage_name} precedes ${prev.stage_name} in the pipeline`,
        });
        break;
      }
    }
  }

  // ── 7. Timestamp ordering ─────────────────────────────────────────────────

  const stagesWithTimestamps = bundle.stages.filter((s) => s.started_at != null);
  for (let i = 1; i < stagesWithTimestamps.length; i++) {
    const prev = stagesWithTimestamps[i - 1];
    const curr = stagesWithTimestamps[i];
    // Both started_at are defined here due to the filter above
    if (curr.started_at! < prev.started_at!) {
      issues.push({
        kind: 'timestamp_out_of_order',
        severity: 'warning',
        message: 'Stage timestamps appear out of order',
      });
      // Flag once per bundle — don't emit one per offending pair
      break;
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────

  const valid = !issues.some((i) => i.severity === 'error');

  return {
    valid,
    issues,
    missing_stages,
    broken_causal_refs,
    unclassified_failure_codes,
  };
}

// ─── computeIntegrityStatus ───────────────────────────────────────────────────

/**
 * Reduces a ReportIntegrityResult to a single status label.
 *
 *   'failed'   — at least one 'error' severity issue
 *   'degraded' — at least one 'warning' severity issue (and no errors)
 *   'valid'    — no issues at all
 */
export function computeIntegrityStatus(
  integrity: ReportIntegrityResult,
): 'valid' | 'degraded' | 'failed' {
  if (integrity.issues.some((i) => i.severity === 'error')) return 'failed';
  if (integrity.issues.some((i) => i.severity === 'warning')) return 'degraded';
  return 'valid';
}
