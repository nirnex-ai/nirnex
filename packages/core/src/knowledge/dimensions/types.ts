/**
 * Knowledge Layer — Dimension Types
 *
 * Strict runtime contracts for the 5 ECO dimension evaluators.
 * Every downstream consumer must read from these types — not from raw scalars.
 *
 * Design constraints:
 *   - DimensionResult is the uniform output contract for all 5 evaluators
 *   - DimensionSignals is the normalized single-input contract (prevents architecture leakage)
 *   - ScoreDimensionsOutput is the coordinator output (all 5 dims + composite + trace)
 *   - No dimension may depend on another dimension's final score (enforced by signal isolation)
 */

import type { ConflictRecord } from '../conflict/types.js';
import type { FreshnessImpact } from '../freshness/types.js';
import type { CausalClusterResult, FingerprintFamily } from '../causal-clustering/types.js';

// ─── Dimension severity ───────────────────────────────────────────────────────

export type DimensionSeverity = 'pass' | 'warn' | 'escalate' | 'block';

// ─── Dimension result (uniform output from each evaluator) ────────────────────

export interface DimensionResult {
  /** Normalized score 0..1, higher = healthier. Derived from raw metrics + thresholds. */
  value: number;
  /** Severity classification: pass | warn | escalate | block */
  status: DimensionSeverity;
  /** Stable machine-readable reason codes for ledger/replay/calibration. */
  reason_codes: string[];
  /** Short machine-safe human summary. */
  summary: string;
  /** Exact evidence/signal references used + threshold values applied. */
  provenance: {
    signals: string[];
    thresholds: Record<string, number>;
  };
  /** Raw numeric inputs used to derive the result (for calibration/replay). */
  metrics: Record<string, number | string | boolean>;
  /**
   * Causal clustering provenance (Sprint 16).
   * Present when causal clustering ran and this dimension has related signals.
   * Undefined when no signals were emitted for this dimension (e.g., fully passing dimension).
   */
  causal?: {
    /** IDs of RawCausalSignals emitted by this dimension. */
    raw_signal_ids: string[];
    /** IDs of clusters this dimension participates in. */
    cluster_ids: string[];
    /** Root cause families for which this dimension is the PRIMARY signal. */
    primary_causes: FingerprintFamily[];
    /** Root cause families for which this dimension is a DERIVED signal (suppressed). */
    derived_causes: FingerprintFamily[];
    /** Signal IDs from this dimension that are suppressed by a cluster. */
    suppressed_signals: string[];
    /**
     * Effective severity after suppression is applied.
     * For derived-only dimensions: softened to at most the cluster ceiling.
     * For primary or independent dimensions: equals status.
     */
    effective_severity: DimensionSeverity;
    /**
     * The true computed severity before any suppression was applied.
     * Always equals status. Preserved for audit/traceability.
     */
    unsuppressed_severity_basis: DimensionSeverity;
  };
}

// ─── Normalized signal input layer ───────────────────────────────────────────

/**
 * The single normalized input object passed to all dimension evaluators.
 * Built by buildDimensionSignals() from raw ECO builder data.
 *
 * Evaluators MUST NOT read directly from different subsystem objects.
 * They MUST only read from DimensionSignals.
 * This boundary prevents cross-dimension coupling and architecture leakage.
 */
export interface DimensionSignals {
  // ── Coverage signals ───────────────────────────────────────────────────────
  /** Number of scope units (modules/files) we retrieved evidence for. */
  matchedScopeCount: number;
  /** Number of scope units the intent requires coverage for. */
  requestedScopeCount: number;
  /** Unique evidence source types actually retrieved (e.g. 'code', 'spec', 'graph'). */
  retrievedEvidenceClasses: string[];
  /** Mandatory evidence classes for this intent (e.g. bug_fix → ['code']). */
  requiredEvidenceClasses: string[];

  // ── Freshness signals ──────────────────────────────────────────────────────
  /** Pre-computed scope-aware freshness intersection result. Null when unavailable. */
  freshnessImpact: FreshnessImpact | null;

