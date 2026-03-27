/**
 * OrchestratorRunner — Runs the planning pipeline in canonical stage order
 *
 * Enforces deterministic stage ordering via STAGES const.
 * BLOCK failures halt the pipeline immediately.
 * ESCALATE/DEGRADE failures continue with fallback output and set flags.
 *
 * Sprint 15 additions:
 *   - Per-stage timeout enforcement via runStageWithTimeout
 *   - OrchestratorInput.stageTimeoutOverrides — caller-supplied budget overrides
 *   - OrchestratorResult.stageTimeouts  — all StageTimeoutEvents emitted
 *   - OrchestratorResult.degradedStages — stages degraded due to timeout
 *   - OrchestratorResult.executionWarnings — human-readable timeout warnings
 *
 * Design constraints:
 *   - STAGES order is authoritative — no handler may reorder stages
 *   - Each stage receives the output of previous stages as its input context
 *   - OrchestratorResult includes per-stage StageResults and a final lane
 *   - No filesystem I/O — pure orchestration logic
 */

import {
  STAGES,
  type StageId,
  type StageResult,
  type IntentDetectInput,
  type IntentDetectOutput,
  type EcoBuildOutput,
  type SufficiencyGateOutput,
  type TeeBuildOutput,
  type ClassifyLaneOutput,
} from "./types.js";

import {
  validateIntentDetectInput,
  validateIntentDetectOutput,
  validateEcoBuildInput,
  validateEcoBuildOutput,
  validateSufficiencyGateInput,
  validateSufficiencyGateOutput,
  validateTeeBuildInput,
  validateTeeBuildOutput,
  validateClassifyLaneInput,
  validateClassifyLaneOutput,
} from "./validators.js";

import { StageExecutor } from "./stage-executor.js";
import { FAILURE_POLICY, applyFailureMode } from "./failure-policy.js";
import type { LedgerEntry } from "../runtime/ledger/types.js";
import { fromBoundTrace, fromOrchestratorResult, fromRefusal } from "../runtime/ledger/mappers.js";
import { randomUUID } from "crypto";
import { runStageWithTimeout, type StageTimeoutEvent } from "./timeout.js";
import { getStageTimeoutConfig } from "../config/stageTimeouts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  specPath: string | null;
  query?: string;
  targetRoot?: string;
  /**
   * Optional ledger entry callback. Called after each stage completes and once
   * after the final terminal OutcomeRecord is emitted.
   *
   * Backward compatible: if absent, no ledger writes occur and pipeline behavior
   * is unchanged.
   */
  onLedgerEntry?: (entry: LedgerEntry) => void;
  /**
   * Optional per-stage timeout overrides (milliseconds).
   * Unspecified stages use DEFAULT_STAGE_TIMEOUTS.
   * Backward compatible: if absent, all stages use their default budgets.
   */
  stageTimeoutOverrides?: Partial<Record<StageId, number>>;
}

