/**
 * Dimension Signal Normalization Layer
 *
 * Converts raw ECO-builder data into the stable DimensionSignals contract.
 * This is the single conversion boundary between raw subsystem data and
 * dimension evaluators. Evaluators must NEVER read raw objects directly.
 *
 * Design constraints:
 *   - Pure function — no side effects, no I/O
 *   - Never throws — missing fields use safe defaults
 *   - Safe defaults must never silently inflate scores
 *     (0 for counts, null for optional references)
 */

import type { DimensionSignals, RawDimensionInput } from './types.js';

// ─── Required evidence classes per intent ─────────────────────────────────────

/**
 * Maps intent → mandatory evidence source types.
 * Coverage dimension uses this to detect missing critical evidence.
 */
const REQUIRED_EVIDENCE_CLASSES: Record<string, string[]> = {
  bug_fix:      ['code'],
  new_feature:  ['spec', 'code'],
  refactor:     ['code'],
  dep_update:   ['code'],
  config_infra: ['code'],
  quick_fix:    ['code'],
  unknown:      [],
};

// ─── Mapping pattern normalization ────────────────────────────────────────────

type NormalizedMappingPattern = DimensionSignals['mappingPattern'];

function normalizePattern(raw: string): NormalizedMappingPattern {
  switch (raw) {
    case '1:1':        return '1:1';
    case '1:chain':    return '1:chain';
    case '1:scattered':return '1:scattered';
    case 'ambiguous':  return 'ambiguous';
    default:           return 'unknown';
  }
}

// ─── Candidate score extraction ───────────────────────────────────────────────

/**
 * Normalize mapping root scores.
 * Converts raw edge_counts into 0..1 relative scores.
 * Primary = highest-ranked candidate; alternate = second strongest.
 * Returns all normalized scores sorted descending for evidence_concentration sub-metric.
 */
function extractCandidateScores(
  roots: Array<{ rank: string; edge_count: number }>,
): { primary: number; alternate: number; allScores: number[] } {
  if (!roots || roots.length === 0) return { primary: 0, alternate: 0, allScores: [] };

  // Sort by edge_count descending
  const sorted = [...roots].sort((a, b) => b.edge_count - a.edge_count);
  const maxEdges = sorted[0].edge_count;

  if (maxEdges === 0) return { primary: 0, alternate: 0, allScores: [] };

  const allScores = sorted.map(r => r.edge_count / maxEdges);
  const primaryScore = allScores[0]!;  // always 1.0
  const alternateScore = allScores.length > 1 ? allScores[1]! : 0;

  return { primary: primaryScore, alternate: alternateScore, allScores };
}

// ─── buildDimensionSignals ────────────────────────────────────────────────────

/**
 * Convert raw ECO-builder data into normalized DimensionSignals.
 *
 * Called once per scoring session. Result is passed to all 5 evaluators.
 */
export function buildDimensionSignals(raw: RawDimensionInput): DimensionSignals {
  // ── Coverage signals ───────────────────────────────────────────────────────
  const modulesTouched = raw.modulesTouched ?? [];
  // At minimum 1 to avoid division-by-zero; reflects "at least 1 scope required"
  const requestedScopeCount = Math.max(modulesTouched.length, 1);

  const evidence = raw.evidence ?? [];

  // Unique evidence source types retrieved
  const retrievedEvidenceClasses = [...new Set(evidence.map(e => e.source))];

  // Matched scope count: scopes we have code/spec evidence for
  // Conservative: if we have any substantive evidence, count modules as matched
  const hasSubstantiveEvidence = evidence.some(
    e => e.source === 'code' || e.source === 'spec' || e.source === 'graph',
  );
  const matchedScopeCount = hasSubstantiveEvidence ? requestedScopeCount : 0;

  // Required evidence classes for this intent
  const requiredEvidenceClasses =
    REQUIRED_EVIDENCE_CLASSES[raw.intent] ?? REQUIRED_EVIDENCE_CLASSES['unknown']!;

  // ── Mapping signals ────────────────────────────────────────────────────────
  const mappingPattern = normalizePattern(raw.mappingPattern ?? 'unknown');
  const {
    primary: primaryCandidateScore,
    alternate: alternateCandidateScore,
    allScores: allCandidateScores,
  } = extractCandidateScores(raw.mappingRootsRanked ?? []);

  // Disconnected cluster count — 0 means unknown or fully connected graph
  const disconnectedClusterCount = raw.disconnectedClusters ?? 0;

  // Symbol resolution — not available from raw input yet; use 0/0 = unknown state
  // Downstream code will detect totalSymbolCount=0 as "unknown" and emit warn
  const symbolsResolved = 0;
  const symbolsUnresolved = 0;

  // ── Graph signals ─────────────────────────────────────────────────────────
  const g = raw.graphDiagnostics;
  const parseFailureCount    = g?.parseFailures       ?? 0;
  const brokenSymbolCount    = g?.brokenSymbols        ?? 0;
  const totalSymbolCount     = g?.totalSymbols         ?? 0;
  const graphDepthAchieved   = g?.depthAchieved        ?? 0;
  const graphDepthRequested  = g?.depthRequested       ?? 0;
  const fallbackUsageRate    = Math.min(Math.max(g?.fallbackRate ?? 0, 0), 1);
  const criticalNodesMissing = g?.criticalNodesMissing ?? 0;

  // ── Scope IDs ─────────────────────────────────────────────────────────────
  const scopeIds = raw.scopeIds ?? modulesTouched;

  return {
    matchedScopeCount,
    requestedScopeCount,
    retrievedEvidenceClasses,
    requiredEvidenceClasses,

    freshnessImpact: raw.freshnessImpact ?? null,

    mappingPattern,
    primaryCandidateScore,
    alternateCandidateScore,
    allCandidateScores,
    disconnectedClusterCount,
    symbolsResolved,
    symbolsUnresolved,

    conflicts: raw.conflicts ?? [],

    parseFailureCount,
    brokenSymbolCount,
    totalSymbolCount,
    graphDepthAchieved,
    graphDepthRequested,
    fallbackUsageRate,
    criticalNodesMissing,

    intent: raw.intent ?? 'unknown',
    scopeIds,
  };
}

export type { RawDimensionInput };
