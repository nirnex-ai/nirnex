/**
 * Knowledge Layer — Reproducibility Types
 *
 * Canonical contracts for the reproducibility boundary.
 *
 * Architecture:
 *   All ECO inputs must be frozen into a FrozenEvidenceBundle before scoring
 *   starts. The bundle is fingerprinted. The fingerprint is used as a cache key.
 *   The ECO output carries ECOProvenance that exposes the fingerprint and
 *   reproducibility status to callers and the policy engine.
 *
 * Reproducibility modes:
 *   strict    — all sources frozen and deterministically fingerprinted
 *   bounded   — frozen, but includes provider-dependent artifacts (e.g. pre-frozen
 *               LLM outputs whose reproducibility depends on the provider)
 *   unbounded — at least one live/unfrozen source was used during build;
 *               policy engine escalates lane or blocks on high-risk intents
 *
 * Design constraints:
 *   - frozen_at is volatile (timestamp) and MUST NOT be part of the fingerprint
 *   - All arrays in the bundle are canonically sorted before fingerprinting
 *   - Policy engine must not alter ECO dimension values — only lane escalation
 */

// ─── Source record ────────────────────────────────────────────────────────────

/**
 * A single frozen evidence source. Captured before ECO scoring starts.
 * Source types mirror EvidenceItem.source from conflict detection.
 */
export interface FrozenSourceRecord {
  source: string;
  ref: string;
  content: string;
}

// ─── Frozen evidence bundle ───────────────────────────────────────────────────

/**
 * Immutable snapshot of all ECO inputs captured at the freeze boundary.
 * This is the canonical input to ECO scoring — after this point, no
 * live/mutable source may be accessed by the scoring pipeline.
 */
export interface FrozenEvidenceBundle {
  /**
   * ISO 8601 timestamp when the bundle was frozen.
   * Volatile — MUST NOT be included in the fingerprint.
   */
  frozen_at: string;

  spec: {
    /** SHA-256 of the spec file content. Empty string when no spec or query. */
    content_hash: string;
    /** SHA-256 of the normalized spec (whitespace-normalized). */
    normalized_hash: string;
    /** Original spec file path, if provided. */
    path?: string;
  };

  repo: {
    /** Git HEAD commit SHA at freeze time. 'unknown' when git is unavailable. */
    head_commit: string;
    /** True when working tree has uncommitted changes. False when unknown. */
    dirty: boolean;
    /**
     * Hash of the relevant working-tree diff, when dirty=true and diff is available.
     * Undefined when committed-only mode or diff not computable.
     */
    dirty_scope_hash?: string;
  };

  index: {
    /**
     * Stable ID for the current index snapshot.
     * Typically the indexed commit SHA from .aidos.db. 'unknown' when unavailable.
     */
    snapshot_id: string;
    /** SHA-256 of the index snapshot content. 'unknown' when not computable. */
    content_hash: string;
    /** The git commit the index was built from. 'unknown' when unavailable. */
    built_from_commit?: string;
  };

  retrieval: {
    /**
     * All evidence sources frozen into this bundle, canonically sorted.
     * Sorting key: source → ref → content (lexicographic).
     */
    sources: FrozenSourceRecord[];
    /**
     * SHA-256 of the canonical aggregate of all source contents.
     * Covers: sorted concatenation of (source + ref + content) for every record.
     */
    aggregate_hash: string;
  };

  build: {
    /**
     * Hash of the active configuration (thresholds, intent patterns).
     * For initial release: a hardcoded version string.
     */
    config_hash: string;
    /**
     * Versions of any prompt templates used to derive evidence.
     * Empty object when no prompt-derived evidence exists.
     */
    prompt_versions: Record<string, string>;
    /**
     * Model/provider versions for any LLM-derived evidence.
     * Empty object when no LLM evidence exists (current default).
     */
    model_versions: Record<string, string>;
    /** Version of the dimension scoring normalizer (CALCULATION_VERSION). */
    normalizer_version: string;
    /** Ledger schema version. */
    schema_version: string;
  };
}

// ─── Reproducibility status ───────────────────────────────────────────────────

/**
 * The reproducibility guarantee level for a given ECO build.
 *
 * strict    — all inputs frozen and deterministically fingerprinted;
 *             same fingerprint guarantees same ECO output
 * bounded   — frozen, but includes provider-dependent artifacts;
 *             fingerprint is stable for the captured outputs,
 *             but regenerating from scratch may differ
 * unbounded — a live/unfrozen source was used; no reproducibility guarantee;
 *             policy engine must escalate or block
 */
export type ReproducibilityStatus = 'strict' | 'bounded' | 'unbounded';

// ─── ECO provenance ───────────────────────────────────────────────────────────

/**
 * Reproducibility metadata attached to every ECO output.
 * Exposed in ECO payload and recorded in the decision ledger.
 */
export interface ECOProvenance {
  /** Full SHA-256 fingerprint of the FrozenEvidenceBundle. */
  fingerprint: string;

  /** The reproducibility guarantee level for this ECO build. */
  reproducibility: ReproducibilityStatus;

  /** True when this ECO result was served from the content-addressed cache. */
  cache_hit: boolean;

  /**
   * Subset of bundle fields exposed for quick inspection without reading the
   * full bundle. Used by policy engine and ledger mappers.
   */
  bundle_snapshot: {
    spec_content_hash?: string;
    head_commit?: string;
    indexed_commit?: string;
    aggregate_evidence_hash?: string;
    normalizer_version: string;
    schema_version: string;
    config_hash?: string;
  };

  /**
   * Non-empty when reproducibility = 'unbounded'.
   * Human-readable explanations of why the build is non-reproducible.
   */
  unreproducible_reasons?: string[];
}

// ─── Cache entry ──────────────────────────────────────────────────────────────

/**
 * A stored ECO cache entry.
 */
export interface CachedEcoEntry {
  /** Fingerprint used as the cache key. */
  fingerprint: string;
  /** The full ECO payload as serialized at cache-write time. */
  eco: Record<string, unknown>;
  /** The provenance metadata that was attached when the ECO was cached. */
  provenance: ECOProvenance;
  /** ISO 8601 timestamp when the entry was written to the cache. */
  created_at: string;
}
