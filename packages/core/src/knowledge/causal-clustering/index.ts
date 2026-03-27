/**
 * Knowledge Layer — Causal Clustering public API
 *
 * Exports the types, fingerprint builder, and clustering engine.
 * The signal builder (buildRawCausalSignals) is also exported so that
 * scoreDimensions can produce signals from DimensionSignals.
 */

// ── Types ──────────────────────────────────────────────────────────────────────
export type {
  CausalDimension,
  SignalSeverityCandidate,
  FingerprintFamily,
  RawCausalSignal,
  CausalCluster,
  SuppressionStatus,
  SuppressionRecord,
  CausalClusterResult,
} from './types.js';

// ── Fingerprinting ─────────────────────────────────────────────────────────────
export { buildFingerprint, assignFingerprints } from './fingerprints.js';

// ── Rules ──────────────────────────────────────────────────────────────────────
export {
  getDimensionPriority,
  getSeverityRank,
  DERIVED_WEIGHT_FACTOR,
  SUPPRESSION_RULES,
  selectPrimarySignalId,
  computeSeverityCeiling,
} from './rules.js';

// ── Clustering engine + signal builder ────────────────────────────────────────
export { clusterCausalSignals, buildRawCausalSignals } from './cluster.js';
