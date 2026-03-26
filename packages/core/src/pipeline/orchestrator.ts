/**
 * OrchestratorRunner — Runs the planning pipeline in canonical stage order
 *
 * Enforces deterministic stage ordering via STAGES const.
 * BLOCK failures halt the pipeline immediately.
 * ESCALATE/DEGRADE failures continue with fallback output and set flags.
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  specPath: string | null;
  query?: string;
  targetRoot?: string;
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
  /** true when any DEGRADE failure occurred */
  degraded: boolean;
  /** per-stage results in execution order */
  stageResults: Array<StageResult & { stage: StageId }>;
  /** final lane from CLASSIFY_LANE, or undefined if pipeline was blocked before */
  finalLane?: string;
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
        return { completed: false, blocked: true, blockedAt: stage, escalated, degraded, stageResults };
      }
      if (result.status === "escalated") escalated = true;
      if (result.status === "degraded") degraded = true;
      continue;
    }

    let result: StageResult;

    // Build stage-specific input from accumulated context
    switch (stage) {
      case "INTENT_DETECT": {
        const stageInput: IntentDetectInput = { specPath: input.specPath, query: input.query };
        result = await executor.execute(
          stage,
          handler as (i: IntentDetectInput) => Promise<IntentDetectOutput>,
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
          handler as (i: typeof stageInput) => Promise<EcoBuildOutput>,
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
          handler as (i: typeof stageInput) => Promise<SufficiencyGateOutput>,
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
          handler as (i: typeof stageInput) => Promise<TeeBuildOutput>,
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
          handler as (i: typeof stageInput) => Promise<ClassifyLaneOutput>,
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

    // ── Check for BLOCK ────────────────────────────────────────────────────
    if (result.status === "blocked") {
      return {
        completed: false,
        blocked: true,
        blockedAt: stage,
        escalated,
        degraded,
        stageResults,
        finalLane: undefined,
      };
    }

    if (result.status === "escalated") escalated = true;
    if (result.status === "degraded") degraded = true;

    // ── SUFFICIENCY_GATE special: block behavior from output ───────────────
    // When SUFFICIENCY_GATE succeeds but its output says behavior="block",
    // we treat it as a pipeline block (the gate has passed validation but
    // the gate decision itself is to block the pipeline).
    if (stage === "SUFFICIENCY_GATE" && result.status === "ok") {
      const gate = result.output as SufficiencyGateOutput;
      if (gate.behavior === "block") {
        return {
          completed: false,
          blocked: true,
          blockedAt: stage,
          escalated,
          degraded,
          stageResults,
          finalLane: undefined,
        };
      }
    }
  }

  return {
    completed: true,
    blocked: false,
    escalated,
    degraded,
    stageResults,
    finalLane: laneOutput?.lane,
  };
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