export interface OrchestratorResult {
  /** true when all stages ran to completion (even with escalation/degradation) */
  completed: boolean;
  /** true when a BLOCK failure halted the pipeline */
  blocked: boolean;
  /** which stage triggered the BLOCK halt, if any */
  blockedAt?: StageId;
  /** true when any ESCALATE failure occurred */
  escalated: boolean;
  /** true when any DEGRADE failure occurred (including timeout-degraded stages) */
  degraded: boolean;
  /** per-stage results in execution order */
  stageResults: Array<StageResult & { stage: StageId }>;
  /** final lane from CLASSIFY_LANE, or undefined if pipeline was blocked before */
  finalLane?: string;
  /** StageTimeoutEvents emitted during this run (empty when all stages completed on time) */
  stageTimeouts: StageTimeoutEvent[];
  /** stages that timed out and were handled with a degraded fallback */
  degradedStages: StageId[];
  /** human-readable warnings for each timeout event */
  executionWarnings: string[];
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run the full planning pipeline for a given input.
 *
 * @param input    - initial pipeline input (spec path + optional query)
 * @param handlers - map of stage ID → async handler function (injected for testability)
 */
export async function runOrchestrator(
  input: OrchestratorInput,
  handlers: Record<string, (input: unknown) => Promise<unknown>>,
): Promise<OrchestratorResult> {
  const executor = new StageExecutor();
  const stageResults: Array<StageResult & { stage: StageId }> = [];
  let escalated = false;
  let degraded = false;

  // Sprint 15: accumulated timeout tracking
  const stageTimeouts: StageTimeoutEvent[] = [];
  const degradedStages: StageId[] = [];
  const executionWarnings: string[] = [];

  // Ledger correlation IDs — stable for this orchestrator invocation
  const traceId   = `tr_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  // Chain tracking: ledger_id of the previous stage entry (for parent_ledger_id)
  let prevLedgerId: string | undefined = undefined;

  // Pipeline context — accumulates outputs from each stage
  let intentOutput: IntentDetectOutput | undefined;
  let ecoOutput: EcoBuildOutput | undefined;
  let gateOutput: SufficiencyGateOutput | undefined;
  let teeOutput: TeeBuildOutput | undefined;
  let laneOutput: ClassifyLaneOutput | undefined;

  for (const stage of STAGES) {
    const handler = handlers[stage];
    if (!handler) {
      // No handler provided — apply failure policy
      const error = new Error(`No handler registered for stage: ${stage}`);
      const result = applyFailureMode(FAILURE_POLICY[stage], stage, error);
      stageResults.push(result as StageResult & { stage: StageId });
      if (result.status === "blocked") {
        return {
          completed: false, blocked: true, blockedAt: stage, escalated, degraded, stageResults,
          stageTimeouts, degradedStages, executionWarnings,
        };
      }
      if (result.status === "escalated") escalated = true;
      if (result.status === "degraded") degraded = true;
      continue;
    }

    // ── Build timeout-wrapped handler ──────────────────────────────────────
    const timeoutConfig = getStageTimeoutConfig(stage, input.stageTimeoutOverrides);
    let pendingTimeoutEvent: StageTimeoutEvent | undefined;

    const wrappedHandler = async (executorInput: unknown): Promise<unknown> => {
      const execResult = await runStageWithTimeout(
        stage,
        (_signal) => (handler as (i: unknown) => Promise<unknown>)(executorInput),
        timeoutConfig,
      );
      pendingTimeoutEvent = execResult.timeoutEvent;
      if (execResult.status === 'success') return execResult.output;
      throw execResult.error ?? new Error(
        execResult.timedOut
          ? `Stage ${stage} timed out after ${timeoutConfig.timeoutMs}ms`
          : `Stage ${stage} failed`,
      );
    };

    let result: StageResult;

    // Build stage-specific input from accumulated context
    switch (stage) {
      case "INTENT_DETECT": {
        const stageInput: IntentDetectInput = { specPath: input.specPath, query: input.query };
        result = await executor.execute(
          stage,
          wrappedHandler as (i: IntentDetectInput) => Promise<IntentDetectOutput>,
          stageInput,
          validateIntentDetectInput,
          validateIntentDetectOutput,
        );
        if (result.status === "ok") intentOutput = result.output as IntentDetectOutput;
        break;
      }

      case "ECO_BUILD": {
        const stageInput = {
          intent: intentOutput ?? { primary: "unknown", composite: false },
          specPath: input.specPath,
          targetRoot: input.targetRoot,
        };
        result = await executor.execute(
          stage,
          wrappedHandler as (i: typeof stageInput) => Promise<EcoBuildOutput>,
          stageInput,
          validateEcoBuildInput,
          validateEcoBuildOutput,
        );
        if (result.status === "ok") ecoOutput = result.output as EcoBuildOutput;
        else if (result.output) ecoOutput = result.output as EcoBuildOutput; // use fallback
        break;
      }

      case "SUFFICIENCY_GATE": {
        const stageInput = ecoOutput ?? { confidence_score: 0, eco_dimensions: makePassDimensions(), intent: { primary: "unknown", composite: false } };
        result = await executor.execute(
          stage,
          wrappedHandler as (i: typeof stageInput) => Promise<SufficiencyGateOutput>,
          stageInput,
          validateSufficiencyGateInput,
          validateSufficiencyGateOutput,
        );
        if (result.status === "ok") gateOutput = result.output as SufficiencyGateOutput;
        break;
      }

      case "TEE_BUILD": {
        const stageInput = {
          eco: ecoOutput ?? { intent: { primary: "unknown", composite: false }, eco_dimensions: makePassDimensions(), confidence_score: 0 },
          gate: gateOutput ?? { behavior: "pass" as const, lane: "A", reason: "fallback" },
        };
        result = await executor.execute(
          stage,
          wrappedHandler as (i: typeof stageInput) => Promise<TeeBuildOutput>,
          stageInput,
          validateTeeBuildInput,
          validateTeeBuildOutput,
        );
        if (result.status === "ok") teeOutput = result.output as TeeBuildOutput;
        else if (result.output) teeOutput = result.output as TeeBuildOutput; // degraded fallback
        break;
      }

      case "CLASSIFY_LANE": {
        const stageInput = {
          eco: ecoOutput ?? { intent: { primary: "unknown", composite: false }, eco_dimensions: makePassDimensions(), confidence_score: 0 },
          tee: teeOutput ?? { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] },
        };
        result = await executor.execute(
          stage,
          wrappedHandler as (i: typeof stageInput) => Promise<ClassifyLaneOutput>,
          stageInput,
          validateClassifyLaneInput,
          validateClassifyLaneOutput,
        );
        if (result.status === "ok") laneOutput = result.output as ClassifyLaneOutput;
        else if (result.output) laneOutput = result.output as ClassifyLaneOutput;
        break;
      }

      default: {
        // Should never happen — STAGES is exhaustive
        const error = new Error(`Unknown stage: ${stage}`);
        result = applyFailureMode("BLOCK", stage as StageId, error);
        break;
      }
    }

    stageResults.push(result as StageResult & { stage: StageId });

    // ── Emit ledger entry for this stage ───────────────────────────────────
    if (input.onLedgerEntry) {
      try {
        const stageEntry = fromBoundTrace(
          result.trace,
          { trace_id: traceId, request_id: requestId, stage: 'knowledge', parent_ledger_id: prevLedgerId },
        );
        prevLedgerId = stageEntry.ledger_id;
        input.onLedgerEntry(stageEntry);
      } catch {
        // Ledger emission failure must never crash the pipeline
      }
    }

    // ── Sprint 15: Timeout post-processing ────────────────────────────────
    // Runs BEFORE the BLOCK check so timeout events are captured even when
    // a critical stage (SUFFICIENCY_GATE) times out and blocks the pipeline.
    if (pendingTimeoutEvent?.timed_out) {
      stageTimeouts.push(pendingTimeoutEvent);
      executionWarnings.push(`Stage ${stage} timed out after ${timeoutConfig.timeoutMs}ms`);

      // Annotate the BoundTrace with timeout metadata
      result.trace.timedOut        = true;
      result.trace.timeoutMs       = timeoutConfig.timeoutMs;
      result.trace.failureClass    = 'timeout';
      result.trace.fallbackApplied = pendingTimeoutEvent.fallback_applied;

      if (!timeoutConfig.isCritical) {
        // Non-critical timeout → degrade (regardless of the stage's normal failure mode)
        degradedStages.push(stage);
        degraded = true;
      }
    }

    // ── Check for BLOCK ────────────────────────────────────────────────────
    if (result.status === "blocked") {
      const blockedResult: OrchestratorResult = {
        completed: false,
        blocked: true,
        blockedAt: stage,
        escalated,
        degraded,
        stageResults,
        finalLane: undefined,
        stageTimeouts,
        degradedStages,
        executionWarnings,
      };
      // Emit terminal outcome for blocked pipeline
      if (input.onLedgerEntry) {
        try {
          const outcomeEntry = fromOrchestratorResult(blockedResult, {
            trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId,
          });
          input.onLedgerEntry(outcomeEntry);
        } catch { /* ledger failure must not crash pipeline */ }
      }
      return blockedResult;
    }

    if (result.status === "escalated") escalated = true;
    if (result.status === "degraded") degraded = true;

    // ── SUFFICIENCY_GATE special: block/ask behavior from output ──────────
    // When SUFFICIENCY_GATE succeeds but its output says behavior="block"
    // (refuse) or behavior="ask" (clarify), we treat it as a pipeline block.
    // Both verdicts stop execution — advisory continuation is not permitted.
    if (stage === "SUFFICIENCY_GATE" && result.status === "ok") {
      const gate = result.output as SufficiencyGateOutput;
      if (gate.behavior === "block" || gate.behavior === "ask") {
        const gateBlockResult: OrchestratorResult = {
          completed: false,
          blocked: true,
          blockedAt: stage,
          escalated,
          degraded,
          stageResults,
          finalLane: undefined,
          stageTimeouts,
          degradedStages,
          executionWarnings,
        };
        if (input.onLedgerEntry) {
          try {
            // Emit a dedicated RefusalRecord for the gate verdict
            const refusalCode = gate.behavior === "block" ? "EVIDENCE_GATE_REFUSED" : "EVIDENCE_GATE_CLARIFY";
            const refusalEntry = fromRefusal(
              'classification',
              refusalCode,
              gate.reason,
              { trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId },
            );
            prevLedgerId = refusalEntry.ledger_id;
            input.onLedgerEntry(refusalEntry);

            const outcomeEntry = fromOrchestratorResult(gateBlockResult, {
              trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId,
            });
            input.onLedgerEntry(outcomeEntry);
          } catch { /* ledger failure must not crash pipeline */ }
        }
        return gateBlockResult;
      }
    }
  }

  const finalResult: OrchestratorResult = {
    completed: true,
    blocked: false,
    escalated,
    degraded,
    stageResults,
    finalLane: laneOutput?.lane,
    stageTimeouts,
    degradedStages,
    executionWarnings,
  };

  // Emit terminal outcome for completed pipeline
  if (input.onLedgerEntry) {
    try {
      const outcomeEntry = fromOrchestratorResult(finalResult, {
        trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId,
      });
      input.onLedgerEntry(outcomeEntry);
    } catch { /* ledger failure must not crash pipeline */ }
  }

  return finalResult;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function makePassDimensions() {
  return {
    coverage:  { severity: "pass", detail: "" },
    freshness: { severity: "pass", detail: "" },
    mapping:   { severity: "pass", detail: "" },
    conflict:  { severity: "pass", detail: "", conflict_payload: null },
    graph:     { severity: "pass", detail: "" },
  };
}
