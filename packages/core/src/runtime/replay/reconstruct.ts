/**
 * Replay Engine — Reconstruction
 *
 * Reconstructs a pipeline run from recorded replay materials in the ledger.
 * No live handlers are invoked — reconstruction is entirely ledger-backed.
 *
 * Flow:
 *   1. Load replay_material entries for the run from the ledger
 *   2. Write replay_attempted entry (audit trail)
 *   3. For each stage in canonical order: verify recorded_output_hash === recomputed hash
 *   4. Write replay_verified or replay_failed entry
 *   5. Return ReplayReport
 *
 * Design constraints:
 *   - reconstructRun takes only (traceId, db) — never takes live handler functions
 *   - "reconstruction" = return recorded normalized_output, verify its hash
 *   - A tampered normalized_output will produce a different recomputed hash → detected
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import { LedgerReader } from '../ledger/reader.js';
import { appendLedgerEntry } from '../ledger/writer.js';
import { LEDGER_SCHEMA_VERSION } from '../ledger/types.js';
import { hashRecordedOutput } from './capture.js';
import { checkRunReplayability } from './policy.js';
import type {
  ReplayMaterialRecord,
  ReplayAttemptedRecord,
  ReplayVerifiedRecord,
  ReplayFailedRecord,
  StageReplayResult,
  ReplayReport,
} from './types.js';
import { STAGES } from '../../pipeline/types.js';

// ─── reconstructRun ───────────────────────────────────────────────────────────

/**
 * Reconstruct a pipeline run from its recorded replay materials.
 *
 * This function NEVER calls live handlers. It reads only from the ledger DB.
 * The parameter signature (traceId, db) — with no handler argument — enforces
 * this constraint at the API level.
 *
 * @param traceId - trace_id of the original run to reconstruct
 * @param db      - SQLite database containing the run's ledger entries
 * @returns       - ReplayReport with mode='replay' and per-stage results
 */
export function reconstructRun(traceId: string, db: Database.Database): ReplayReport {
  const reader = new LedgerReader(db);

  // ── 1. Load recorded materials ─────────────────────────────────────────────
  const materialEntries = reader.fetchReplayMaterials(traceId);
  const materials = materialEntries.map(e => e.payload as ReplayMaterialRecord);

  // ── 2. Compute replayability and collect stage_results ────────────────────
  const replayTraceId   = `tr_replay_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const replayRequestId = `req_replay_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const materialByStage = new Map<string, ReplayMaterialRecord>(
    materials.map(m => [m.stage_id, m]),
  );

  const stageResults: StageReplayResult[] = [];
  let firstDivergence: string | undefined;
  const missingStages: string[] = [];

  for (const stage of STAGES) {
    const material = materialByStage.get(stage);
    if (!material) {
      missingStages.push(stage);
      stageResults.push({
        stage_id: stage,
        replayability_status: 'non_replayable',
        recorded_output_hash: '',
        reconstructed_output_hash: '',
        verified: false,
        failure_reason: 'no replay material recorded for this stage',
      });
      if (!firstDivergence) firstDivergence = stage;
      continue;
    }

    // Reconstruct: recompute hash of the stored normalized_output
    const reconstructedHash = hashRecordedOutput(material.normalized_output);
    const verified = reconstructedHash === material.output_hash;

    if (!verified && !firstDivergence) {
      firstDivergence = stage;
    }

    stageResults.push({
      stage_id: stage,
      replayability_status: material.replayability_status,
      recorded_output_hash: material.output_hash,
      reconstructed_output_hash: reconstructedHash,
      verified,
      failure_reason: verified
        ? undefined
        : `output hash mismatch: recorded=${material.output_hash}, reconstructed=${reconstructedHash}`,
    });
  }

  const policyResult = checkRunReplayability(materials, [...STAGES]);
  const allVerified  = stageResults.length > 0 && stageResults.every(r => r.verified);

  // ── 3. Write replay_attempted ──────────────────────────────────────────────
  // Audit entries are written under the ORIGINAL traceId so the run's full
  // timeline (buildTimeline(traceId)) includes replay audit records.
  const attemptedPayload: ReplayAttemptedRecord = {
    kind:             'replay_attempted',
    run_trace_id:     traceId,
    execution_mode:   'replay',
    stages_requested: [...STAGES],
  };
  appendLedgerEntry(db, {
    schema_version: LEDGER_SCHEMA_VERSION,
    ledger_id:      randomUUID(),
    trace_id:       traceId,       // original trace — enriches the run's timeline
    request_id:     replayRequestId,
    timestamp:      new Date().toISOString(),
    stage:          'replay',
    record_type:    'replay_attempted',
    actor:          'system',
    payload:        attemptedPayload as unknown as import('../ledger/types.js').LedgerPayload,
  });

  // ── 4. Write replay_verified or replay_failed ──────────────────────────────
  const overallReplayable = policyResult.status === 'replayable';

  if (allVerified && overallReplayable) {
    const verifiedPayload: ReplayVerifiedRecord = {
      kind:            'replay_verified',
      run_trace_id:    traceId,
      stages_verified: stageResults.map(r => r.stage_id),
      verified_count:  stageResults.length,
    };
    appendLedgerEntry(db, {
      schema_version: LEDGER_SCHEMA_VERSION,
      ledger_id:      randomUUID(),
      trace_id:       traceId,
      request_id:     replayRequestId,
      timestamp:      new Date().toISOString(),
      stage:          'replay',
      record_type:    'replay_verified',
      actor:          'system',
      payload:        verifiedPayload as unknown as import('../ledger/types.js').LedgerPayload,
    });
  } else {
    const failedStage = stageResults.find(r => !r.verified);
    const failedPayload: ReplayFailedRecord = {
      kind:             'replay_failed',
      run_trace_id:     traceId,
      failure_reason:   failedStage?.failure_reason
        ?? (missingStages.length > 0
          ? `missing replay materials for stages: ${missingStages.join(', ')}`
          : 'reconstruction failed'),
      divergence_stage: firstDivergence,
      expected_hash:    failedStage?.recorded_output_hash,
      actual_hash:      failedStage?.reconstructed_output_hash,
    };
    appendLedgerEntry(db, {
      schema_version: LEDGER_SCHEMA_VERSION,
      ledger_id:      randomUUID(),
      trace_id:       traceId,
      request_id:     replayRequestId,
      timestamp:      new Date().toISOString(),
      stage:          'replay',
      record_type:    'replay_failed',
      actor:          'system',
      payload:        failedPayload as unknown as import('../ledger/types.js').LedgerPayload,
    });
  }

  // ── 5. Return ReplayReport ─────────────────────────────────────────────────
  const report: ReplayReport = {
    run_trace_id:     traceId,
    mode:             'replay',
    // overall_replayable=true ONLY when all expected stages have replayable materials.
    // conditionally_replayable (some stages missing) → false.
    overall_replayable: overallReplayable,
    verified:         allVerified,
    stage_results:    stageResults,
    divergence_point: firstDivergence,
    missing_stages:   missingStages.length > 0 ? missingStages : undefined,
  };

  return report;
}
