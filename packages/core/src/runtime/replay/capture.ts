/**
 * Replay Engine — Capture
 *
 * Functions for capturing stage inputs/outputs as replay materials and
 * normalizing values for deterministic hashing.
 *
 * Design constraints:
 *   - normalizeForRecord preserves ALL fields (no stripping) — this is for
 *     hash commitment, not key comparison. Stripping fields would break replay.
 *   - hashRecordedOutput uses computePayloadHash (canonicalizePayload → SHA-256)
 *   - buildReplayMaterial is pure — no I/O, no side effects
 */

import { canonicalizePayload } from '../ledger/immutability/canonicalize.js';
import { computePayloadHash } from '../ledger/immutability/hash.js';
import type { BoundTrace } from '../../pipeline/types.js';
import type { ReplayMaterialRecord, ReplayabilityStatus } from './types.js';

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize a value for recording in the replay ledger.
 *
 * Returns a deterministic canonical JSON string regardless of key insertion
 * order. This is the form stored as normalized_input / normalized_output.
 *
 * Does NOT strip any fields — all data is preserved for hash commitment.
 * This is intentionally different from normalizeStageInput() which strips
 * non-semantic fields for idempotency key comparison.
 */
export function normalizeForRecord(value: unknown): string {
  return canonicalizePayload(value);
}

/**
 * Compute a SHA-256 hash of a recorded output value.
 *
 * Used for:
 *   - output_hash in ReplayMaterialRecord (recorded during original run)
 *   - reconstructed_output_hash in StageReplayResult (recomputed during replay)
 *
 * Equality of these two hashes proves reconstruction integrity.
 */
export function hashRecordedOutput(output: unknown): string {
  return computePayloadHash(output);
}

// ─── Replayability classification ─────────────────────────────────────────────

/**
 * Classify a stage's replayability from the presence of recorded artifacts.
 *
 *   replayable               — input AND output recorded
 *   conditionally_replayable — output recorded, input missing
 *   non_replayable           — output not recorded (reconstruction impossible)
 */
export function classifyStageReplayability(
  hasInput: boolean,
  hasOutput: boolean,
): ReplayabilityStatus {
  if (hasOutput && hasInput)  return 'replayable';
  if (hasOutput && !hasInput) return 'conditionally_replayable';
  return 'non_replayable';
}

// ─── Replay material builder ──────────────────────────────────────────────────

/**
 * Build a ReplayMaterialRecord from a BoundTrace.
 *
 * Called by the orchestrator after each stage completes (when enableReplayCapture=true).
 * The resulting record is written to the ledger via fromReplayMaterial().
 *
 * @param trace                    - BoundTrace produced by stage-executor
 * @param dependencySequenceIndex  - 0 for the stage handler; >0 for subsequent calls
 */
export function buildReplayMaterial(
  trace: BoundTrace,
  dependencySequenceIndex: number = 0,
): ReplayMaterialRecord {
  const hasInput  = trace.input  !== undefined && trace.input  !== null;
  const hasOutput = trace.output !== undefined && trace.output !== null;

  const normalizedInput  = JSON.parse(normalizeForRecord(trace.input));
  const normalizedOutput = JSON.parse(normalizeForRecord(trace.output));

  return {
    kind: 'replay_material',
    stage_id: trace.stage,
    execution_mode: 'live',
    input_hash:  hasInput  ? hashRecordedOutput(normalizedInput)  : '',
    output_hash: hasOutput ? hashRecordedOutput(normalizedOutput) : '',
    normalized_input:  normalizedInput,
    normalized_output: normalizedOutput,
    replayability_status: classifyStageReplayability(hasInput, hasOutput),
    dependency_sequence_index: dependencySequenceIndex,
    trace_ref: trace.inputHash,
  };
}
