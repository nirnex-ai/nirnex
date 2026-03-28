/**
 * Runtime Reporting — Failure Taxonomy
 *
 * Stable registry of all failure codes, classes, severity, and attributes.
 * Every runtime failure must map to one of these codes.
 * Unknown failures map to UNCLASSIFIED_FAILURE — never silently dropped.
 *
 * Design constraints:
 *   - Taxonomy is the source of truth for failure classification
 *   - Top-level classes are stable — only add subcodes as runtime produces distinct patterns
 *   - recoverability and determinism are defaults — runtime can override per-instance
 */

import { FailureClass, FailureSeverity } from './types.js';

export interface TaxonomyEntry {
  code: string;
  label: string;
  class: FailureClass;
  default_severity: FailureSeverity;
  default_blocking: boolean;
  recoverability: 'automatic' | 'manual' | 'none' | 'unknown';
  determinism: 'deterministic' | 'environmental' | 'unknown';
  description: string;
}

export const FAILURE_TAXONOMY: Record<string, TaxonomyEntry> = {

  // ─── Input failures ─────────────────────────────────────────────────────────

  INPUT_INVALID: {
    code: 'INPUT_INVALID',
    label: 'Invalid Input',
    class: 'input',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Input spec or query does not conform to accepted shape',
  },
  INPUT_INCOMPLETE: {
    code: 'INPUT_INCOMPLETE',
    label: 'Incomplete Input',
    class: 'input',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Required fields missing from input',
  },
  INPUT_AMBIGUOUS: {
    code: 'INPUT_AMBIGUOUS',
    label: 'Ambiguous Input',
    class: 'input',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Input intent is ambiguous beyond allowed contract',
  },
  INPUT_UNSUPPORTED: {
    code: 'INPUT_UNSUPPORTED',
    label: 'Unsupported Input',
    class: 'input',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'none',
    determinism: 'deterministic',
    description: 'Unsupported input type or composite intent count exceeded',
  },

  // ─── Intent/scope failures ──────────────────────────────────────────────────

  INTENT_OVERBOUND: {
    code: 'INTENT_OVERBOUND',
    label: 'Intent Overbound',
    class: 'intent_scope',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Too many intents detected',
  },
  INTENT_CONFLICT: {
    code: 'INTENT_CONFLICT',
    label: 'Intent Conflict',
    class: 'intent_scope',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Conflicting intents detected',
  },
  SCOPE_UNBOUND: {
    code: 'SCOPE_UNBOUND',
    label: 'Scope Unbound',
    class: 'intent_scope',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Scope could not be deterministically bound',
  },
  SCOPE_EXPANSION_UNSAFE: {
    code: 'SCOPE_EXPANSION_UNSAFE',
    label: 'Unsafe Scope Expansion',
    class: 'intent_scope',
    default_severity: 'critical',
    default_blocking: true,
    recoverability: 'none',
    determinism: 'deterministic',
    description: 'Unsafe scope expansion detected',
  },

  // ─── Evidence failures ──────────────────────────────────────────────────────

  EVIDENCE_ABSENT: {
    code: 'EVIDENCE_ABSENT',
    label: 'Evidence Absent',
    class: 'evidence',
    default_severity: 'error',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'No evidence found for required scope',
  },
  EVIDENCE_CONFLICT: {
    code: 'EVIDENCE_CONFLICT',
    label: 'Evidence Conflict',
    class: 'evidence',
    default_severity: 'error',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Conflicting evidence from multiple sources',
  },
  EVIDENCE_STALE_RELEVANT: {
    code: 'EVIDENCE_STALE_RELEVANT',
    label: 'Stale Relevant Evidence',
    class: 'evidence',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'deterministic',
    description: 'Stale evidence is relevant to scope',
  },
  EVIDENCE_GRAPH_INCOMPLETE: {
    code: 'EVIDENCE_GRAPH_INCOMPLETE',
    label: 'Evidence Graph Incomplete',
    class: 'evidence',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Dependency graph incomplete for required path',
  },
  EVIDENCE_MAPPING_WEAK: {
    code: 'EVIDENCE_MAPPING_WEAK',
    label: 'Weak Evidence Mapping',
    class: 'evidence',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Mapping quality below threshold',
  },

  // ─── Policy failures ────────────────────────────────────────────────────────

  POLICY_CONFIDENCE_BLOCK: {
    code: 'POLICY_CONFIDENCE_BLOCK',
    label: 'Confidence Block',
    class: 'policy',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Confidence below lane threshold',
  },
  POLICY_EVIDENCE_BLOCK: {
    code: 'POLICY_EVIDENCE_BLOCK',
    label: 'Evidence Block',
    class: 'policy',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Evidence sufficiency gate failed',
  },
  POLICY_PATH_BLOCK: {
    code: 'POLICY_PATH_BLOCK',
    label: 'Forbidden Path Block',
    class: 'policy',
    default_severity: 'critical',
    default_blocking: true,
    recoverability: 'none',
    determinism: 'deterministic',
    description: 'Forbidden path touched',
  },
  POLICY_OVERRIDE_REQUIRED: {
    code: 'POLICY_OVERRIDE_REQUIRED',
    label: 'Override Required',
    class: 'policy',
    default_severity: 'warning',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Override required but not supplied',
  },

  // ─── Orchestration failures ─────────────────────────────────────────────────

  ORCH_STAGE_TIMEOUT: {
    code: 'ORCH_STAGE_TIMEOUT',
    label: 'Stage Timeout',
    class: 'orchestration',
    default_severity: 'error',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Stage exceeded timeout budget',
  },
  ORCH_INVALID_OUTPUT: {
    code: 'ORCH_INVALID_OUTPUT',
    label: 'Invalid Stage Output',
    class: 'orchestration',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'none',
    determinism: 'deterministic',
    description: 'Stage emitted invalid output',
  },
  ORCH_INVALID_TRANSITION: {
    code: 'ORCH_INVALID_TRANSITION',
    label: 'Invalid Stage Transition',
    class: 'orchestration',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'none',
    determinism: 'deterministic',
    description: 'Invalid stage transition',
  },
  ORCH_DEPENDENCY_MISSING: {
    code: 'ORCH_DEPENDENCY_MISSING',
    label: 'Dependency Missing',
    class: 'orchestration',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Missing downstream dependency',
  },

  // ─── Tooling failures ───────────────────────────────────────────────────────

  TOOL_PARSER_FAIL: {
    code: 'TOOL_PARSER_FAIL',
    label: 'Parser Failure',
    class: 'tooling',
    default_severity: 'error',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Parser crashed or returned error',
  },
  TOOL_LSP_UNAVAILABLE: {
    code: 'TOOL_LSP_UNAVAILABLE',
    label: 'LSP Unavailable',
    class: 'tooling',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Language server unavailable',
  },
  TOOL_DB_UNAVAILABLE: {
    code: 'TOOL_DB_UNAVAILABLE',
    label: 'Database Unavailable',
    class: 'tooling',
    default_severity: 'error',
    default_blocking: true,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Database unavailable',
  },
  TOOL_FS_ERROR: {
    code: 'TOOL_FS_ERROR',
    label: 'Filesystem Error',
    class: 'tooling',
    default_severity: 'error',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Filesystem read or write failure',
  },
  TOOL_HOOK_FAIL: {
    code: 'TOOL_HOOK_FAIL',
    label: 'Hook Failure',
    class: 'tooling',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Hook execution failed',
  },

  // ─── Data integrity failures ────────────────────────────────────────────────

  DATA_TRACE_LEDGER_MISMATCH: {
    code: 'DATA_TRACE_LEDGER_MISMATCH',
    label: 'Trace/Ledger Mismatch',
    class: 'data_integrity',
    default_severity: 'error',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Trace and ledger records are inconsistent',
  },
  DATA_STAGE_GAP: {
    code: 'DATA_STAGE_GAP',
    label: 'Stage Record Gap',
    class: 'data_integrity',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Missing stage record in expected sequence',
  },
  DATA_CONFIDENCE_INCONSISTENT: {
    code: 'DATA_CONFIDENCE_INCONSISTENT',
    label: 'Confidence Inconsistency',
    class: 'data_integrity',
    default_severity: 'error',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Confidence breakdown inconsistent with applied penalties',
  },
  DATA_SNAPSHOT_INCOMPLETE: {
    code: 'DATA_SNAPSHOT_INCOMPLETE',
    label: 'Snapshot Incomplete',
    class: 'data_integrity',
    default_severity: 'error',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Report snapshot is incomplete',
  },

  // ─── Performance signals ────────────────────────────────────────────────────

  PERF_STAGE_SLOW: {
    code: 'PERF_STAGE_SLOW',
    label: 'Slow Stage',
    class: 'performance',
    default_severity: 'info',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Stage duration exceeded threshold',
  },
  PERF_RETRY_EXCESS: {
    code: 'PERF_RETRY_EXCESS',
    label: 'Excessive Retries',
    class: 'performance',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Excessive retries detected',
  },
  PERF_EVENT_LAG: {
    code: 'PERF_EVENT_LAG',
    label: 'Event Processing Lag',
    class: 'performance',
    default_severity: 'info',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'High event processing lag',
  },
  PERF_REPORT_SLOW: {
    code: 'PERF_REPORT_SLOW',
    label: 'Slow Report Generation',
    class: 'performance',
    default_severity: 'info',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Report generation exceeded threshold',
  },
  PERF_PARSE_HEAVY: {
    code: 'PERF_PARSE_HEAVY',
    label: 'Heavy Parse Cost',
    class: 'performance',
    default_severity: 'info',
    default_blocking: false,
    recoverability: 'automatic',
    determinism: 'environmental',
    description: 'Excessive parse cost',
  },

  // ─── Outcome quality ────────────────────────────────────────────────────────

  QUALITY_LOW_CONFIDENCE_SUCCESS: {
    code: 'QUALITY_LOW_CONFIDENCE_SUCCESS',
    label: 'Low Confidence Success',
    class: 'outcome_quality',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Execution succeeded with low confidence',
  },
  QUALITY_CRITICAL_WARNING_SUCCESS: {
    code: 'QUALITY_CRITICAL_WARNING_SUCCESS',
    label: 'Critical Warning on Success',
    class: 'outcome_quality',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Success with warnings on critical dimensions',
  },
  QUALITY_OVERRIDE_DEPENDENT: {
    code: 'QUALITY_OVERRIDE_DEPENDENT',
    label: 'Override Dependent',
    class: 'outcome_quality',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Output accepted only due to override',
  },
  QUALITY_PARTIAL_SUCCESS: {
    code: 'QUALITY_PARTIAL_SUCCESS',
    label: 'Partial Success',
    class: 'outcome_quality',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'manual',
    determinism: 'deterministic',
    description: 'Incomplete result surface',
  },

  // ─── Fallback ───────────────────────────────────────────────────────────────

  UNCLASSIFIED_FAILURE: {
    code: 'UNCLASSIFIED_FAILURE',
    label: 'Unclassified Failure',
    class: 'data_integrity',
    default_severity: 'warning',
    default_blocking: false,
    recoverability: 'unknown',
    determinism: 'unknown',
    description: 'Failure does not map to a known taxonomy code',
  },
};

/**
 * Returns the taxonomy entry for the given code.
 * If the code is not found, returns the UNCLASSIFIED_FAILURE entry.
 */
export function lookupFailureCode(code: string): TaxonomyEntry {
  return FAILURE_TAXONOMY[code] ?? FAILURE_TAXONOMY['UNCLASSIFIED_FAILURE'];
}

/**
 * Returns all registered failure codes as an array.
 */
export function getAllFailureCodes(): string[] {
  return Object.keys(FAILURE_TAXONOMY);
}
