/**
 * Steering Engine — Context Builder
 *
 * Constructs the SteeringContext provided to the steering evaluator at each checkpoint.
 * The context is a snapshot of the current run state — pure, no I/O.
 */

import type { SteeringContext, CheckpointType, StepSpec, StepHistoryEntry } from './types.js';

// ─── BuildContextOptions ──────────────────────────────────────────────────────

export interface BuildContextOptions {
  checkpoint: CheckpointType;
  stage: string;
  run_trace_id: string;
  current_confidence?: number;
  current_lane?: string;
  stage_result?: unknown;
  step_spec?: StepSpec;
  run_history?: StepHistoryEntry[];
  steering_count?: number;
}

// ─── buildSteeringContext ─────────────────────────────────────────────────────

/**
 * Build a SteeringContext from the current execution state.
 * Called by the orchestrator at each steering checkpoint.
 *
 * @param opts - current execution snapshot
 * @returns    - SteeringContext ready to pass to the steering evaluator
 */
export function buildSteeringContext(opts: BuildContextOptions): SteeringContext {
  return {
    checkpoint:          opts.checkpoint,
    stage:               opts.stage,
    run_trace_id:        opts.run_trace_id,
    current_confidence:  opts.current_confidence,
    current_lane:        opts.current_lane,
    stage_result:        opts.stage_result,
    step_spec:           opts.step_spec ?? { stage_id: opts.stage, type: 'stage' },
    run_history:         opts.run_history ?? [],
    steering_count:      opts.steering_count ?? 0,
  };
}
