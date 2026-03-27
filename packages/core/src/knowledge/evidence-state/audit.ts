/**
 * Evidence State — Audit Events
 *
 * Produces structured audit events from an EvidenceAssessment.
 * These are recorded on the ECO output as eco.evidence_state_events[].
 *
 * Event types (distinct from ConflictLedgerEvent in /conflict/):
 *   evidence_absence_detected    — one or more required targets had no evidence
 *   evidence_conflict_detected   — intra-evidence contradictions were found
 *   evidence_state_classified    — always emitted; records the final state kind
 *
 * Why separate from ConflictLedgerEvent:
 *   ConflictLedgerEvent records codebase/architecture conflicts.
 *   EvidenceStateEvent records epistemic classification of the evidence corpus.
 *   They are orthogonal failure modes and must remain separately queryable.
 *
 * Design constraints:
 *   - Pure function — no I/O
 *   - Always emits evidence_state_classified (makes the state auditable even for 'sufficient')
 *   - Events are ordered: absence → conflict → classified
 */

import type { EvidenceAssessment, EvidenceStateEvent } from './types.js';

// ─── buildEvidenceStateEvents ─────────────────────────────────────────────────

/**
 * Build the ordered set of audit events for a given EvidenceAssessment.
 *
 * @param assessment - the structured evidence assessment
 * @returns          ordered array of audit events with ISO 8601 timestamps
 */
export function buildEvidenceStateEvents(
  assessment: EvidenceAssessment,
): EvidenceStateEvent[] {
  const events: EvidenceStateEvent[] = [];
  const now = new Date().toISOString();

  // ── Absence event ──────────────────────────────────────────────────────
  if (assessment.availability.status === 'absent' ||
      assessment.availability.status === 'partial') {
    events.push({
      kind:      'evidence_absence_detected',
      timestamp: now,
      payload: {
        missing_targets: assessment.availability.missing_targets,
        availability_status: assessment.availability.status,
        state_kind: assessment.state.kind,
        ...(assessment.state.kind === 'absent' ? {
          reason: assessment.state.reason,
          searched_sources: assessment.state.searched_sources,
        } : {}),
      },
    });
  }

  // ── Conflict event ─────────────────────────────────────────────────────
  if (assessment.conflict.status === 'present') {
    events.push({
      kind:      'evidence_conflict_detected',
      timestamp: now,
      payload: {
        conflict_groups:    assessment.conflict.groups,
        severity:           assessment.conflict.severity,
        group_count:        assessment.conflict.groups.length,
        contradiction_types: [...new Set(
          assessment.conflict.groups.map(g => g.contradiction_type)
        )].sort(),
      },
    });
  }

  // ── State-classified event (always emitted) ────────────────────────────
  events.push({
    kind:      'evidence_state_classified',
    timestamp: now,
    payload: {
      state_kind:          assessment.state.kind,
      availability_status: assessment.availability.status,
      conflict_status:     assessment.conflict.status,
    },
  });

  return events;
}
