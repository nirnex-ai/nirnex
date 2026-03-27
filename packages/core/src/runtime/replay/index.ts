/**
 * Replay Engine — Public API
 */

export {
  type ExecutionMode,
  type ReplayabilityStatus,
  type ReplayMaterialRecord,
  type ReplayAttemptedRecord,
  type ReplayVerifiedRecord,
  type ReplayFailedRecord,
  type StageReplayResult,
  type ReplayReport,
} from './types.js';

export {
  normalizeForRecord,
  hashRecordedOutput,
  classifyStageReplayability,
  buildReplayMaterial,
} from './capture.js';

export {
  checkRunReplayability,
  type RunReplayabilityResult,
} from './policy.js';

export {
  reconstructRun,
} from './reconstruct.js';

export {
  validateReplayMaterial,
  validateReplayAttempted,
  validateReplayVerified,
  validateReplayFailed,
} from './validators.js';
