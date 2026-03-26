/**
 * StrategySelector — Deterministic strategy selection for a given intent
 *
 * Strategy governs how a planning step should be executed:
 *   surgical        — minimal targeted change, high precision required
 *   additive        — append/extend without touching existing code paths
 *   structural      — restructure existing code; requires full graph view
 *   full_replacement — complete rewrite of the affected module/scope
 *
 * Design constraints:
 *   - Pure function — no side effects, no I/O
 *   - Deterministic — same (intent, override?) → same StrategyDecision
 *   - NEVER_PERMITTED combos are rejected even when explicitly requested
 *   - Rejected overrides fall back to the intent default with a rejection record
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Strategy = "surgical" | "additive" | "structural" | "full_replacement";

export interface StrategyDecision {
  strategy: Strategy;
  /** 'default' when no override was requested or override was rejected; 'override' when accepted */
  source: "default" | "override";
  /** The override that was rejected, if any */
  rejectedOverride?: Strategy;
  /** Why the override was rejected */
  rejectionReason?: string;
}

// ─── STRATEGY_DEFAULTS — intent → default strategy ───────────────────────────

export const STRATEGY_DEFAULTS: Record<string, Strategy> = Object.freeze({
  bug_fix:      "surgical",
  new_feature:  "additive",
  refactor:     "structural",
  dep_update:   "additive",
  config_infra: "surgical",
  unknown:      "additive",
  quick_fix:    "surgical",
} as const);

// ─── NEVER_PERMITTED — (intent, strategy) combos that are always rejected ─────

/**
 * Maps intent → array of strategies that are NEVER permitted for that intent.
 *
 * Rationale:
 *   refactor + surgical     — surgical implies minimal change; refactor requires structural view
 *   config_infra + full_replacement — rewriting infra is never safe to do automatically
 *   dep_update + structural — structural change for a dep update makes no semantic sense
 */
export const NEVER_PERMITTED: Record<string, Strategy[]> = Object.freeze({
  refactor:     ["surgical"],
  config_infra: ["full_replacement"],
  dep_update:   ["structural", "full_replacement"],
} as const);

// ─── PERMITTED — explicit allowed overrides per intent ────────────────────────

/**
 * When an override is NOT in NEVER_PERMITTED, it is permitted by default.
 * This map is kept for documentation; the selector logic uses NEVER_PERMITTED
 * as the authoritative rejection rule.
 */
export const PERMITTED: Record<string, Strategy[]> = Object.freeze({
  bug_fix:      ["surgical", "additive", "structural", "full_replacement"],
  new_feature:  ["additive", "structural", "surgical"],
  refactor:     ["structural", "additive", "full_replacement"],
  dep_update:   ["additive", "surgical"],
  config_infra: ["surgical", "additive"],
  unknown:      ["additive", "surgical", "structural"],
} as const);

// ─── selectStrategy ───────────────────────────────────────────────────────────

/**
 * Select the strategy for a given intent and optional override request.
 *
 * @param intent   - the primary intent (e.g. 'bug_fix', 'refactor')
 * @param override - optional caller-requested strategy
 * @returns StrategyDecision
 */
export function selectStrategy(intent: string, override?: Strategy): StrategyDecision {
  const defaultStrategy: Strategy = STRATEGY_DEFAULTS[intent] ?? "additive";

  // No override requested — return default
  if (override === undefined) {
    return { strategy: defaultStrategy, source: "default" };
  }

  // Check NEVER_PERMITTED
  const neverList: Strategy[] = NEVER_PERMITTED[intent] ?? [];
  if (neverList.includes(override)) {
    return {
      strategy: defaultStrategy,
      source: "default",
      rejectedOverride: override,
      rejectionReason: `Strategy '${override}' is never permitted for intent '${intent}'`,
    };
  }

  // Override is permitted
  return { strategy: override, source: "override" };
}
