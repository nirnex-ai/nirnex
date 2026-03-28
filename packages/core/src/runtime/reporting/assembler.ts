/**
 * Runtime Reporting — Report Assembler
 *
 * Read-only assembler: loads LedgerEntry records and produces a RunEvidenceBundle.
 * Never writes to the ledger. Never blocks execution.
 *
 * Design constraints:
 *   - Input: LedgerEntry[] already loaded by caller (no I/O in assembler)
 *   - Assembler is a pure function: same inputs → same output
 *   - Stage timeline reconstructed from decision record sequence
 *   - Failure records derived from refusal, deviation, and blocked decision records
 *   - Confidence snapshot from the latest confidence_snapshot ledger entry
 *   - Knowledge health extracted from eco stage decision payload
 *   - Causal graph built from parent_ledger_id chains
 *   - Validation always runs; integrity issues are surfaced in the bundle
 */

import { randomUUID } from 'crypto';

import { LedgerEntry } from '../ledger/types.js';
import {
  RunEvidenceBundle,
  ReportEvent,
  StageRecord,
  FailureRecord,
  FailureSeverity,
  ConfidenceReportSnapshot,
  ConfidenceCheckpoint,
  ConfidencePenalty,
  KnowledgeHealthSnapshot,
  EvidenceItem,
  CausalGraph,
  RunSummary,
  REPORT_SCHEMA_VERSION,
} from './types.js';
import { lookupFailureCode } from './failure-taxonomy.js';
import { buildCausalGraph, findPrimaryChains } from './causality.js';
import { validateBundle, computeIntegrityStatus } from './validators.js';

// ─── AssemblerOptions ─────────────────────────────────────────────────────────

export interface AssemblerOptions {
  run_id?: string;    // override trace_id detection
  input_ref?: string; // human reference for the run input
}

// ─── Stage display map ────────────────────────────────────────────────────────

const STAGE_DISPLAY: Record<string, { id: string; display: string }> = {
  knowledge:      { id: 'knowledge',       display: 'Intent Detection' },
  eco:            { id: 'eco',             display: 'ECO Build' },
  classification: { id: 'classification',  display: 'Sufficiency Gate & Lane Classification' },
  strategy:       { id: 'strategy',        display: 'TEE Build' },
  outcome:        { id: 'outcome',         display: 'Outcome' },
};

const PIPELINE_STAGES = ['knowledge', 'eco', 'classification', 'strategy'] as const;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractCode(entry: LedgerEntry): string | undefined {
  const payload = entry.payload as any;
  if (payload.kind === 'decision') return payload.decision_code as string | undefined;
  if (payload.kind === 'refusal')  return payload.refusal_code  as string | undefined;
  return undefined;
}

function extractSeverity(entry: LedgerEntry): FailureSeverity | undefined {
  const payload = entry.payload as any;
  if (payload.kind === 'decision') {
    const status = payload.result?.status;
    if (status === 'block')  return 'error';
    if (status === 'warn')   return 'warning';
  }
  if (payload.kind === 'refusal') return 'error';
  if (payload.kind === 'deviation') {
    if (payload.severity === 'high')   return 'error';
    if (payload.severity === 'medium') return 'warning';
  }
  return undefined;
}

function extractBlocking(entry: LedgerEntry): boolean | undefined {
  const payload = entry.payload as any;
  if (payload.kind === 'decision' && payload.result?.status === 'block') return true;
  if (payload.kind === 'refusal') return true;
  return undefined;
}

function buildCauses(entry: LedgerEntry): string[] {
  const causes: string[] = [];
  if (entry.parent_ledger_id) causes.push(entry.parent_ledger_id);
  const derived = (entry.payload as any).derived_from_entry_ids;
  if (Array.isArray(derived)) {
    for (const id of derived) {
      if (typeof id === 'string') causes.push(id);
    }
  }
  // Deduplicate while preserving order
  return [...new Set(causes)];
}

function isoToMs(iso: string): number {
  try {
    return new Date(iso).getTime();
  } catch {
    return 0;
  }
}

function diffMs(startIso: string, endIso: string): number {
  try {
    const start = new Date(startIso).getTime();
    const end   = new Date(endIso).getTime();
    if (isNaN(start) || isNaN(end)) return 0;
    return Math.max(0, end - start);
  } catch {
    return 0;
  }
}

function mapDecisionStatusToStageStatus(
  status: string,
): StageRecord['status'] {
  switch (status) {
    case 'pass':      return 'ok';
    case 'warn':      return 'ok';
    case 'block':     return 'blocked';
    case 'refuse':    return 'blocked';
    case 'escalate':  return 'escalated';
    default:          return 'ok';
  }
}

