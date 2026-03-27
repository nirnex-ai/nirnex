/**
 * Pipeline module — public API
 */

export { STAGES } from "./types.js";
export type { StageId, StageResult, FailureMode, BoundTrace, StageIOMap } from "./types.js";
export type {
  IntentDetectInput,
  IntentDetectOutput,
  EcoBuildInput,
  EcoBuildOutput,
  SufficiencyGateInput,
  SufficiencyGateOutput,
  TeeBuildInput,
  TeeBuildOutput,
  ClassifyLaneInput,
  ClassifyLaneOutput,
  EcoDimensions,
  ValidationResult,
} from "./types.js";

export {
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

export { FAILURE_POLICY, applyFailureMode } from "./failure-policy.js";
export { bindTrace, hashInputs } from "./trace-binder.js";
export type { BoundTrace as TraceBoundTrace } from "./trace-binder.js";
export { StageExecutor } from "./stage-executor.js";
export { runOrchestrator } from "./orchestrator.js";
export type { OrchestratorInput, OrchestratorResult } from "./orchestrator.js";
export { runStageWithTimeout } from "./timeout.js";
export type { StageTimeoutConfig, StageTimeoutEvent, StageExecutionResult } from "./timeout.js";
