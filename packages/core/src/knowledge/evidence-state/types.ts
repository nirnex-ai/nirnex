/**
 * Evidence State — Types
 *
 * First-class distinction between two fundamentally different epistemic failures:
 *
 *   absent     — required evidence for an intent/scope was not found
 *   conflicted — evidence was found but makes incompatible claims about the same target
 *   mixed      — both: some targets have no evidence AND other targets have contradictions
 *   sufficient — evidence is present and internally consistent
 *
 * These are NOT the same failure mode:
 *   - Absence means the Knowledge Layer is incomplete, weak, stale, or out of scope.
 *   - Conflict means the Knowledge Layer is populated but internally inconsistent.
 *
 * They produce different ECO signals, policy behavior, lane escalation, and ledger records.
 */

// ─── Contradiction types ──────────────────────────────────────────────────────

/**
 * Structural contradiction classes for release.
 * Stays narrow — broad semantic contradiction is out of scope for v1.
 *
 *   state      — one source says feature exists/active; another says it is absent/disabled
 *   constraint — one says must/required; another says optional/allowed
 *   behavior   — one says synchronous/blocking; another says asynchronous/deferred
 *   location   — one maps implementation to scope A; another to incompatible scope B (reserved)
 */
export type ContradictionType = 'state' | 'constraint' | 'behavior' | 'location';

// ─── Conflict group ───────────────────────────────────────────────────────────

/**
 * A set of evidence items that assert mutually incompatible claims about the same target.
 */
export interface ConflictGroup {
  /** Stable target identifier (usually evidence ref). */
  target_id: string;
  /** Composite IDs of the conflicting evidence items: '{source}:{ref}'. */
  evidence_ids: string[];
  /** The structural class of the contradiction detected. */
  contradiction_type: ContradictionType;
  /** Severity of this particular contradiction group. */
  severity: 'low' | 'medium' | 'high';
  /** Source types of the items in conflict. */
  dominant_sources: string[];
}

// ─── Absence reason ───────────────────────────────────────────────────────────

export type EvidenceAbsenceReason =
  | 'not_found'   // retrieval returned nothing
  | 'out_of_scope' // items exist but no matching source type for the target
  | 'stale'        // evidence exists but below freshness threshold (future)
  | 'unindexed';   // scope not yet indexed (future)

// ─── EvidenceState ────────────────────────────────────────────────────────────

/**
 * The classified epistemic state of the evidence for a given intent + scope.
 *
 * Produced by classifyEvidenceState() BEFORE confidence scoring starts.
 * Policy must read this directly — not infer it from a collapsed score.
 */
export type EvidenceState =
  | {
      kind: 'sufficient';
      /** Count of evidence items supporting the assessment. */
      supporting_count: number;
      /** Count of evidence items that were detected as conflicting (0 when sufficient). */
      conflicting_count: number;
    }
  | {
      kind: 'absent';
      /** Required targets that had zero qualifying evidence items. */
      missing_required_targets: string[];
      /** Source types that were searched (from available evidence). */
      searched_sources: string[];
      /** Why the system considers the evidence absent. */
      reason: EvidenceAbsenceReason;
    }
  | {
      kind: 'conflicted';
      /** Groups of evidence items making incompatible claims about the same target. */
      conflict_groups: ConflictGroup[];
      /** Aggregate severity across all conflict groups. */
      severity: 'low' | 'medium' | 'high';
    }
  | {
      kind: 'mixed';
      /** Required targets with no qualifying evidence. */
      missing_required_targets: string[];
      /** Groups of evidence items making incompatible claims. */
      conflict_groups: ConflictGroup[];
      /** Aggregate severity of the conflicts present. */
      severity: 'low' | 'medium' | 'high';
    };

// ─── EvidenceAssessment ───────────────────────────────────────────────────────

/**
 * Structured availability and conflict summary exposed on the ECO output.
 * Consumers (policy engine, operators, ledger) read this directly — not the score.
 */
export interface EvidenceAvailability {
  /** Overall availability status. */
  status: 'sufficient' | 'partial' | 'absent';
  /** Required targets that were not covered by any qualifying evidence. */
  missing_targets: string[];
}

export interface EvidenceConflictSummary {
  /** Whether any intra-evidence contradictions were detected. */
  status: 'none' | 'present';
  /** All detected conflict groups. Empty array when status='none'. */
  groups: ConflictGroup[];
  /** Aggregate severity. Null when status='none'. */
  severity: 'low' | 'medium' | 'high' | null;
}

export interface EvidenceAssessment {
  /** The raw classified state — the primary output of the classifier. */
  state: EvidenceState;
  /** Structured availability summary (derived from state). */
  availability: EvidenceAvailability;
  /** Structured conflict summary (derived from state). */
  conflict: EvidenceConflictSummary;
}

// ─── Audit events ─────────────────────────────────────────────────────────────

export type EvidenceStateEventKind =
  | 'evidence_absence_detected'
  | 'evidence_conflict_detected'
  | 'evidence_state_classified';

export interface EvidenceStateEvent {
  kind: EvidenceStateEventKind;
  timestamp: string;
  payload: Record<string, unknown>;
}
