/**
 * Mapping Quality — Public API
 *
 * Single entry point for the quantitative mapping quality module.
 *
 * Usage:
 *   import { scoreMappingQuality, buildMappingQualityInput } from '.../knowledge/mapping/index.js';
 */

export { scoreMappingQuality } from './score.js';
export {
  computeScopeAlignmentScore,
  computeStructuralCoherenceScore,
  computeEvidenceConcentrationScore,
  computeIntentAlignmentScore,
} from './score.js';
export { buildMappingQualityInput } from './signals.js';
export { generateMappingReasons } from './explain.js';
export {
  DEFAULT_MAPPING_THRESHOLDS,
  MAPPING_QUALITY_THRESHOLDS_BY_INTENT,
  SUB_METRIC_WEIGHTS,
  getMappingThresholds,
} from './thresholds.js';

export type {
  MappingQualityResult,
  MappingQualityInput,
  MappingQualityBreakdown,
  PrimaryMappingPath,
  AlternateMappingPath,
} from './types.js';
export type { RawMappingQualityData } from './signals.js';
export type { MappingQualityThresholds } from './thresholds.js';
