/**
 * Stage Timeout Engine
 *
 * Provides deterministic per-stage timeout enforcement so hung stages
 * cannot block the pipeline indefinitely.
 *
 * Key types:
 *   - StageTimeoutConfig      — per-stage budget + policy
 *   - StageTimeoutEvent       — structured outcome record (always emitted)
 *   - StageExecutionResult<T> — wrapper around handler execution
 *
 * Key function:
 *   - runStageWithTimeout — races handler against a setTimeout deadline;
 *     aborts the handler via AbortController on timeout
 *
 * Timeout detection:
 *   - AbortController is aborted when timeout fires
 *   - In the catch block, controller.signal.aborted === true iff the
 *     timeout triggered (not a handler-side error)
 *
 * Design constraints:
 *   - No pipeline logic here — pure execution + structured event emission
 *   - onTimeout='fail'    → status: 'failed'    (pipeline can BLOCK)
 *   - onTimeout='degrade' → status: 'timed_out' (pipeline can DEGRADE)
 *   - Handler errors (non-timeout) always → status: 'failed'
 */

import type { StageId } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-stage timeout budget and policy. */
export interface StageTimeoutConfig {
  /** The stage this config applies to */
  stageId: StageId;
  /** Timeout budget in milliseconds */
  timeoutMs: number;
  /** Timeout policy: 'fail' blocks pipeline; 'degrade' continues with fallback */
  onTimeout: 'fail' | 'degrade';
  /** true when a timeout on this stage must halt the pipeline */
  isCritical: boolean;
}

/**
 * Structured outcome record emitted for every stage execution.
 * Always present — even on success (where timed_out=false, failure_class=null).
 */
export interface StageTimeoutEvent {
  /** Stage identifier */
  stage_id: string;
  /** ISO 8601 timestamp when execution started */
  started_at: string;
  /** ISO 8601 timestamp when execution ended or timed out */
  ended_at: string;
  /** Wall-clock duration in milliseconds */
  elapsed_ms: number;
  /** Configured timeout budget in milliseconds */
  timeout_ms: number;
  /** true when the stage exceeded its timeout budget */
  timed_out: boolean;
  /** Overall outcome of this execution attempt */
  outcome: 'success' | 'timeout' | 'failed';
  /**
   * true when onTimeout='degrade' and timeout fired — a fallback output was
   * (or will be) applied so the pipeline can continue
   */
  fallback_applied: boolean;
  /**
   * null on success
   * 'timeout' when stage exceeded its budget
   * 'error'   when handler threw independently of any timeout
   */
  failure_class: 'timeout' | 'error' | null;
  /** true when the pipeline can safely continue after this failure */
  recoverable: boolean;
}

/** Wrapper returned by runStageWithTimeout. */
export interface StageExecutionResult<T> {
  /** Execution outcome */
  status: 'success' | 'failed' | 'timed_out';
  /** true when the stage exceeded its timeout budget */
  timedOut: boolean;
  /** Handler output — undefined on failure or timeout */
  output?: T;
  /** Error from handler (non-timeout failures only) */
  error?: Error;
  /** Structured timeout event — always present regardless of outcome */
  timeoutEvent: StageTimeoutEvent;
}

// ─── runStageWithTimeout ──────────────────────────────────────────────────────

/**
 * Execute a stage handler with deterministic timeout enforcement.
 *
 * Mechanism:
 *   - Creates an AbortController and races the handler against a setTimeout
 *   - On timeout: aborts the controller → signal.aborted=true → returns timed_out/failed
 *   - On success: clears the timeout → returns success
 *   - On handler error (before timeout): captures error → returns failed
 *
 * @param stageId - identifies this execution in the StageTimeoutEvent
 * @param fn      - handler to execute; receives AbortSignal for cooperative cancellation
 * @param config  - timeout configuration (budget + policy)
 */
export async function runStageWithTimeout<T>(
  stageId: StageId,
  fn: (signal: AbortSignal) => Promise<T>,
  config: StageTimeoutConfig,
): Promise<StageExecutionResult<T>> {
  const controller = new AbortController();
  const startedAt = new Date();

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let output: T | undefined;
  let error: Error | undefined;

  // Race the handler against a timeout promise.
  // The timeout promise rejects and simultaneously aborts the controller.
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error(`Stage ${stageId} timed out after ${config.timeoutMs}ms`));
    }, config.timeoutMs);
  });

  try {
    output = await Promise.race([fn(controller.signal), timeoutPromise]);
    clearTimeout(timeoutHandle);
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (!controller.signal.aborted) {
      // Handler threw independently — not caused by our timeout/abort
      error = err instanceof Error ? err : new Error(String(err));
    }
    // If signal.aborted === true: timeout fired; no error to capture here
  }

  const endedAt = new Date();
  const elapsedMs = endedAt.getTime() - startedAt.getTime();
  const timedOut = controller.signal.aborted;

  // Map to status: timeout is 'failed' when onTimeout='fail', else 'timed_out'
  let status: 'success' | 'failed' | 'timed_out';
  if (timedOut) {
    status = config.onTimeout === 'fail' ? 'failed' : 'timed_out';
  } else if (error) {
    status = 'failed';
  } else {
    status = 'success';
  }

  const timeoutEvent: StageTimeoutEvent = {
    stage_id:        stageId,
    started_at:      startedAt.toISOString(),
    ended_at:        endedAt.toISOString(),
    elapsed_ms:      elapsedMs,
    timeout_ms:      config.timeoutMs,
    timed_out:       timedOut,
    outcome:         timedOut ? 'timeout' : (error ? 'failed' : 'success'),
    fallback_applied: timedOut && config.onTimeout === 'degrade',
    failure_class:   timedOut ? 'timeout' : (error ? 'error' : null),
    recoverable:     timedOut ? !config.isCritical : false,
  };

  return { status, timedOut, output, error, timeoutEvent };
}
