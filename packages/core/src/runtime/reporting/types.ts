/**
 * Runtime Reporting — Canonical Types
 *
 * Defines the data model for the non-blocking Report System.
 * All types are read-only relative to execution.
 *
 * Design constraints:
 *   - RunEvidenceBundle is the canonical output — JSON-first
 *   - ReportEvent normalizes LedgerEntry for reporting domain
 *   - All rendering derives from RunEvidenceBundle, never the reverse
 *   - Validation issues are visible in the bundle, never silently suppressed
 */

// ─── Schema version ───────────────────────────────────────────────────────────

export const REPORT_SCHEMA_VERSION = '1.0.0' as const;

// ─── Primitive enumerations ───────────────────────────────────────────────────

export type FailureSeverity = 'info' | 'warning' | 'error' | 'critical';

export type FailureClass =
  | 'input'
  | 'intent_scope'
  | 'evidence'
  | 'policy'
  | 'orchestration'
  | 'tooling'
  | 'data_integrity'
  | 'performance'
  | 'outcome_quality';

export type CausalRelationship =
  | 'triggered'
  | 'contributed_to'
  | 'blocked'
  | 'downgraded'
  | 'escalated'
  | 'masked'
  | 'overridden_by'
  | 'derived_from';

// ─── ReportEvent ──────────────────────────────────────────────────────────────

/**
 * Normalized event shape derived from LedgerEntry.
 * All reporting logic operates on ReportEvent, never raw LedgerEntry.
 */
export type ReportEvent = {
  /** ledger_id from the originating LedgerEntry */
  event_id: string;
  /** trace_id from the originating LedgerEntry */
  run_id: string;
  /** LedgerStage of the originating entry */
  stage: string;
  timestamp: string;
  /** record_type from the originating LedgerEntry */
  kind: string;
  /** code extracted from payload (decision_code, refusal_code, etc.) */
  code?: string;
  severity?: FailureSeverity;
  blocking?: boolean;
  payload: Record<string, unknown>;
  /**
   * parent_ledger_id + derived_from_entry_ids, deduplicated.
   * Encodes causal ancestry for graph construction.
   */
  causes: string[];
};

// ─── StageRecord ──────────────────────────────────────────────────────────────

export type StageRecord = {
  stage_id: string;
  display_name: string;
  status: 'ok' | 'blocked' | 'escalated' | 'degraded' | 'skipped' | 'timeout';
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  failure_count: number;
  warning_count: number;
  failures: FailureRecord[];
  warnings: FailureRecord[];
  /** Short summary of stage output for display */
  key_output?: string;
};

// ─── FailureRecord ────────────────────────────────────────────────────────────

export type FailureRecord = {
  failure_id: string;
  /** from FAILURE_TAXONOMY */
  code: string;
  class: FailureClass;
  /** Human-readable label */
  label: string;
  severity: FailureSeverity;
  blocking: boolean;
  recoverability: 'automatic' | 'manual' | 'none' | 'unknown';
  determinism: 'deterministic' | 'environmental' | 'unknown';
  stage?: string;
  message: string;
  payload?: Record<string, unknown>;
  cause_event_ids: string[];
  source_event_id: string;
};

// ─── Causal graph ─────────────────────────────────────────────────────────────

export type CausalNode = {
  /** Equals event_id of the originating ReportEvent */
  node_id: string;
  kind: 'observation' | 'decision' | 'penalty' | 'failure' | 'transition' | 'outcome';
  code?: string;
  label: string;
  stage: string;
  timestamp: string;
};

export type CausalEdge = {
  from_node_id: string;
  to_node_id: string;
  relationship: CausalRelationship;
};

export type CausalChain = {
  chain_id: string;
  root_node_id: string;
  terminal_node_id: string;
  /** Ordered from root to terminal */
  node_ids: string[];
  edges: CausalEdge[];
  is_primary: boolean;
};

export type CausalGraph = {
  nodes: CausalNode[];
  edges: CausalEdge[];
  primary_chains: CausalChain[];
  secondary_chains: CausalChain[];
};

