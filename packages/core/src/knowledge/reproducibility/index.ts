/**
 * Reproducibility — Public API
 *
 * Re-exports all public types and functions from the reproducibility module.
 */

export { buildFrozenBundle, resolveReproducibility, collectUnreproducibleReasons, CONFIG_VERSION } from './freeze.js';
export { computeFingerprint, hashContent, hashSources, extractFingerprintInputs } from './fingerprint.js';
export { canonicalizeECO, stableJsonStringify, sortStrings, sortBy } from './canonicalize.js';
export { EcoCache } from './cache.js';
export type {
  FrozenSourceRecord,
  FrozenEvidenceBundle,
  ReproducibilityStatus,
  ECOProvenance,
  CachedEcoEntry,
} from './types.js';
