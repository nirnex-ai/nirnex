/**
 * Replay — Public Entry Point
 *
 * Sprint 22: replaced stub implementation with real ledger-backed reconstruction.
 *
 * Replay is reconstruction of prior execution using recorded stage inputs,
 * recorded stage outputs, and recorded nondeterministic dependency responses.
 * Replay is NOT fresh execution against live dependencies (that is a re-run).
 *
 * Use reconstructRun() from the replay runtime for ledger-backed reconstruction.
 * Use the orchestrator with enableReplayCapture=true to capture replay materials.
 */

export {
  reconstructRun,
  checkRunReplayability,
  normalizeForRecord,
  hashRecordedOutput,
  buildReplayMaterial,
  classifyStageReplayability,
  type ReplayReport,
  type ReplayMaterialRecord,
  type ReplayabilityStatus,
  type ExecutionMode,
  type StageReplayResult,
} from './runtime/replay/index.js';
