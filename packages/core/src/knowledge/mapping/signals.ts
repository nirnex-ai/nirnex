/**
 * Mapping Quality — Signal Normalization
 *
 * Converts DimensionSignals (or a raw equivalent) into the MappingQualityInput
 * contract that scoreMappingQuality() accepts.
 *
 * Design constraints:
 *   - Pure function — no I/O, no side effects
 *   - Never throws — missing or unknown fields use safe defaults
 *   - Safe defaults must not silently inflate scores (0 for counts)
 */

import type { MappingQualityInput } from './types.js';
import type { DimensionSignals } from '../dimensions/types.js';

// ─── Raw input type (accepts DimensionSignals superset) ──────────────────────

/**
 * Raw data accepted by buildMappingQualityInput.
 * Matches DimensionSignals exactly, but all fields are optional so that
 * callers can pass partially-constructed objects in tests.
 */
export type RawMappingQualityData = Pick<
  DimensionSignals,
  | 'intent'
  | 'mappingPattern'
  | 'primaryCandidateScore'
  | 'alternateCandidateScore'
  | 'matchedScopeCount'
  | 'requestedScopeCount'
  | 'retrievedEvidenceClasses'
  | 'requiredEvidenceClasses'
  | 'symbolsResolved'
  | 'symbolsUnresolved'
  | 'scopeIds'
> & {
  /** Full list of normalized candidate scores [0..1], sorted descending. */
  allCandidateScores?: number[];
  /** Candidates whose primary target is within the requested scope. */
  scopedCandidateCount?: number;
  /** Candidates whose primary target is outside the requested scope. */
  outOfScopeCandidateCount?: number;
  /** Number of disconnected evidence clusters (0 = unknown). */
  disconnectedClusterCount?: number;
  /** Concrete file paths known to be in scope (from retrieval). */
  knownScopePaths?: string[];
};

// ─── buildMappingQualityInput ─────────────────────────────────────────────────

/**
 * Build a MappingQualityInput from DimensionSignals (or a compatible subset).
 *
 * Called by computeMappingDimension before invoking scoreMappingQuality().
 */
export function buildMappingQualityInput(raw: RawMappingQualityData): MappingQualityInput {
  // ── Candidate scores ──────────────────────────────────────────────────────
  // allCandidateScores: use provided, or synthesise from primary/alternate
  const primary   = raw.primaryCandidateScore ?? 0;
  const alternate = raw.alternateCandidateScore ?? 0;

  let allScores: number[];
  if (raw.allCandidateScores && raw.allCandidateScores.length > 0) {
    allScores = [...raw.allCandidateScores].sort((a, b) => b - a);
  } else if (primary > 0 && alternate > 0) {
    allScores = [primary, alternate].sort((a, b) => b - a);
  } else if (primary > 0) {
    allScores = [primary];
  } else {
    allScores = [];
  }

  // ── Scope candidate counts ────────────────────────────────────────────────
  // When not explicitly provided, derive conservatively from mapping pattern:
  //   1:scattered → assume all out-of-scope (worst case)
  //   1:1 / 1:chain → assume all candidates in scope (best case for defaults)
  //   ambiguous / unknown → assume half in scope (neutral default)
  const totalCandidates = allScores.length;

  let scopedCandidateCount: number;
  let outOfScopeCandidateCount: number;

  if (raw.scopedCandidateCount !== undefined && raw.outOfScopeCandidateCount !== undefined) {
    scopedCandidateCount    = raw.scopedCandidateCount;
    outOfScopeCandidateCount = raw.outOfScopeCandidateCount;
  } else if (raw.mappingPattern === '1:scattered') {
    scopedCandidateCount    = 0;
    outOfScopeCandidateCount = totalCandidates;
  } else if (raw.mappingPattern === '1:1' || raw.mappingPattern === '1:chain') {
    scopedCandidateCount    = totalCandidates;
    outOfScopeCandidateCount = 0;
  } else {
    // ambiguous / unknown: split conservatively
    scopedCandidateCount    = Math.floor(totalCandidates / 2);
    outOfScopeCandidateCount = totalCandidates - scopedCandidateCount;
  }

  return {
    intent:                   raw.intent ?? 'unknown',
    mappingPattern:           raw.mappingPattern ?? 'unknown',
    primaryCandidateScore:    primary,
    alternateCandidateScore:  alternate,
    allCandidateScores:       allScores,
    matchedScopeCount:        raw.matchedScopeCount ?? 0,
    requestedScopeCount:      Math.max(raw.requestedScopeCount ?? 1, 1),
    scopedCandidateCount,
    outOfScopeCandidateCount,
    disconnectedClusterCount: raw.disconnectedClusterCount ?? 0,
    retrievedEvidenceClasses: raw.retrievedEvidenceClasses ?? [],
    requiredEvidenceClasses:  raw.requiredEvidenceClasses ?? [],
    symbolsResolved:          raw.symbolsResolved ?? 0,
    symbolsUnresolved:        raw.symbolsUnresolved ?? 0,
    knownScopePaths:          raw.knownScopePaths ?? raw.scopeIds ?? [],
  };
}
