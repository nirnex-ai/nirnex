/**
 * Knowledge Layer — Dimensions module public API
 */

export { buildDimensionSignals } from './signals.js';
export type { RawDimensionInput } from './signals.js';

export { computeCoverageDimension } from './coverage.js';
export { computeFreshnessDimension } from './freshness.js';
export { computeMappingDimension } from './mapping.js';
export { computeConflictDimension } from './conflict.js';
export { computeGraphCompletenessDimension } from './graphCompleteness.js';

export { scoreDimensions, CALCULATION_VERSION } from './scoreDimensions.js';

export { DEFAULT_THRESHOLDS, getThresholds } from './thresholds.js';
export type { DimensionThresholds } from './types.js';

export {
  COVERAGE_REASON_CODES,
  FRESHNESS_DIMENSION_REASON_CODES,
  MAPPING_REASON_CODES,
  CONFLICT_REASON_CODES,
  GRAPH_REASON_CODES,
} from './reason-codes.js';

export type {
  DimensionResult,
  DimensionSeverity,
  DimensionSignals,
  ScoreDimensionsOutput,
  ThresholdBand,
} from './types.js';
