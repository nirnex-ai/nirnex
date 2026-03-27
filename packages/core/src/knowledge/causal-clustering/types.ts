/**
 * Knowledge Layer — Causal Clustering Types
 *
 * Canonical contracts for the causal clustering subsystem.
 * This module sits between raw signal collection and ECO dimension severity
 * finalization. It groups signals by shared probable root cause and emits
 * suppression metadata so that a single root cause cannot fully inflate
 * multiple ECO dimensions simultaneously.
 *
 * Design constraints:
 *   - All types are pure data shapes — no logic
 *   - RawCausalSignal is the normalized signal contract every dimension produces
 *   - CausalCluster encodes primary vs. derived membership
 *   - Suppression is explicit (not hidden math)
 *   - Visibility is preserved: derived signals remain in traces
 */

// ─── Dimension identity ───────────────────────────────────────────────────────

/**
 * The ECO dimension that emitted a signal.
 * 'confidence_input' is used for signals that affect the composite score
 * rather than a named dimension directly.
 */
export type CausalDimension =
  | 'coverage'
  | 'freshness'
  | 'mapping'
  | 'conflict'
  | 'graph_completeness'
  | 'confidence_input';

// ─── Severity candidate ───────────────────────────────────────────────────────

/**
 * The severity this signal would contribute to its dimension before suppression.
 * Mirrors DimensionSeverity.
 */
export type SignalSeverityCandidate = 'pass' | 'warn' | 'escalate' | 'block';

// ─── Fingerprint families ─────────────────────────────────────────────────────

/**
 * The deterministic root-cause families supported in the initial release.
 *
 * Only high-confidence, structurally observable families are included.
 * No probabilistic or semantic families are in scope for release.
 *
 * STALE_INDEX_SCOPE_MISMATCH     — stale index affecting one or more required scopes
 * MISSING_SYMBOL_GRAPH_FOR_SCOPE — symbol graph absent for required scope
 * MISSING_REQUIRED_EVIDENCE      — required evidence class absent for current intent
 * UNRESOLVED_MAPPING_CHAIN       — mapping chain cannot be resolved to a primary target
 * STRUCTURAL_GRAPH_BREAK         — structural graph node/edge failure (not staleness)
 * CONFLICTING_EVIDENCE_SET       — conflicting evidence across sources for same claim
 */
export type FingerprintFamily =
  | 'STALE_INDEX_SCOPE_MISMATCH'
  | 'MISSING_SYMBOL_GRAPH_FOR_SCOPE'
  | 'MISSING_REQUIRED_EVIDENCE'
  | 'UNRESOLVED_MAPPING_CHAIN'
  | 'STRUCTURAL_GRAPH_BREAK'
  | 'CONFLICTING_EVIDENCE_SET';

// ─── Raw causal signal ────────────────────────────────────────────────────────

/**
 * The normalized signal shape emitted by each Knowledge Layer dimension
 * before ECO severity finalization.
 *
 * Every dimension producer must stop passing opaque penalties and instead
 * emit RawCausalSignals. This shape is the minimum foundation; without it,
 * clustering becomes heuristic glue and will rot.
 */
export interface RawCausalSignal {
  /** Stable unique identifier for this signal within a scoring session. */
  signal_id: string;

  /** Which ECO dimension produced this signal. */
  dimension: CausalDimension;

  /** Machine-readable type label for the condition observed. */
  signal_type: string;

  /** Severity this signal would contribute before suppression. */
  severity_candidate: SignalSeverityCandidate;

  /** Stage that produced this signal (e.g. 'freshness', 'mapping', 'graph'). */
  source_stage: string;

  /** Canonical scope IDs affected (sorted, for deterministic fingerprinting). */
  scope_refs: string[];

  /** Symbol or entity identifiers associated with this signal. */
  entity_refs: string[];

  /** File system paths related to this signal. */
  path_refs: string[];

  /** Commit hash or index reference if applicable. */
  commit_ref?: string;

  /** Dependency chain identifiers affected. */
  dependency_refs: string[];