// ─── Confidence ───────────────────────────────────────────────────────────────

export type ConfidenceCheckpoint = {
  trigger: string;
  snapshot_index: number;
  computed_confidence: number;
  effective_confidence: number;
  band: string;
  stage_name: string;
  delta?: number;
  delta_reasons?: string[];
};

export type ConfidencePenalty = {
  dimension: string;
  previous_confidence?: number;
  delta: number;
  reason: string;
};

export type ConfidenceReportSnapshot = {
  overall_confidence: number;
  effective_confidence: number;
  band: string;
  lane?: string;
  dimensions: Record<string, number | 'uncomputed'>;
  penalties: ConfidencePenalty[];
  checkpoints: ConfidenceCheckpoint[];
};

// ─── Knowledge health ─────────────────────────────────────────────────────────

export type EvidenceItem = {
  id: string;
  description: string;
  dimension?: string;
  scope?: string;
  reason_codes?: string[];
};

export type KnowledgeHealthSnapshot = {
  absent_evidence: EvidenceItem[];
  conflicting_evidence: EvidenceItem[];
  stale_evidence: EvidenceItem[];
  weak_evidence: EvidenceItem[];
  dimension_scores: Record<string, number>;
  dimension_statuses: Record<string, string>;
};

// ─── Optimisation hints ───────────────────────────────────────────────────────

export type OptimisationHint = {
  hint_id: string;
  rule_id: string;
  observation: string;
  evidence_basis: string;
  hint_confidence: 'low' | 'medium' | 'high';
  subsystem: string;
  supporting_event_ids: string[];
};

// ─── Comparison / delta ───────────────────────────────────────────────────────

export type Delta<T> = {
  baseline: T;
  current: T;
  direction: 'improved' | 'degraded' | 'unchanged' | 'changed';
};

export type RunComparison = {
  baseline_run_id: string;
  current_run_id: string;
  generated_at: string;
  deltas: {
    duration_ms?: Delta<number>;
    confidence?: Delta<number>;
    failure_count?: Delta<number>;
    lane?: Delta<string>;
    override_count?: Delta<number>;
  };
  regression_findings: string[];
};

// ─── Validation ───────────────────────────────────────────────────────────────

export type ReportValidationIssue = {
  kind:
    | 'missing_stage'
    | 'broken_causal_ref'
    | 'unclassified_failure'
    | 'missing_outcome'
    | 'confidence_inconsistent'
    | 'timestamp_out_of_order'
    | 'data_snapshot_incomplete';
  severity: 'warning' | 'error';
  message: string;
  affected_id?: string;
};

export type ReportIntegrityResult = {
  valid: boolean;
  issues: ReportValidationIssue[];
  missing_stages: string[];
  broken_causal_refs: string[];
  unclassified_failure_codes: string[];
};

// ─── Run summary ──────────────────────────────────────────────────────────────

export type RunSummary = {
  run_id: string;
  request_id: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  lane?: string;
  input_ref?: string;
  final_status: 'success' | 'refused' | 'blocked' | 'escalated' | 'abandoned' | 'incomplete';
  stop_condition?: string;
  report_integrity_status: 'valid' | 'degraded' | 'failed';
};

// ─── RunEvidenceBundle — canonical output ─────────────────────────────────────

/**
 * The canonical output of the Report System.
 * All rendering derives from RunEvidenceBundle. Never the reverse.
 * JSON-serialisable at all times.
 */
export type RunEvidenceBundle = {
  bundle_id: string;
  /** Always REPORT_SCHEMA_VERSION ('1.0.0') */
  schema_version: string;
  run_id: string;
  request_id: string;
  generated_at: string;

  summary: RunSummary;
  stages: StageRecord[];
  failures: FailureRecord[];
  causal_graph: CausalGraph;
  confidence: ConfidenceReportSnapshot;
  knowledge_health: KnowledgeHealthSnapshot;
  optimisation_hints: OptimisationHint[];
  raw_events: ReportEvent[];

  integrity: ReportIntegrityResult;
  comparison?: RunComparison;
};
