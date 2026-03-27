/**
 * Confidence Evolution Tracking — Public API
 */

export {
  CONFIDENCE_MODEL_VERSION,
  type ConfidenceBand,
  type ConfidenceTriggerType,
  type ConfidenceDimensions,
  type ConfidenceGates,
  type ConfidenceSnapshotRecord,
} from './types.js';

export {
  computeConfidenceBand,
  ecoSeverityToScore,
} from './bands.js';

export {
  computeConfidenceDiff,
  type ConfidenceDiffResult,
} from './diff.js';

export {
  buildConfidenceSnapshot,
  ecoDimensionsToConfidence,
  type BuildSnapshotParams,
} from './snapshot.js';
