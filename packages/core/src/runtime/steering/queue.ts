/**
 * Steering Engine — Execution Queue
 *
 * Manages the ordered sequence of steps to execute.
 * Supports steering-driven mutations: insert, skip, replace.
 *
 * Design constraints:
 *   - Every mutation is typed and explicit (no implicit state changes)
 *   - insertNext enforces maxInsertions limit (loop protection)
 *   - History records all consumed and skipped steps
 *   - Queue never modifies the original STAGES array
 */

import type { StepSpec, StepHistoryEntry } from './types.js';

// ─── ExecutionQueue ───────────────────────────────────────────────────────────

/**
 * Mutable execution step queue.
 *
 * Initialized from a list of stage IDs. Steering may insert, skip, or replace
 * steps before they execute. The queue enforces a maximum insertion count to
 * prevent infinite steering loops.
 *
 * @param stages       - ordered list of stage IDs to execute
 * @param maxInsertions - maximum number of steps that may be inserted (default: 10)
 */
export class ExecutionQueue {
  private readonly _queue: StepSpec[];
  private readonly _history: StepHistoryEntry[];
  private _insertionCount: number = 0;
  private readonly _maxInsertions: number;

  constructor(stages: readonly string[], maxInsertions: number = 10) {
    this._queue        = stages.map(s => ({ stage_id: s, type: 'stage' as const }));
    this._history      = [];
    this._maxInsertions = maxInsertions;
  }

  // ─── Read operations ────────────────────────────────────────────────────────

  /** Total number of steps inserted so far */
  get insertionCount(): number {
    return this._insertionCount;
  }

  /** View the next step without consuming it. Returns null if exhausted. */
  peek(): StepSpec | null {
    return this._queue[0] ?? null;
  }

  /** Whether no more steps remain to execute. */
  isExhausted(): boolean {
    return this._queue.length === 0;
  }

  /** Copy of remaining steps (not including history). */
  getRemaining(): StepSpec[] {
    return [...this._queue];
  }

  /** Copy of all consumed/skipped step history entries. */
  getHistory(): StepHistoryEntry[] {
    return [...this._history];
  }

  // ─── Consume operations ─────────────────────────────────────────────────────

  /**
   * Consume and return the next step, recording it in history as 'completed'.
   * Returns null if the queue is exhausted.
   */
  next(): StepSpec | null {
    const step = this._queue.shift() ?? null;
    if (step) {
      this._history.push({ stage_id: step.stage_id, status: 'completed' });
    }
    return step;
  }

  // ─── Mutation operations (steering-only) ────────────────────────────────────

  /**
   * Insert a step immediately before the current next step.
   *
   * @param step - the step to insert
   * @returns    - true if insertion succeeded, false if maxInsertions was reached
   *
   * Loop protection: returns false and does NOT insert when maxInsertions is exceeded.
   * This prevents infinite loops from repeated insert_step steering decisions.
   */
  insertNext(step: StepSpec): boolean {
    if (this._insertionCount >= this._maxInsertions) {
      return false;
    }
    this._queue.unshift({ ...step, is_inserted: true });
    this._insertionCount++;
    return true;
  }

  /**
   * Remove the next step without executing it, recording it as 'skipped'.
   * Returns the skipped step spec.
   */
  skipNext(): StepSpec | undefined {
    const step = this._queue.shift();
    if (step) {
      this._history.push({ stage_id: step.stage_id, status: 'skipped', steering_applied: 'skip_step' });
    }
    return step;
  }

  /**
   * Replace the next step with a different spec.
   * Returns the step that was replaced (for ledger recording).
   */
  replaceNext(step: StepSpec): StepSpec | undefined {
    const replaced = this._queue.shift();
    this._queue.unshift(step);
    return replaced;
  }
}