function mapCompletionStateToFinalStatus(
  state: string | undefined,
): RunSummary['final_status'] {
  switch (state) {
    case 'merged':    return 'success';
    case 'refused':   return 'refused';
    case 'abandoned': return 'abandoned';
    case 'escalated': return 'escalated';
    default:          return 'incomplete';
  }
}

// ─── assembleReport ───────────────────────────────────────────────────────────

/**
 * Pure assembler: converts an array of LedgerEntries into a RunEvidenceBundle.
 * Runs validation and attaches the integrity result to the bundle.
 * optimisation_hints is left empty — populate it separately via generateOptimisationHints.
 */
export function assembleReport(
  entries: LedgerEntry[],
  options?: AssemblerOptions,
): RunEvidenceBundle {

  // ── Step 1: Normalize entries to ReportEvents ──────────────────────────────

  const rawEvents: ReportEvent[] = entries.map((entry): ReportEvent => ({
    event_id:  entry.ledger_id,
    run_id:    entry.trace_id,
    stage:     entry.stage,
    timestamp: entry.timestamp,
    kind:      entry.record_type,
    code:      extractCode(entry),
    severity:  extractSeverity(entry),
    blocking:  extractBlocking(entry),
    payload:   entry.payload as Record<string, unknown>,
    causes:    buildCauses(entry),
  }));

  // ── Step 2: Detect run_id / request_id ────────────────────────────────────

  const run_id     = options?.run_id ?? entries[0]?.trace_id ?? 'unknown';
  const request_id = entries[0]?.request_id ?? 'unknown';

  // ── Step 3: Build stage timeline ──────────────────────────────────────────

  // Index events by stage for fast lookup
  const eventsByStage = new Map<string, ReportEvent[]>();
  for (const event of rawEvents) {
    const bucket = eventsByStage.get(event.stage) ?? [];
    bucket.push(event);
    eventsByStage.set(event.stage, bucket);
  }

  const stages: StageRecord[] = [];

  for (const stageKey of PIPELINE_STAGES) {
    const stageEvents = (eventsByStage.get(stageKey) ?? []).filter(
      (e) => e.kind === 'decision',
    );
    if (stageEvents.length === 0) continue;

    const displayInfo = STAGE_DISPLAY[stageKey];
    const firstEvent  = stageEvents[0];
    const lastEvent   = stageEvents[stageEvents.length - 1];

    // Determine status from the most severe decision result
    let stageStatus: StageRecord['status'] = 'ok';
    for (const event of stageEvents) {
      const status = (event.payload as any).result?.status as string | undefined;
      if (!status) continue;
      const mapped = mapDecisionStatusToStageStatus(status);
      // Priority: blocked > escalated > ok
      if (mapped === 'blocked') { stageStatus = 'blocked'; break; }
      if (mapped === 'escalated' && stageStatus !== 'blocked') stageStatus = 'escalated';
    }

    const stageFailures: FailureRecord[] = [];
    const stageWarnings: FailureRecord[] = [];

    const stageRecord: StageRecord = {
      stage_id:      displayInfo.id,
      display_name:  displayInfo.display,
      status:        stageStatus,
      started_at:    firstEvent.timestamp,
      ended_at:      lastEvent.timestamp,
      duration_ms:   diffMs(firstEvent.timestamp, lastEvent.timestamp),
      failure_count: 0,
      warning_count: 0,
      failures:      stageFailures,
      warnings:      stageWarnings,
    };

    stages.push(stageRecord);
  }

  // Outcome synthetic stage
  const outcomeEvent = rawEvents.find((e) => e.kind === 'outcome');
  if (outcomeEvent) {
    const completionState = (outcomeEvent.payload as any).completion_state as string | undefined;
    let outcomeStatus: StageRecord['status'] = 'ok';
    if (completionState === 'merged')    outcomeStatus = 'ok';
    else if (completionState === 'refused')   outcomeStatus = 'blocked';
    else if (completionState === 'abandoned') outcomeStatus = 'blocked';
    else if (completionState === 'escalated') outcomeStatus = 'escalated';

    stages.push({
      stage_id:      'outcome',
      display_name:  STAGE_DISPLAY['outcome'].display,
      status:        outcomeStatus,
      started_at:    outcomeEvent.timestamp,
      ended_at:      outcomeEvent.timestamp,
      duration_ms:   0,
      failure_count: 0,
      warning_count: 0,
      failures:      [],
      warnings:      [],
    });
  }

  // ── Step 4: Build failure records ─────────────────────────────────────────

  const failures: FailureRecord[] = [];

  // Refusal events
  for (const event of rawEvents.filter((e) => e.kind === 'refusal')) {
    const code = event.code ?? 'POLICY_EVIDENCE_BLOCK';
    const taxonomy = lookupFailureCode(code);
    failures.push({
      failure_id:       `fail_${event.event_id.slice(0, 8)}`,
      code,
      class:            taxonomy.class,
      label:            taxonomy.label,
      severity:         'error',
      blocking:         true,
      recoverability:   taxonomy.recoverability,
      determinism:      taxonomy.determinism,
      stage:            event.stage,
      message:          (event.payload as any).refusal_reason ?? 'Execution refused',
      cause_event_ids:  event.causes,
      source_event_id:  event.event_id,
    });
  }

  // Blocked / refused decision events
  for (const event of rawEvents.filter((e) => e.kind === 'decision')) {
    const status = (event.payload as any).result?.status as string | undefined;
    if (status !== 'block' && status !== 'refuse') continue;
    const code = event.code ?? 'POLICY_CONFIDENCE_BLOCK';
    const taxonomy = lookupFailureCode(code);
    failures.push({
      failure_id:       `fail_${event.event_id.slice(0, 8)}`,
      code,
      class:            taxonomy.class,
      label:            taxonomy.label,
      severity:         'error',
      blocking:         true,
      recoverability:   taxonomy.recoverability,
      determinism:      taxonomy.determinism,
      stage:            event.stage,
      message:          (event.payload as any).rationale?.summary ?? 'Decision blocked execution',
      cause_event_ids:  event.causes,
      source_event_id:  event.event_id,
    });
  }

  // Deviation events
  for (const event of rawEvents.filter((e) => e.kind === 'deviation')) {
    const code     = 'DATA_TRACE_LEDGER_MISMATCH';
    const taxonomy = lookupFailureCode(code);
    const devPayload = event.payload as any;
    const severity: FailureSeverity =
      devPayload.severity === 'high'   ? 'error'   :
      devPayload.severity === 'medium' ? 'warning' : 'info';
    failures.push({
      failure_id:       `fail_${event.event_id.slice(0, 8)}`,
      code,
      class:            taxonomy.class,
      label:            taxonomy.label,
      severity,
      blocking:         false,
      recoverability:   taxonomy.recoverability,
      determinism:      taxonomy.determinism,
      stage:            event.stage,
      message:          devPayload.observed_summary ?? 'Deviation detected',
      cause_event_ids:  event.causes,
      source_event_id:  event.event_id,
    });
  }

  // Back-fill failure/warning counts on stage records
  for (const stage of stages) {
    const stageFails = failures.filter((f) => f.stage === stage.stage_id && f.severity === 'error');
    const stageWarns = failures.filter((f) => f.stage === stage.stage_id && f.severity === 'warning');
    stage.failures       = stageFails;
    stage.warnings       = stageWarns;
    stage.failure_count  = stageFails.length;
    stage.warning_count  = stageWarns.length;
  }

  // ── Step 5: Build confidence snapshot ─────────────────────────────────────

  const snapshotEvents = rawEvents
    .filter((e) => e.kind === 'confidence_snapshot')
    .map((e) => e.payload as any)
    .filter((p) => typeof p.snapshot_index === 'number')
    .sort((a, b) => a.snapshot_index - b.snapshot_index);

  const latestSnapshot = snapshotEvents[snapshotEvents.length - 1];

  const checkpoints: ConfidenceCheckpoint[] = snapshotEvents.map((s) => ({
    trigger:              s.trigger_type ?? 'unknown',
    snapshot_index:       s.snapshot_index,
    computed_confidence:  s.computed_confidence ?? 0,
    effective_confidence: s.effective_confidence ?? 0,
    band:                 s.confidence_band ?? 'unknown',
    stage_name:           s.stage_name ?? '',
    delta:                s.delta_composite ?? undefined,
    delta_reasons:        s.delta_reasons,
  }));

  // Derive penalties from negative deltas between consecutive snapshots
  const penalties: ConfidencePenalty[] = [];
  for (let i = 1; i < snapshotEvents.length; i++) {
    const prev = snapshotEvents[i - 1];
    const curr = snapshotEvents[i];
    const delta = (curr.computed_confidence ?? 0) - (prev.computed_confidence ?? 0);
    if (delta < 0) {
      penalties.push({
        dimension:           curr.stage_name ?? `snapshot_${curr.snapshot_index}`,
        previous_confidence: prev.computed_confidence ?? undefined,
        delta,
        reason:              (curr.delta_reasons ?? []).join('; ') || 'Confidence decreased',
      });
    }
  }

  const confidence: ConfidenceReportSnapshot = {
    overall_confidence:   latestSnapshot?.computed_confidence  ?? 0,
    effective_confidence: latestSnapshot?.effective_confidence ?? 0,
    band:                 latestSnapshot?.confidence_band      ?? 'unknown',
    lane:                 latestSnapshot?.effective_lane,
    dimensions:           latestSnapshot?.dimensions           ?? {},
    penalties,
    checkpoints,
  };

  // ── Step 6: Build knowledge health snapshot ───────────────────────────────

  const ecoDecision = rawEvents.find(
    (e) => e.stage === 'eco' && e.kind === 'decision',
  );

  let knowledge_health: KnowledgeHealthSnapshot = {
    absent_evidence:     [],
    conflicting_evidence: [],
    stale_evidence:      [],
    weak_evidence:       [],
    dimension_scores:    {},
    dimension_statuses:  {},
  };

  if (ecoDecision) {
    const ecoPayload = ecoDecision.payload as any;
    const dimensions = ecoPayload.dimensions ?? ecoPayload.eco_dimensions ?? {};

    const absent_evidence:      EvidenceItem[] = [];
    const conflicting_evidence: EvidenceItem[] = [];
    const stale_evidence:       EvidenceItem[] = [];
    const weak_evidence:        EvidenceItem[] = [];
    const dimension_scores:     Record<string, number>  = {};
    const dimension_statuses:   Record<string, string>  = {};

    for (const [dimKey, dimValue] of Object.entries(dimensions)) {
      const dim = dimValue as any;
      if (typeof dim?.score === 'number') dimension_scores[dimKey]  = dim.score;
      if (typeof dim?.status === 'string') dimension_statuses[dimKey] = dim.status;

      const reasonCodes: string[] = Array.isArray(dim?.reason_codes) ? dim.reason_codes : [];
      const status: string        = dim?.status ?? '';

      const item: EvidenceItem = {
        id:           `${dimKey}_${ecoDecision.event_id.slice(0, 8)}`,
        description:  dim?.description ?? `ECO dimension: ${dimKey}`,
        dimension:    dimKey,
        reason_codes: reasonCodes,
      };

      if (dimKey === 'freshness' && reasonCodes.some((r) => r.includes('stale'))) {
        stale_evidence.push(item);
      } else if (
        dimKey === 'conflict' &&
        (status === 'escalate' || status === 'block')
      ) {
        conflicting_evidence.push(item);
      } else if (dimKey === 'coverage' && status === 'block') {
        absent_evidence.push(item);
      } else if (
        dimKey === 'mapping' &&
        reasonCodes.some((r) => r.includes('weak') || r.includes('low'))
      ) {
        weak_evidence.push(item);
      }
    }

    knowledge_health = {
      absent_evidence,
      conflicting_evidence,
      stale_evidence,
      weak_evidence,
      dimension_scores,
      dimension_statuses,
    };
  }

  // ── Step 7: Build causal graph ────────────────────────────────────────────

  const causal_graph: CausalGraph = buildCausalGraph(rawEvents);

  // ── Step 8: Assemble draft bundle for validation ──────────────────────────

  // Compute temporal bookmarks for summary
  const sortedByTime = [...rawEvents].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
  const firstTimestamp = sortedByTime[0]?.timestamp;
  const lastTimestamp  = sortedByTime[sortedByTime.length - 1]?.timestamp;
  const duration_ms    =
    firstTimestamp && lastTimestamp ? diffMs(firstTimestamp, lastTimestamp) : 0;

  const outcomePayload = outcomeEvent ? (outcomeEvent.payload as any) : undefined;
  const finalLane      = confidence.lane ?? outcomePayload?.final_lane;
  const finalStatus    = mapCompletionStateToFinalStatus(outcomePayload?.completion_state);

  // Build a provisional summary (integrity_status filled after validation)
  const summary: RunSummary = {
    run_id,
    request_id,
    started_at:               firstTimestamp,
    finished_at:              lastTimestamp,
    duration_ms,
    lane:                     finalLane,
    input_ref:                options?.input_ref,
    final_status:             finalStatus,
    stop_condition:           outcomePayload?.final_disposition_reason,
    report_integrity_status:  'valid', // placeholder — updated after validation
  };

  const draftBundle: RunEvidenceBundle = {
    bundle_id:          randomUUID(),
    schema_version:     REPORT_SCHEMA_VERSION,
    run_id,
    request_id,
    generated_at:       new Date().toISOString(),
    summary,
    stages,
    failures,
    causal_graph,
    confidence,
    knowledge_health,
    optimisation_hints: [],
    raw_events:         rawEvents,
    integrity: {
      valid:                     true,
      issues:                    [],
      missing_stages:            [],
      broken_causal_refs:        [],
      unclassified_failure_codes: [],
    },
    comparison: undefined,
  };

  // ── Step 9: Validate and attach integrity result ───────────────────────────

  const integrityResult   = validateBundle(draftBundle);
  const integrityStatus   = computeIntegrityStatus(integrityResult);

  draftBundle.integrity                       = integrityResult;
  draftBundle.summary.report_integrity_status = integrityStatus;

  return draftBundle;
}