  /** Evidence source references (e.g. 'code:src/auth.ts', 'spec:auth.md'). */
  evidence_refs: string[];

  /**
   * Probable root cause families. The FIRST entry is the primary cause hint
   * and drives fingerprint generation. Additional entries are informational.
   *
   * Do NOT use fuzzy or LLM-inferred hints. Only add a hint when the
   * structural evidence directly supports it.
   */
  cause_hints: FingerprintFamily[];

  /**
   * Deterministic fingerprint computed from cause_hints[0] + sorted scope_refs.
   * Signals with the same fingerprint join the same cluster.
   * Set by buildFingerprint(). Empty string until assigned.
   */
  fingerprint: string;

  /** Additional diagnostic metadata for traces (no clustering logic may depend on this). */
  metadata: Record<string, unknown>;
}

// ─── Causal cluster ───────────────────────────────────────────────────────────

/**
 * A group of RawCausalSignals that share a common probable root cause.
 * One signal is primary; the rest are derived.
 * Derived signals remain visible in traces but do not fully compound severity.
 */
export interface CausalCluster {
  /** Stable cluster identifier for this scoring session. */
  cluster_id: string;

  /** The root cause family this cluster represents. */
  root_cause_type: FingerprintFamily;

  /** Deterministic fingerprint shared by all members. */
  fingerprint: string;

  /**
   * The signal selected as the authoritative representative for this cluster.
   * Primary signal contributes full severity weight; derived signals contribute
   * at reduced weight. Selection follows the priority rule in rules.ts.
   */
  primary_signal_id: string;

  /** All signal_ids that belong to this cluster (includes primary). */
  member_signal_ids: string[];

  /** ECO dimensions affected by this cluster (derived from member dimensions). */
  affected_dimensions: CausalDimension[];

  /** Union of scope_refs across all members. */
  scope_refs: string[];

  /**
   * The highest severity_candidate found across all cluster members.
   * Derived signals cannot independently escalate beyond this ceiling
   * unless they have an unsuppressed second cause.
   */
  severity_ceiling: SignalSeverityCandidate;

  /** Identifies which suppression rule was applied (from rules.ts). */
  suppression_rule: string;

  /** Human-readable explanation of why these signals were clustered. */
  explanation: string;
}

// ─── Suppression record ───────────────────────────────────────────────────────

/**
 * The suppression status of a single signal after clustering.
 *
 * primary:               signal is the authoritative representative; full contribution
 * suppressed_by_cluster: signal is a derived member; reduced contribution
 * independent:           signal has a unique fingerprint; not part of any cluster
 */
export type SuppressionStatus = 'primary' | 'suppressed_by_cluster' | 'independent';

export interface SuppressionRecord {
  signal_id: string;
  status: SuppressionStatus;
  /** Non-null when status = 'suppressed_by_cluster'. */
  cluster_id: string | null;
  /** Non-null when status = 'suppressed_by_cluster'. */
  suppressed_by_signal_id: string | null;
}

// ─── Cluster result ───────────────────────────────────────────────────────────

/**
 * The full output of the causal clustering engine for one scoring session.
 * This is a standalone artifact; downstream consumers must not mutate it.
 */
export interface CausalClusterResult {
  /** All clusters identified this session. */
  clusters: CausalCluster[];

  /**
   * All raw causal signals that were input to the clustering engine.
   * Preserved for trace and audit purposes.
   */
  all_signals: RawCausalSignal[];

  /**
   * Signals that did not join any cluster (unique fingerprint or single-member
   * fingerprint groups). These contribute full weight independently.
   */
  unclustered_signals: RawCausalSignal[];

  /**
   * Index of suppression decisions, keyed by signal_id.
   * Every input signal has exactly one entry here.
   */
  suppression_index: Record<string, SuppressionRecord>;

  /** Aggregate counts for quick inspection and audit. */
  cluster_summary: {
    total_signals: number;
    total_clusters: number;
    suppressed_signal_count: number;
    primary_signal_count: number;
  };
}
