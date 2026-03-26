/**
 * Dimension Thresholds — centralized scoring policy
 *
 * Thresholds govern when a dimension value transitions between severity bands.
 * All evaluators must read thresholds from here — no inline constants.
 *
 * Design constraints:
 *   - Thresholds are config, not logic. Evaluators apply them; they do not own them.
 *   - DEFAULT_THRESHOLDS are the production defaults.
 *   - getThresholds(intent?) allows future intent-specific calibration packs.
 *   - Threshold values: pass > warn > escalate (values < escalate → block)
 */

import type { DimensionThresholds } from './types.js';

// ─── Default thresholds ───────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS: DimensionThresholds = Object.freeze({
  coverage: {
    pass:     0.80,
    warn:     0.60,
    escalate: 0.30,
    // < 0.30 → block
  },
  freshness: {
    // Freshness uses FreshnessImpact severity directly, not a numeric band.
    // These thresholds are provided for completeness / future calibration.
    pass:     1.0,
    warn:     0.85,
    escalate: 0.60,
  },
  mapping: {
    pass:     0.80,
    warn:     0.60,
    escalate: 0.30,
    // < 0.30 → block
  },
  conflict: {
    // Conflict uses dominant severity directly, not a numeric band.
    // These thresholds are provided for completeness / future calibration.
    pass:     1.0,
    warn:     0.75,
    escalate: 0.40,
  },
  graph: {
    pass:     0.80,
    warn:     0.60,
    escalate: 0.30,
    // < 0.30 → block
  },
} as const);

// ─── Intent-specific overrides ────────────────────────────────────────────────

/**
 * Optional per-intent threshold packs. These allow tighter or looser thresholds
 * for specific intents without redesigning the scoring architecture.
 *
 * Currently empty — all intents use DEFAULT_THRESHOLDS.
 * Add entries here as calibration data accumulates.
 */
const INTENT_OVERRIDES: Partial<Record<string, Partial<DimensionThresholds>>> = {
  // Example (not active):
  // new_feature: {
  //   coverage: { pass: 0.85, warn: 0.65, escalate: 0.35 },
  // },
};

// ─── getThresholds ────────────────────────────────────────────────────────────

/**
 * Get thresholds for the given intent.
 * Returns DEFAULT_THRESHOLDS with any intent-specific dimension overrides applied.
 *
 * @param intent - optional intent string (e.g. 'bug_fix', 'new_feature')
 * @returns DimensionThresholds — always fully populated
 */
export function getThresholds(intent?: string): DimensionThresholds {
  if (!intent) return DEFAULT_THRESHOLDS;

  const override = INTENT_OVERRIDES[intent];
  if (!override) return DEFAULT_THRESHOLDS;

  // Merge override into defaults (deep merge at band level)
  return {
    coverage:  { ...DEFAULT_THRESHOLDS.coverage,  ...(override.coverage  ?? {}) },
    freshness: { ...DEFAULT_THRESHOLDS.freshness, ...(override.freshness ?? {}) },
    mapping:   { ...DEFAULT_THRESHOLDS.mapping,   ...(override.mapping   ?? {}) },
    conflict:  { ...DEFAULT_THRESHOLDS.conflict,  ...(override.conflict  ?? {}) },
    graph:     { ...DEFAULT_THRESHOLDS.graph,      ...(override.graph     ?? {}) },
  };
}
