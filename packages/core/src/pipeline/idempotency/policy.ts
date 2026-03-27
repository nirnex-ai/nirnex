/**
 * Pipeline Idempotency — Action Resolution Policy
 *
 * Given the current state of the execution store for a key, decides what the
 * orchestrator should do next.
 *
 * Decision rules:
 *   mode='none'        → always execute (idempotency disabled for this stage)
 *   no existing record → execute (first time)
 *   status='completed' → replay (return stored output)
 *   status='failed'    → execute (re-run after failure — not replayed)
 *   status='in_progress' → reject_duplicate_inflight (another caller owns it)
 */

import type { StageIdempotencyMeta, IdempotencyDecision } from './types.js';
import type { StageExecutionStore } from './store.js';

// ─── resolveIdempotencyAction ─────────────────────────────────────────────────

/**
 * Resolve the idempotency action for a stage execution.
 *
 * @param store - execution store (reads only — does not write)
 * @param key   - the pre-computed execution key for this stage invocation
 * @param meta  - per-stage idempotency configuration
 * @returns     - IdempotencyDecision with action and optional stored record
 */
export function resolveIdempotencyAction(
  store: StageExecutionStore,
  key: string,
  meta: StageIdempotencyMeta,
): IdempotencyDecision {
  // Stage opted out of idempotency — always execute fresh
  if (meta.mode === 'none') {
    return { action: 'execute' };
  }

  const record = store.get(key);

  if (!record) {
    // No prior execution for this key
    return { action: 'execute' };
  }

  if (record.status === 'completed') {
    // Prior execution completed successfully — replay stored output
    return { action: 'replay', record };
  }

  if (record.status === 'failed') {
    // Prior execution failed — must not replay a failed result; re-execute
    return { action: 'execute' };
  }

  // status === 'in_progress' — another orchestrator instance claimed this key
  return { action: 'reject_duplicate_inflight', record };
}
