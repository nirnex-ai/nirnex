/**
 * Machine-readable reason codes emitted by the freshness subsystem.
 *
 * Used in FreshnessImpact.reasonCodes, decision ledger, and trace output.
 * Each code maps to a deterministic policy outcome — no model inference.
 */
export const FRESHNESS_REASON_CODES = {
  /** Index commit matches HEAD — no freshness issue. */
  INDEX_FRESH: "INDEX_FRESH",

  /** Index is stale but no changed scope intersects any required scope. */
  INDEX_STALE_NO_SCOPE_INTERSECTION: "INDEX_STALE_NO_SCOPE_INTERSECTION",

  /** Stale scopes intersect required scopes at low ratio (>0, <0.25). Warn only. */
  INDEX_STALE_SCOPE_INTERSECTION_LOW: "INDEX_STALE_SCOPE_INTERSECTION_LOW",

  /** Stale scopes intersect required scopes at medium ratio (≥0.25, <0.60). Escalate. */
  INDEX_STALE_SCOPE_INTERSECTION_MEDIUM: "INDEX_STALE_SCOPE_INTERSECTION_MEDIUM",

  /** Stale scopes intersect required scopes at high ratio (≥0.60). Block. */
  INDEX_STALE_SCOPE_INTERSECTION_HIGH: "INDEX_STALE_SCOPE_INTERSECTION_HIGH",

  /** A stale scope that is required has been deleted — index will never self-heal. Block. */
  INDEX_STALE_REQUIRED_SCOPE_DELETED: "INDEX_STALE_REQUIRED_SCOPE_DELETED",

  /** A stale scope that is required has been renamed — identity drift risk. Block. */
  INDEX_STALE_REQUIRED_SCOPE_RENAMED: "INDEX_STALE_REQUIRED_SCOPE_RENAMED",
} as const;

export type FreshnessReasonCode =
  (typeof FRESHNESS_REASON_CODES)[keyof typeof FRESHNESS_REASON_CODES];
