/**
 * Pipeline Idempotency — Execution Key Generation
 *
 * A StageExecutionKey is a 64-char lowercase hex SHA-256 that uniquely
 * identifies a specific stage execution in a specific context.
 *
 * Key components:
 *   orchestratorVersion — semver of the orchestrator (changes on logic updates)
 *   stageId             — which stage (INTENT_DETECT, ECO_BUILD, …)
 *   contractVersion     — I/O contract version for this stage
 *   normalizedInput     — deterministic, non-semantic-stripped input object
 *   upstreamKeys        — execution keys of all upstream stages (sorted for stability)
 *
 * If any component changes, the key changes → no replay → fresh execution.
 */

import { createHash } from 'crypto';
import { normalizeStageInput } from './normalize.js';

// ─── hashNormalizedInput ──────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hex hash of the normalized form of an input object.
 */
export function hashNormalizedInput(normalizedInput: unknown): string {
  const json = JSON.stringify(normalizedInput);
  return createHash('sha256').update(json).digest('hex');
}

// ─── computeStageExecutionKey ─────────────────────────────────────────────────

export interface StageExecutionKeyParams {
  orchestratorVersion: string;
  stageId: string;
  contractVersion: string;
  normalizedInput: unknown;
  upstreamKeys: string[];
}

/**
 * Compute the canonical execution key for a stage invocation.
 *
 * The key is deterministic: identical params → identical key, always.
 * Upstream keys are sorted before hashing to prevent insertion-order variance.
 *
 * @returns 64-char lowercase hex SHA-256
 */
export function computeStageExecutionKey(params: StageExecutionKeyParams): string {
  const content = JSON.stringify({
    orchestratorVersion: params.orchestratorVersion,
    stageId:             params.stageId,
    contractVersion:     params.contractVersion,
    inputHash:           hashNormalizedInput(params.normalizedInput),
    upstreamKeys:        [...params.upstreamKeys].sort(),
  });
  return createHash('sha256').update(content).digest('hex');
}
