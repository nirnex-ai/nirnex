/**
 * Evidence State — Public API
 *
 * First-class distinction between absence of evidence and conflicting evidence.
 * These are different epistemic failures that require different policy responses.
 */

export { classifyEvidenceState, buildEvidenceAssessment } from './classify.js';
export { applyEvidenceStatePolicy } from './policy.js';
export { buildEvidenceStateEvents } from './audit.js';
export { detectAbsence } from './absence.js';
export { detectIntraEvidenceConflict } from './conflict.js';

export type {
  EvidenceState,
  EvidenceAssessment,
  EvidenceAvailability,
  EvidenceConflictSummary,
  ConflictGroup,
  ContradictionType,
  EvidenceAbsenceReason,
  EvidenceStateEvent,
  EvidenceStateEventKind,
} from './types.js';
