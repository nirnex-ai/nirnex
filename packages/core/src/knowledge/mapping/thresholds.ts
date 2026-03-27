/**
 * Mapping Quality — Thresholds
 *
 * Governs when a composite mapping quality score transitions between severity bands.
 *
 * Design constraints:
 *   - Thresholds are config, not logic. scorer applies them; it does not own them.
 *   - DEFAULT_MAPPING_THRESHOLDS is the production default.
 *   - Per-intent overrides allow tighter requirements for high-risk intents.
 *   - Threshold hierarchy: pass > warn > escalate (values < escalate → block)
 */

export interface MappingQualityThresholds {
  /** Minimum score for 'pass' classification. */
  pass: number;
  /** Minimum score for 'warn' classification. */
  warn: number;
  /** Minimum score for 'escalate' classification. Below → 'block'. */
  escalate: number;
}

// ─── Sub-metric weights ───────────────────────────────────────────────────────

/**
 * Weights must sum to 1.0.
 * Frozen — change by incrementing CALCULATION_VERSION in scoreDimensions.ts.
 */
export const SUB_METRIC_WEIGHTS = Object.freeze({
  scope_alignment:        0.35,
  structural_coherence:   0.30,
  evidence_concentration: 0.20,
  intent_alignment:       0.15,
} as const);

// ─── Default thresholds ───────────────────────────────────────────────────────

/**
 * Production defaults.
 *
 * 90–100 → pass     (clear, grounded mapping)
 * 75–89  → warn     (mapping adequate; analyst attention recommended)
 * 55–74  → escalate (mapping ambiguous; execution requires clarification)
 *  0–54  → block    (mapping unreliable; execution must not proceed)
 */
export const DEFAULT_MAPPING_THRESHOLDS: MappingQualityThresholds = Object.freeze({
  pass:     90,
  warn:     75,
  escalate: 55,
});

// ─── Per-intent threshold overrides ──────────────────────────────────────────

/**
 * Bug fix and dependency update require tighter mapping (higher thresholds)
 * because executing in the wrong place causes regressions.
 *
 * Config/infra changes allow slightly looser mapping because
 * the blast radius of a wrong-target config change is more bounded.
 */
const INTENT_THRESHOLD_OVERRIDES: Partial<Record<string, MappingQualityThresholds>> = {
  bug_fix: {
    pass:     92,
    warn:     78,
    escalate: 58,
  },
  dep_update: {
    pass:     92,
    warn:     78,
    escalate: 58,
  },
  config_infra: {
    pass:     85,
    warn:     68,
    escalate: 48,
  },
};

// Export for test verification
export const MAPPING_QUALITY_THRESHOLDS_BY_INTENT = INTENT_THRESHOLD_OVERRIDES;

// ─── getMappingThresholds ─────────────────────────────────────────────────────

/**
 * Get mapping quality thresholds for the given intent.
 *
 * @param intent - optional intent string
 * @returns MappingQualityThresholds — always fully populated
 */
export function getMappingThresholds(intent?: string): MappingQualityThresholds {
  if (!intent) return DEFAULT_MAPPING_THRESHOLDS;
  return INTENT_THRESHOLD_OVERRIDES[intent] ?? DEFAULT_MAPPING_THRESHOLDS;
}