  // ── Mapping signals ────────────────────────────────────────────────────────
  /** Detected mapping pattern: '1:1' | '1:chain' | '1:scattered' | 'ambiguous' | 'unknown' */
  mappingPattern: '1:1' | '1:chain' | '1:scattered' | 'ambiguous' | 'unknown';
  /** Normalized score (0..1) of the primary mapping candidate. */
  primaryCandidateScore: number;
  /** Normalized score (0..1) of the strongest alternate mapping candidate. */
  alternateCandidateScore: number;
  /** Number of symbols successfully resolved in the mapping chain. */
  symbolsResolved: number;
  /** Number of symbols that failed to resolve. */
  symbolsUnresolved: number;
  /**
   * All candidate scores [0..1] sorted descending. Used by evidence_concentration
   * sub-metric to compute dominance and entropy.
   * Derived from mappingRootsRanked by buildDimensionSignals().
   * Empty when no candidate data is available.
   */
  allCandidateScores: number[];
  /**
   * Number of disconnected evidence clusters detected in the graph.
   * 0 = unknown state (not computed) or fully connected graph.
   * Used by structural_coherence sub-metric.
   */
  disconnectedClusterCount: number;

  // ── Conflict signals ───────────────────────────────────────────────────────
  /** Normalized ConflictRecord[] from Sprint 8 conflict detection. */
  conflicts: ConflictRecord[];

  // ── Graph completeness signals ─────────────────────────────────────────────
  /** Number of files in scope that failed to parse. */
  parseFailureCount: number;
  /** Number of symbol references that couldn't be resolved. */
  brokenSymbolCount: number;
  /** Total symbols in scope (resolved + broken). 0 = unknown state → emit warn. */
  totalSymbolCount: number;
  /** Depth actually traversed in the graph for this request. */
  graphDepthAchieved: number;
  /** Depth required for this request. 0 = not specified → skip depth penalty. */
  graphDepthRequested: number;
  /** 0..1 fraction of reasoning steps that used approximation/fallback. */
  fallbackUsageRate: number;
  /** Number of nodes in the critical path that are missing from the graph. */
  criticalNodesMissing: number;

  // ── Metadata ───────────────────────────────────────────────────────────────
  /** Primary intent string. */
  intent: string;
  /** Canonical scope IDs for this request. */
  scopeIds: string[];
}

// ─── Raw dimension input (what buildDimensionSignals accepts) ─────────────────

export interface RawGraphDiagnostics {
  parseFailures: number;
  brokenSymbols: number;
  totalSymbols: number;
  depthAchieved: number;
  depthRequested: number;
  fallbackRate: number;
  criticalNodesMissing: number;
}

export interface RawDimensionInput {
  intent: string;
  modulesTouched: string[];
  evidence: Array<{ source: string; ref: string; content: string; metadata?: Record<string, unknown> }>;
  conflicts: ConflictRecord[];
  mappingPattern: string;
  mappingRootsRanked: Array<{ rank: string; edge_count: number }>;
  freshnessImpact: FreshnessImpact | null;
  graphDiagnostics?: RawGraphDiagnostics;
  scopeIds?: string[];
  /** Number of disconnected evidence clusters from graph analysis. 0 = unknown/fully connected. */
  disconnectedClusters?: number;
}

// ─── Coordinator output ───────────────────────────────────────────────────────

export interface ScoreDimensionsOutput {
  dimensions: {
    coverage: DimensionResult;
    freshness: DimensionResult;
    mapping: DimensionResult;
    conflict: DimensionResult;
    graph: DimensionResult;
  };
  /** Weighted composite of all 5 dimension values. 0..100. */
  composite_internal_confidence: number;
  /** The normalized signals snapshot used for scoring (for replay/calibration). */
  trace_inputs: DimensionSignals;
  /** Semver string identifying the scoring algorithm version. Enables future calibration. */
  calculation_version: string;
  /**
   * Causal clustering result (Sprint 16).
   * Always present after scoring; contains the clusters, suppression index,
   * and raw signals used for deduplication. Never null after v3.0.0.
   */
  causal_cluster_result: CausalClusterResult;
}

// ─── Threshold band ───────────────────────────────────────────────────────────

export interface ThresholdBand {
  /** Minimum value for pass status. */
  pass: number;
  /** Minimum value for warn status. */
  warn: number;
  /** Minimum value for escalate status. Below this → block. */
  escalate: number;
}

export interface DimensionThresholds {
  coverage: ThresholdBand;
  freshness: ThresholdBand;
  mapping: ThresholdBand;
  conflict: ThresholdBand;
  graph: ThresholdBand;
}
