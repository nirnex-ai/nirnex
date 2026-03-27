/**
 * Pipeline Idempotency — Public API
 *
 * Guarantees that same stage execution request under same deterministic input
 * produces one canonical recorded outcome without re-running side effects.
 */

export { normalizeStageInput } from './normalize.js';
export { computeStageExecutionKey, hashNormalizedInput } from './keys.js';
export { StageExecutionStore } from './store.js';
export { resolveIdempotencyAction } from './policy.js';

export type {
  StageExecutionRecord,
  StageExecutionStatus,
  IdempotencyDecision,
  StageIdempotencyMeta,
} from './types.js';
