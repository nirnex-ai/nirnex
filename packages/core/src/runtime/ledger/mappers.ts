/**
 * Runtime Ledger — Mappers
 *
 * Converts subsystem data structures into canonical LedgerEntry records.
 *
 * Design constraints:
 *   - Each mapper is a pure function — no I/O, no side effects
 *   - Mappers supply event timestamps; writer preserves them as-is
 *   - All output passes validateLedgerEntry
 *   - fromTraceJson is LEGACY ONLY (Sprint 6 adapter)
 *
 * Stage → decision_code mapping:
 *   INTENT_DETECT    → 'INTENT_DETECTED'     (stage: 'knowledge')
 *   ECO_BUILD        → 'ECO_COMPUTED'        (stage: 'eco')
 *   SUFFICIENCY_GATE → 'SUFFICIENCY_EVALUATED' (stage: 'classification')
 *   TEE_BUILD        → 'TEE_BUILT'           (stage: 'strategy')
 *   CLASSIFY_LANE    → 'LANE_CLASSIFIED'     (stage: 'classification')
 */

import { randomUUID } from 'crypto';
import { LEDGER_SCHEMA_VERSION } from './types.js';
import type {
  LedgerEntry,
  LedgerStage,
  DecisionRecord,
  RefusalRecord,
  OutcomeRecord,
  TraceAdapterRecord,
  StageReplayRecord,
  StageRejectionRecord,
} from './types.js';
import type { ConfidenceSnapshotRecord } from '../confidence/types.js';
import type {
  ReplayMaterialRecord,
  ReplayAttemptedRecord,
  ReplayVerifiedRecord,
  ReplayFailedRecord,
} from '../replay/types.js';
import type { BoundTrace } from '../../pipeline/types.js';
import type { ConflictLedgerEvent } from '../../knowledge/conflict/types.js';
import type { DimensionScoringTrace } from '../../knowledge/ledger/traceDimensionScoring.js';
import type { OrchestratorResult } from '../../pipeline/orchestrator.js';

// ─── Stage metadata table ─────────────────────────────────────────────────────

const STAGE_META: Record<BoundTrace['stage'], { decisionCode: string; ledgerStage: LedgerStage }> = {
  INTENT_DETECT:    { decisionCode: 'INTENT_DETECTED',        ledgerStage: 'knowledge' },
  ECO_BUILD:        { decisionCode: 'ECO_COMPUTED',           ledgerStage: 'eco' },
  SUFFICIENCY_GATE: { decisionCode: 'SUFFICIENCY_EVALUATED',  ledgerStage: 'classification' },
  TEE_BUILD:        { decisionCode: 'TEE_BUILT',              ledgerStage: 'strategy' },
  CLASSIFY_LANE:    { decisionCode: 'LANE_CLASSIFIED',        ledgerStage: 'classification' },
};

// ─── Status mapping ───────────────────────────────────────────────────────────

function boundStatusToDecisionStatus(
  status: BoundTrace['status'],
): DecisionRecord['result']['status'] {
  switch (status) {
    case 'ok':        return 'pass';
    case 'blocked':   return 'block';
    case 'escalated': return 'escalate';
    case 'degraded':  return 'warn';
    default:          return 'warn';
  }
}

// ─── Envelope builder ─────────────────────────────────────────────────────────

function buildEnvelope(opts: {
  trace_id: string;
  request_id: string;
  timestamp: string;
  stage: LedgerStage;
  record_type: LedgerEntry['record_type'];
  actor: LedgerEntry['actor'];
  payload: LedgerEntry['payload'];
  tee_id?: string;
  parent_ledger_id?: string;
}): LedgerEntry {
  return {
    schema_version:   LEDGER_SCHEMA_VERSION,
    ledger_id:        randomUUID(),
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    tee_id:           opts.tee_id,
    parent_ledger_id: opts.parent_ledger_id,
    timestamp:        opts.timestamp,
    stage:            opts.stage,
    record_type:      opts.record_type,
    actor:            opts.actor,
    payload:          opts.payload,
  };
}

// ─── fromBoundTrace ───────────────────────────────────────────────────────────

