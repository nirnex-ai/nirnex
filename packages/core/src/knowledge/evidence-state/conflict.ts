/**
 * Evidence State — Intra-Evidence Conflict Detection
 *
 * Detects contradictions BETWEEN evidence items that claim incompatible things
 * about the same decision target.
 *
 * This is distinct from the structural conflict detection in /knowledge/conflict/:
 *   /knowledge/conflict/  — detects codebase/architecture conflicts (hub collisions,
 *                           circular deps, spec-code divergence, etc.)
 *   This module           — detects epistemic conflicts between evidence items
 *                           (two sources saying different things about the same claim)
 *
 * Decision target grouping:
 *   Evidence items with the same `ref` are considered about the same target.
 *   Contradiction detection runs within each ref group (size ≥ 2 required).
 *
 * Supported contradiction classes for v1 release:
 *   state      — present/enabled vs absent/disabled
 *   constraint — must/required vs optional/allowed
 *   behavior   — synchronous/blocking vs asynchronous/deferred
 *
 * Design constraints:
 *   - Pure function — no I/O, no randomness
 *   - Deterministic: group ordering is sorted before detection
 *   - Stays narrow: do not attempt broad semantic contradiction
 */

import type { ConflictGroup, ContradictionType } from './types.js';
import type { EvidenceItem } from '../conflict/types.js';

// ─── Contradiction patterns ───────────────────────────────────────────────────

const STATE_PRESENT = /\b(present|exists|exist|enabled|available|active|working|found|contains|includes)\b/i;
const STATE_ABSENT  = /\b(absent|missing|disabled|unavailable|inactive|removed|deleted)\b/i;

const CONSTRAINT_REQUIRED = /\b(must|required|mandatory|shall)\b/i;
const CONSTRAINT_OPTIONAL = /\b(optional|allowed|not required|can be skipped)\b/i;

const BEHAVIOR_SYNC  = /\b(synchronous|blocking)\b/i;
const BEHAVIOR_ASYNC = /\b(asynchronous|async|non-blocking|deferred)\b/i;

// ─── detectContradiction ──────────────────────────────────────────────────────

/**
 * Detect whether two content strings contain a structural contradiction.
 * Returns the contradiction type if found, null otherwise.
 *
 * The check is directional: A contradicts B OR B contradicts A.
 */
function detectContradiction(contentA: string, contentB: string): ContradictionType | null {
  const aPresent = STATE_PRESENT.test(contentA);
  const bPresent = STATE_PRESENT.test(contentB);
  const aAbsent  = STATE_ABSENT.test(contentA);
  const bAbsent  = STATE_ABSENT.test(contentB);
  if ((aPresent && bAbsent) || (aAbsent && bPresent)) return 'state';

  const aRequired = CONSTRAINT_REQUIRED.test(contentA);
  const bRequired = CONSTRAINT_REQUIRED.test(contentB);
  const aOptional = CONSTRAINT_OPTIONAL.test(contentA);
  const bOptional = CONSTRAINT_OPTIONAL.test(contentB);
  if ((aRequired && bOptional) || (aOptional && bRequired)) return 'constraint';

  const aSync  = BEHAVIOR_SYNC.test(contentA);
  const bSync  = BEHAVIOR_SYNC.test(contentB);
  const aAsync = BEHAVIOR_ASYNC.test(contentA);
  const bAsync = BEHAVIOR_ASYNC.test(contentB);
  if ((aSync && bAsync) || (aAsync && bSync)) return 'behavior';

  return null;
}

// ─── evidenceId ───────────────────────────────────────────────────────────────

function evidenceId(item: EvidenceItem): string {
  return `${item.source}:${item.ref}`;
}

// ─── EvidenceConflictDetectionResult ─────────────────────────────────────────

export interface EvidenceConflictDetectionResult {
  conflictGroups: ConflictGroup[];
  severity: 'low' | 'medium' | 'high' | null;
}

// ─── detectIntraEvidenceConflict ──────────────────────────────────────────────

/**
 * Group evidence items by ref, then detect structural contradictions within each group.
 *
 * @param evidenceItems - all available evidence items
 * @returns             detected conflict groups and aggregate severity
 */
export function detectIntraEvidenceConflict(params: {
  evidenceItems: EvidenceItem[];
}): EvidenceConflictDetectionResult {
  const { evidenceItems } = params;

  // Group items by ref — same ref = same decision target
  const groups = new Map<string, EvidenceItem[]>();
  for (const item of evidenceItems) {
    if (!groups.has(item.ref)) groups.set(item.ref, []);
    groups.get(item.ref)!.push(item);
  }

  const conflictGroups: ConflictGroup[] = [];

  // Sort group keys for determinism
  const sortedRefs = [...groups.keys()].sort();

  for (const ref of sortedRefs) {
    const items = groups.get(ref)!;
    if (items.length < 2) continue;

    // Sort items within group for determinism (by evidenceId)
    const sortedItems = [...items].sort((a, b) => evidenceId(a).localeCompare(evidenceId(b)));

    // Check all pairs within the group
    const seenTypes = new Set<ContradictionType>();
    for (let i = 0; i < sortedItems.length; i++) {
      for (let j = i + 1; j < sortedItems.length; j++) {
        const contradictionType = detectContradiction(
          sortedItems[i].content,
          sortedItems[j].content,
        );
        if (contradictionType !== null && !seenTypes.has(contradictionType)) {
          seenTypes.add(contradictionType);
          conflictGroups.push({
            target_id: ref,
            evidence_ids: [evidenceId(sortedItems[i]), evidenceId(sortedItems[j])],
            contradiction_type: contradictionType,
            severity: 'low', // updated below based on total count
            dominant_sources: [...new Set([sortedItems[i].source, sortedItems[j].source])].sort(),
          });
        }
      }
    }
  }

  if (conflictGroups.length === 0) {
    return { conflictGroups: [], severity: null };
  }

  // Aggregate severity: 1 group=low, 2=medium, 3+=high
  const severity: 'low' | 'medium' | 'high' =
    conflictGroups.length >= 3 ? 'high'   :
    conflictGroups.length >= 2 ? 'medium' : 'low';

  // Stamp each group with the aggregate severity
  const stampedGroups = conflictGroups.map(g => ({ ...g, severity }));

  return { conflictGroups: stampedGroups, severity };
}
