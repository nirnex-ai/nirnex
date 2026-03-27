/**
 * Evidence State — Classifier
 *
 * Deterministic classification step that runs BEFORE confidence scoring.
 * Produces a first-class EvidenceState that the policy engine consumes directly.
 *
 * Stage order:
 *   1. retrieve evidence  (caller's responsibility — all I/O done before here)
 *   2. detectAbsence      — check which required targets lack coverage
 *   3. detectIntraEvidenceConflict — check for intra-evidence contradictions
 *   4. classifyEvidenceState → returns EvidenceState discriminated union
 *   5. buildEvidenceAssessment → derives structured availability + conflict summaries
 *
 * Design constraints:
 *   - Pure functions — no I/O, no side effects
 *   - Deterministic: same inputs always produce the same state
 *   - Absence and conflict are computed independently (never merged into one penalty)
 */

import type {
  EvidenceState,
  EvidenceAssessment,
  EvidenceAvailability,
  EvidenceConflictSummary,
} from './types.js';
import { detectAbsence } from './absence.js';
import { detectIntraEvidenceConflict } from './conflict.js';
import type { EvidenceItem } from '../conflict/types.js';

// ─── classifyEvidenceState ────────────────────────────────────────────────────

/**
 * Classify the epistemic state of evidence for a given intent and scope.
 *
 * @param evidenceItems   - all available evidence items
 * @param requiredTargets - targets the intent requires (e.g. ['source:code', 'scope:auth'])
 * @param intent          - the detected primary intent (informational, not used in logic)
 * @returns               classified EvidenceState discriminated union
 */
export function classifyEvidenceState(params: {
  evidenceItems: EvidenceItem[];
  requiredTargets: string[];
  intent: string;
}): EvidenceState {
  const { evidenceItems, requiredTargets } = params;

  // ── Step 1: Detect absence ───────────────────────────────────────────────
  const absenceResult = detectAbsence({ requiredTargets, evidenceItems });
  const hasMissing = absenceResult.missingTargets.length > 0;

  // ── Step 2: Detect intra-evidence conflicts ──────────────────────────────
  const conflictResult = detectIntraEvidenceConflict({ evidenceItems });
  const hasConflicts = conflictResult.conflictGroups.length > 0;

  // ── Step 3: Classify into discriminated union ────────────────────────────
  if (hasMissing && hasConflicts) {
    return {
      kind: 'mixed',
      missing_required_targets: absenceResult.missingTargets,
      conflict_groups: conflictResult.conflictGroups,
      severity: conflictResult.severity!,
    };
  }

  if (hasMissing) {
    return {
      kind: 'absent',
      missing_required_targets: absenceResult.missingTargets,
      searched_sources: absenceResult.searchedSources,
      reason: absenceResult.reason,
    };
  }

  if (hasConflicts) {
    return {
      kind: 'conflicted',
      conflict_groups: conflictResult.conflictGroups,
      severity: conflictResult.severity!,
    };
  }

  return {
    kind: 'sufficient',
    supporting_count: evidenceItems.length,
    conflicting_count: 0,
  };
}

// ─── buildEvidenceAssessment ──────────────────────────────────────────────────

/**
 * Derive the structured EvidenceAssessment from a classified EvidenceState.
 *
 * Availability and conflict are derived independently — neither is collapsed
 * into the other.
 *
 * @param state - the classified EvidenceState
 * @returns     structured assessment with independent availability + conflict sections
 */
export function buildEvidenceAssessment(state: EvidenceState): EvidenceAssessment {
  // ── Availability ──────────────────────────────────────────────────────────
  const missingTargets: string[] =
    (state.kind === 'absent' || state.kind === 'mixed')
      ? state.missing_required_targets
      : [];

  const availabilityStatus: EvidenceAvailability['status'] =
    state.kind === 'absent'  ? 'absent'    :
    state.kind === 'mixed'   ? 'partial'   :
    'sufficient';

  const availability: EvidenceAvailability = {
    status: availabilityStatus,
    missing_targets: missingTargets,
  };

  // ── Conflict summary ──────────────────────────────────────────────────────
  const conflictGroups =
    (state.kind === 'conflicted' || state.kind === 'mixed')
      ? state.conflict_groups
      : [];

  const conflictSeverity =
    (state.kind === 'conflicted' || state.kind === 'mixed')
      ? state.severity
      : null;

  const conflictSummary: EvidenceConflictSummary = {
    status:   conflictGroups.length > 0 ? 'present' : 'none',
    groups:   conflictGroups,
    severity: conflictSeverity,
  };

  return { state, availability, conflict: conflictSummary };
}