/**
 * Convert a pipeline BoundTrace into a DecisionRecord ledger entry.
 *
 * @param boundTrace - the BoundTrace produced by stage-executor after a stage runs
 * @param opts       - correlation IDs and optional parent linkage
 */
export function fromBoundTrace(
  boundTrace: BoundTrace,
  opts: {
    trace_id: string;
    request_id: string;
    stage: LedgerStage;
    tee_id?: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  const meta = STAGE_META[boundTrace.stage] ?? { decisionCode: 'STAGE_EXECUTED', ledgerStage: opts.stage };

  const payload: DecisionRecord = {
    kind:          'decision',
    decision_name: meta.decisionCode.toLowerCase().replace(/_/g, ' '),
    decision_code: meta.decisionCode,
    input_refs:    { trace_ids: [boundTrace.inputHash] },
    result: {
      status: boundStatusToDecisionStatus(boundTrace.status),
    },
    rationale: {
      summary:   boundTrace.errorMessage
        ? `Stage ${boundTrace.stage} failed: ${boundTrace.errorMessage}`
        : `Stage ${boundTrace.stage} completed with status: ${boundTrace.status}`,
      rule_refs: [`stage:${boundTrace.stage}`],
      signal_refs: [`durationMs:${boundTrace.durationMs}`, `inputHash:${boundTrace.inputHash}`],
    },
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        boundTrace.timestamp,
    stage:            meta.ledgerStage,
    record_type:      'decision',
    actor:            'system',
    payload,
    tee_id:           opts.tee_id,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromDimensionScoringTrace ────────────────────────────────────────────────

/**
 * Convert a DimensionScoringTrace (Sprint 11) into a knowledge-stage DecisionRecord.
 */
export function fromDimensionScoringTrace(
  dimTrace: DimensionScoringTrace,
  opts: {
    trace_id: string;
    request_id: string;
    tee_id?: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  const composite = dimTrace.composite_internal_confidence;

  const payload: DecisionRecord = {
    kind:          'decision',
    decision_name: 'eco scored',
    decision_code: 'ECO_SCORED',
    input_refs:    { trace_ids: [dimTrace.calculation_version] },
    result: {
      status: composite >= 80 ? 'pass' : composite >= 60 ? 'warn' : composite >= 40 ? 'escalate' : 'block',
    },
    rationale: {
      summary:     `ECO dimension scoring complete. Composite confidence: ${composite}/100 (v${dimTrace.calculation_version}).`,
      rule_refs:   ['sprint11:scoreDimensions', `version:${dimTrace.calculation_version}`],
      signal_refs: [
        `composite_confidence:${composite}`,
        `coverage:${dimTrace.coverage.status}`,
        `freshness:${dimTrace.freshness.status}`,
        `mapping:${dimTrace.mapping.status}`,
        `conflict:${dimTrace.conflict.status}`,
        `graph:${dimTrace.graph.status}`,
      ],
    },
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        dimTrace.timestamp,
    stage:            'eco',
    record_type:      'decision',
    actor:            'system',
    payload,
    tee_id:           opts.tee_id,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromConflictEvents ───────────────────────────────────────────────────────

/**
 * Collapse multiple ConflictLedgerEvents into a single DecisionRecord.
 *
 * Design rationale: one record per conflict evaluation session (not per event).
 * Event count and stable refs are preserved in rationale.signal_refs for
 * audit trail without record explosion.
 */
export function fromConflictEvents(
  events: ConflictLedgerEvent[],
  opts: {
    trace_id: string;
    request_id: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  const eventCount = events.length;
  const timestamp  = events[0]?.timestamp ?? new Date().toISOString();

  // Collect unique conflict IDs from payloads
  const conflictIds = events
    .map(e => e.payload?.conflictId as string | undefined)
    .filter((id): id is string => !!id);

  const payload: DecisionRecord = {
    kind:          'decision',
    decision_name: 'conflict evaluated',
    decision_code: 'CONFLICT_EVALUATED',
    input_refs:    { evidence_ids: conflictIds.length > 0 ? conflictIds : undefined },
    result:        { status: 'pass' },
    rationale: {
      summary:     eventCount === 0
        ? 'No conflict events detected.'
        : `${eventCount} conflict ledger event(s) processed.`,
      rule_refs:   ['sprint8:detectConflicts'],
      signal_refs: [
        `eventCount:${eventCount}`,
        ...events.map(e => `event:${e.kind}`),
      ],
    },
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp,
    stage:            'eco',
    record_type:      'decision',
    actor:            'system',
    payload,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromRefusal ──────────────────────────────────────────────────────────────

/**
 * Create a RefusalRecord ledger entry from a gate block/refuse decision.
 */
export function fromRefusal(
  stage: LedgerStage,
  refusalCode: string,
  refusalReason: string,
  opts: {
    trace_id: string;
    request_id: string;
    blocking_dimension?: RefusalRecord['blocking_dimension'];
    parent_ledger_id?: string;
  },
): LedgerEntry {
  const payload: RefusalRecord = {
    kind:               'refusal',
    refusal_code:       refusalCode,
    refusal_reason:     refusalReason,
    blocking_dimension: opts.blocking_dimension,
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        new Date().toISOString(),
    stage,
    record_type:      'refusal',
    actor:            'system',
    payload,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromOrchestratorResult ───────────────────────────────────────────────────

/**
 * Convert a completed OrchestratorResult into a terminal OutcomeRecord.
 *
 * completion_state derivation:
 *   blocked  → 'refused'
 *   escalated (not blocked) → 'escalated'
 *   completed → 'merged'
 *   degraded only → 'merged' (pipeline completed, degraded is a soft flag)
 */
export function fromOrchestratorResult(
  result: OrchestratorResult,
  opts: {
    trace_id: string;
    request_id: string;
    tee_id?: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  let completion_state: OutcomeRecord['completion_state'];
  let disposition_reason: string;

  if (result.blocked) {
    completion_state   = 'refused';
    disposition_reason = result.blockedAt
      ? `Pipeline blocked at stage: ${result.blockedAt}`
      : 'Pipeline blocked — insufficient evidence or hard gate condition';
  } else if (result.escalated) {
    completion_state   = 'escalated';
    disposition_reason = 'Pipeline completed with escalation — soft failure on at least one stage';
  } else if (result.completed) {
    completion_state   = 'merged';
    disposition_reason = result.finalLane
      ? `Pipeline completed successfully — lane ${result.finalLane}`
      : 'Pipeline completed successfully';
  } else {
    completion_state   = 'abandoned';
    disposition_reason = 'Pipeline did not complete — unknown state';
  }

  const finalLane = result.finalLane as OutcomeRecord['final_lane'] | undefined;

  const payload: OutcomeRecord = {
    kind:                   'outcome',
    completion_state,
    final_lane:             finalLane,
    final_disposition_reason: disposition_reason,
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        new Date().toISOString(),
    stage:            'outcome',
    record_type:      'outcome',
    actor:            'system',
    payload,
    tee_id:           opts.tee_id,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromEvidenceGateDecision ─────────────────────────────────────────────────

/**
 * Convert an EvidenceGateDecision into a classification-stage DecisionRecord.
 *
 * Emits a richer ledger entry than fromBoundTrace — includes per-rule results,
 * provenance dimensions, and the full reason code list for audit/replay.
 *
 * Call this alongside (or instead of) fromBoundTrace when the SUFFICIENCY_GATE
 * stage uses the evidence gate evaluator.
 */
export function fromEvidenceGateDecision(
  decision: {
    verdict: string;
    reasonCodes: string[];
    summary: string;
    perRuleResults: Array<{ ruleCode: string; passed: boolean; verdictContribution: string | null; detail: string }>;
    provenance: { dimensionsRead: Record<string, string>; intentClass: string; forcedUnknownApplied: boolean };
  },
  opts: {
    trace_id: string;
    request_id: string;
    tee_id?: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  const ledgerStatus: DecisionRecord['result']['status'] =
    decision.verdict === 'pass'    ? 'pass'   :
    decision.verdict === 'clarify' ? 'warn'   :   // clarify = soft stop → 'warn' in ledger status
    decision.verdict === 'refuse'  ? 'refuse' :
    'warn';

  const failedRuleCodes = decision.perRuleResults
    .filter(r => !r.passed)
    .map(r => r.ruleCode);

  const payload: DecisionRecord = {
    kind:          'decision',
    decision_name: 'evidence sufficiency evaluated',
    decision_code: 'EVIDENCE_GATE_EVALUATED',
    input_refs: {
      policy_ids: [`intent:${decision.provenance.intentClass}`],
      evidence_ids: failedRuleCodes.length > 0 ? failedRuleCodes : undefined,
    },
    result: {
      status: ledgerStatus,
      selected_value: decision.verdict,
    },
    rationale: {
      summary:     decision.summary,
      rule_refs:   decision.reasonCodes,
      signal_refs: [
        `intent:${decision.provenance.intentClass}`,
        `forcedUnknown:${decision.provenance.forcedUnknownApplied}`,
        ...Object.entries(decision.provenance.dimensionsRead).map(
          ([dim, sev]) => `${dim}:${sev}`,
        ),
      ],
    },
    severity:
      decision.verdict === 'refuse'  ? 'critical' :
      decision.verdict === 'clarify' ? 'high'     :
      'low',
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        new Date().toISOString(),
    stage:            'classification',
    record_type:      'decision',
    actor:            'system',
    payload,
    tee_id:           opts.tee_id,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromMappingQualityScored ─────────────────────────────────────────────────

/**
 * Create a knowledge-stage DecisionRecord for a completed mapping quality scoring run.
 *
 * Captures the full MappingQualityResult including score, level, hard_block, and
 * sub-metric breakdown as signal_refs for calibration/replay.
 *
 * @param mqResult  - the MappingQualityResult from scoreMappingQuality()
 * @param opts      - correlation IDs and optional intent class
 */
export function fromMappingQualityScored(
  mqResult: {
    score: number;
    level: string;
    hard_block: boolean;
    breakdown: {
      scope_alignment: number;
      structural_coherence: number;
      evidence_concentration: number;
      intent_alignment: number;
    };
    reasons: string[];
  },
  opts: {
    trace_id: string;
    request_id: string;
    intent?: string;
    tee_id?: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  const ledgerStatus: DecisionRecord['result']['status'] =
    mqResult.level === 'pass'     ? 'pass'    :
    mqResult.level === 'warn'     ? 'warn'    :
    mqResult.level === 'escalate' ? 'escalate':
    mqResult.level === 'block'    ? 'block'   :
    'warn';

  const payload: DecisionRecord = {
    kind:          'decision',
    decision_name: 'mapping quality scored',
    decision_code: 'MAPPING_QUALITY_SCORED',
    input_refs: {
      policy_ids: opts.intent ? [`intent:${opts.intent}`] : undefined,
    },
    result: {
      status:         ledgerStatus,
      selected_value: `${mqResult.score}/100 (${mqResult.level})`,
    },
    rationale: {
      summary:     mqResult.reasons[0]
        ?? `Mapping quality ${mqResult.level} (${mqResult.score}/100).`,
      rule_refs:   ['sprint14:scoreMappingQuality'],
      signal_refs: [
        `score:${mqResult.score}`,
        `level:${mqResult.level}`,
        `hard_block:${mqResult.hard_block}`,
        `scope_alignment:${mqResult.breakdown.scope_alignment}`,
        `structural_coherence:${mqResult.breakdown.structural_coherence}`,
        `evidence_concentration:${mqResult.breakdown.evidence_concentration}`,
        `intent_alignment:${mqResult.breakdown.intent_alignment}`,
      ],
    },
    ...(mqResult.hard_block ? { severity: 'critical' as const } : {}),
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        new Date().toISOString(),
    stage:            'eco',
    record_type:      'decision',
    actor:            'system',
    payload,
    tee_id:           opts.tee_id,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromStageReplay ──────────────────────────────────────────────────────────

/**
 * Create a stage_replay ledger entry for a stage that was replayed from the
 * idempotency store instead of re-executing.
 */
export function fromStageReplay(
  params: {
    stageId: string;
    replayOfExecutionKey: string;
    originalTraceId: string;
    resultHash?: string;
  },
  opts: {
    trace_id: string;
    request_id: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  const payload: StageReplayRecord = {
    kind:                    'stage_replay',
    stage_id:                params.stageId,
    replay_of_execution_key: params.replayOfExecutionKey,
    original_trace_id:       params.originalTraceId,
    result_hash:             params.resultHash,
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        new Date().toISOString(),
    stage:            'execution',
    record_type:      'stage_replay',
    actor:            'system',
    payload,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromStageRejection ───────────────────────────────────────────────────────

/**
 * Create a stage_rejection ledger entry for a stage that was rejected because
 * another orchestrator instance already claimed the execution key (in_progress).
 */
export function fromStageRejection(
  params: {
    stageId: string;
    executionKey: string;
    rejectionReason: string;
  },
  opts: {
    trace_id: string;
    request_id: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  const payload: StageRejectionRecord = {
    kind:             'stage_rejection',
    stage_id:         params.stageId,
    execution_key:    params.executionKey,
    rejection_reason: params.rejectionReason,
  };

  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        new Date().toISOString(),
    stage:            'execution',
    record_type:      'stage_rejection',
    actor:            'system',
    payload,
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromConfidenceSnapshot ───────────────────────────────────────────────────

/**
 * Create a confidence_snapshot ledger entry from a ConfidenceSnapshotRecord.
 */
export function fromConfidenceSnapshot(
  snapshot: ConfidenceSnapshotRecord,
  opts: {
    trace_id: string;
    request_id: string;
    parent_ledger_id?: string;
  },
): LedgerEntry {
  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        new Date().toISOString(),
    stage:            'confidence',
    record_type:      'confidence_snapshot',
    actor:            'system',
    payload:          snapshot as unknown as LedgerEntry['payload'],
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromReplayMaterial ───────────────────────────────────────────────────────

/**
 * Create a replay_material ledger entry from a captured ReplayMaterialRecord.
 * Written by the orchestrator after each stage completes (when enableReplayCapture=true).
 */
export function fromReplayMaterial(
  material: ReplayMaterialRecord,
  opts: { trace_id: string; request_id: string; parent_ledger_id?: string },
): LedgerEntry {
  return buildEnvelope({
    trace_id:         opts.trace_id,
    request_id:       opts.request_id,
    timestamp:        new Date().toISOString(),
    stage:            'replay',
    record_type:      'replay_material',
    actor:            'system',
    payload:          material as unknown as LedgerEntry['payload'],
    parent_ledger_id: opts.parent_ledger_id,
  });
}

// ─── fromTraceJson — LEGACY IMPORT ONLY ──────────────────────────────────────

/**
 * Adapt a pre-existing Sprint 6 trace JSON blob into a ledger entry.
 *
 * LEGACY IMPORT ONLY. This function must NOT be used for new governance records.
 * It exists solely to normalize historical trace data into the ledger schema.
 * New code must use the typed record family mappers above.
 */
export function fromTraceJson(
  traceJson: unknown,
  opts: {
    request_id?: string;
    tee_id?: string;
  },
): LedgerEntry {
  const blob = traceJson as Record<string, unknown> | null | undefined;

  // Extract trace_id from legacy blob if available
  const trace_id: string =
    (blob && typeof blob.trace_id === 'string' && blob.trace_id)
      ? blob.trace_id
      : `tr_legacy_${randomUUID().slice(0, 8)}`;

  const request_id: string = opts.request_id ?? trace_id;

  const payload: TraceAdapterRecord = {
    kind: 'trace',
    raw:  traceJson,
  };

  return buildEnvelope({
    trace_id,
    request_id,
    timestamp:   (blob && typeof blob.timestamp === 'string') ? blob.timestamp : new Date().toISOString(),
    stage:       'post_tool_trace',
    record_type: 'trace',
    actor:       'system',
    payload,
    tee_id:      opts.tee_id,
  });
}
