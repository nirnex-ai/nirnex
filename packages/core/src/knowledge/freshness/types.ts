/**
 * Scope-aware freshness contracts.
 *
 * Layering:
 *   FreshnessSnapshot      — raw git-diff facts
 *   RequiredScopeRef       — what the current request demands
 *   StaleScopeRef          — what the index is missing
 *   FreshnessImpact        — deterministic intersection result
 *   FreshnessDimensionEntry — decision-facing ECO representation
 */

/** Describes the state of the index relative to HEAD. */
export type FreshnessSnapshot = {
  /** Commit hash recorded in the index database. */
  indexedCommit: string;
  /** Current HEAD commit hash. */
  headCommit: string;
  /** True when indexedCommit !== headCommit. */
  isStale: boolean;
  /** Canonical file paths changed between indexedCommit and HEAD. */
  changedFiles: string[];
  /** Per-file change types, parsed from `git diff --name-status`. */
  changedFileStatuses: Array<{
    path: string;
    changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  }>;
  /** ISO 8601 timestamp when the snapshot was built. */
  generatedAt: string;
};

/** A scope required by the current retrieval / intent / graph traversal. */
export type RequiredScopeRef = {
  /** Canonical file path, when scope is file-level. */
  filePath?: string;
  /** Symbol identifier, when scope is symbol-level. */
  symbolId?: string;
  /** Stable scope identifier used for intersection. */
  scopeId: string;
  /** Origin of this scope requirement. */
  source: 'retrieval' | 'intent' | 'graph';
  /** Deterministic weight from retrieval ranking (not model-inferred). */
  weight: number;
};

/** A scope that is stale (changed since the last index build). */
export type StaleScopeRef = {
  /** Canonical file path. */
  filePath: string;
  /** Symbol IDs within this file that are stale (empty = whole file is stale). */
  symbolIds?: string[];
  /** Scope IDs covered by this stale file. */
  scopeIds: string[];
  /** How the file changed. */
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
};

/** Deterministic intersection result fed into ECO and confidence scoring. */
export type FreshnessImpact = {
  /** Whether the index is stale relative to HEAD. */
  isStale: boolean;
  /** Number of stale scope refs. */
  staleScopeCount: number;
  /** Number of required scope refs. */
  requiredScopeCount: number;
  /** Number of scopes that appear in both stale and required sets. */
  intersectedScopeCount: number;
  /** Canonical file paths that are both stale and required. */
  impactedFiles: string[];
  /** Scope IDs that are both stale and required. */
  impactedScopeIds: string[];
  /** intersectedScopeCount / max(requiredScopeCount, 1) */
  impactRatio: number;
  /** Deterministic severity derived from thresholds and change types. */
  severity: 'none' | 'warn' | 'escalate' | 'block';
  /** Machine-readable reason codes for ledger/replay. */
  reasonCodes: string[];
};

/**
 * Decision-facing representation stored in ECO.
 * Distinguishes three cases that matter for execution gating:
 *   fresh            — index == HEAD
 *   stale_unrelated  — index stale but no required scope intersects
 *   stale_impacted   — stale + intersection exists
 */
export type FreshnessDimensionEntry = {
  status: 'fresh' | 'stale_unrelated' | 'stale_impacted';
  indexedCommit: string;
  headCommit: string;
  impactedFiles: string[];
  impactedScopeIds: string[];
  impactRatio: number;
  severity: 'none' | 'warn' | 'escalate' | 'block';
  provenance: {
    requiredScopesSource: string[];
    staleScopesSource: string[];
  };
};
