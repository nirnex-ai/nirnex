/**
 * StageExecutor — Validated stage execution with trace binding
 *
 * Enforces the contract: validate input → call handler → validate output → bind trace.
 * Applies failure policy when input or output validation fails.
 *
 * Design constraints:
 *   - Handler is NOT called when input validation fails (enforces boundary)
 *   - Output validation failure triggers the stage's failure policy
 *   - Every execution (success or failure) produces a BoundTrace
 *   - Handler errors are caught and mapped to the stage's failure policy
 */

import type { StageId, StageResult, ValidationResult } from "./types.js";
import { FAILURE_POLICY, applyFailureMode } from "./failure-policy.js";
import { bindTrace } from "./trace-binder.js";
import { hashInputs } from "./trace-binder.js";

export class StageExecutor {
  /**
   * Execute a single stage with full validation and trace binding.
   *
   * @param stage           - the stage being executed
   * @param handler         - async function that performs the stage's work
   * @param input           - the raw input to validate before calling handler
   * @param inputValidator  - validator for the input shape
   * @param outputValidator - validator for the output shape
   */
  async execute<TIn, TOut>(
    stage: StageId,
    handler: (input: TIn) => Promise<TOut>,
    input: unknown,
    inputValidator: (v: unknown) => ValidationResult,
    outputValidator: (v: unknown) => ValidationResult,
  ): Promise<StageResult<TOut>> {
    const startAt = Date.now();

    // ── Input validation ───────────────────────────────────────────────────
    const inputResult = inputValidator(input);
    if (!inputResult.valid) {
      const error = new Error(`Input validation failed for ${stage}: ${inputResult.reason}`);
      const mode = FAILURE_POLICY[stage];
      const result = applyFailureMode(mode, stage, error);
      return result as StageResult<TOut>;
    }

    // ── Execute handler ────────────────────────────────────────────────────
    let output: TOut;
    try {
      output = await handler(input as TIn);
    } catch (caught: unknown) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      const mode = FAILURE_POLICY[stage];
      const result = applyFailureMode(mode, stage, error);
      return result as StageResult<TOut>;
    }

    // ── Output validation ──────────────────────────────────────────────────
    const outputResult = outputValidator(output);
    if (!outputResult.valid) {
      const error = new Error(`Output validation failed for ${stage}: ${outputResult.reason}`);
      const mode = FAILURE_POLICY[stage];
      const result = applyFailureMode(mode, stage, error);
      return result as StageResult<TOut>;
    }

    // ── Success — bind trace ───────────────────────────────────────────────
    const trace = bindTrace(stage, input, output, "ok", undefined, startAt);

    return {
      stage,
      status: "ok",
      output,
      trace,
    };
  }
}
