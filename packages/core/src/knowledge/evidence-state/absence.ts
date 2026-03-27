/**
 * Evidence State — Absence Detection
 *
 * Detects which required evidence targets have no qualifying evidence items.
 *
 * Required target format:
 *   'source:X'  — covered if any evidence item has source === X
 *   'scope:X'   — covered if any evidence item's ref contains X (substring match)
 *
 * A target is considered absent only when zero qualifying items map to it.
 * Weak evidence still counts — do not treat low-quality evidence as absence.
 *
 * Design constraints:
 *   - Pure function — no I/O
 *   - Deterministic: same inputs always produce same output
 */

import type { EvidenceAbsenceReason } from './types.js';
import type { EvidenceItem } from '../conflict/types.js';

// ─── AbsenceDetectionResult ───────────────────────────────────────────────────

export interface AbsenceDetectionResult {
  /** Required targets that had no qualifying evidence item. */
  missingTargets: string[];
  /** Source types that were actually present (searched). */
  searchedSources: string[];
  /** Structural reason for the absence. */
  reason: EvidenceAbsenceReason;
}

// ─── detectAbsence ────────────────────────────────────────────────────────────

/**
 * For each required target, check whether any evidence item qualifies for it.
 *
 * @param requiredTargets - targets the intent requires coverage of
 * @param evidenceItems   - all available evidence items
 * @returns               absent targets, searched sources, and reason
 */
export function detectAbsence(params: {
  requiredTargets: string[];
  evidenceItems: EvidenceItem[];
}): AbsenceDetectionResult {
  const { requiredTargets, evidenceItems } = params;

  const searchedSources: string[] = [...new Set(evidenceItems.map(e => e.source))].sort();
  const missingTargets: string[] = [];

  for (const target of requiredTargets) {
    const colonIdx = target.indexOf(':');
    if (colonIdx === -1) continue;
    const kind  = target.slice(0, colonIdx);
    const value = target.slice(colonIdx + 1);

    let covered = false;
    if (kind === 'source') {
      covered = evidenceItems.some(e => e.source === value);
    } else if (kind === 'scope') {
      covered = evidenceItems.some(e => e.ref.includes(value));
    }

    if (!covered) {
      missingTargets.push(target);
    }
  }

  // Reason: if there are no evidence items at all → not_found
  // If items exist but none covered the target → out_of_scope
  const reason: EvidenceAbsenceReason =
    evidenceItems.length === 0 ? 'not_found' : 'out_of_scope';

  return { missingTargets, searchedSources, reason };
}
