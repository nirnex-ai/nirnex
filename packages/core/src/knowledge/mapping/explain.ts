/**
 * Mapping Quality — Reason Generation
 *
 * Converts a MappingQualityResult (partial — score/level/hard_block/breakdown)
 * into a list of human-readable, specific reason strings.
 *
 * Design constraints:
 *   - At least one reason is always returned (never empty)
 *   - Hard-block condition always contributes a reason first
 *   - Each weak sub-metric produces a targeted reason
 *   - Reasons are stable and machine-parseable (no random text)
 */

import type { MappingQualityResult } from './types.js';

type PartialResult = Pick<MappingQualityResult, 'score' | 'level' | 'hard_block' | 'breakdown' | 'reasons'>;

const SCOPE_THRESHOLD  = 70;
const COHERENCE_THRESHOLD = 70;
const CONCENTRATION_THRESHOLD = 55;
const INTENT_THRESHOLD = 60;

/**
 * Generate reason strings for the given (partially-built) MappingQualityResult.
 *
 * @param partial - result with score, level, hard_block, breakdown, and seed reasons
 * @returns       non-empty string[]
 */
export function generateMappingReasons(partial: PartialResult): string[] {
  const reasons: string[] = [...partial.reasons]; // start from seed (e.g., hard-block reason)
  const { score, level, breakdown } = partial;

  // ── Hard-block prefix ─────────────────────────────────────────────────────
  if (partial.hard_block && reasons.length === 0) {
    reasons.push(
      'Mapping quality hard-block: the system cannot identify a safe execution target for this request.',
    );
  }

  // ── Sub-metric specific reasons ───────────────────────────────────────────

  // Scope alignment
  if (breakdown.scope_alignment < SCOPE_THRESHOLD) {
    const pct = breakdown.scope_alignment.toFixed(0);
    if (breakdown.scope_alignment < 20) {
      reasons.push(
        `Scope alignment critical (${pct}/100): retrieved evidence is largely outside the requested scope.`,
      );
    } else {
      reasons.push(
        `Scope alignment weak (${pct}/100): less than ${SCOPE_THRESHOLD}% of candidates land in the requested scope.`,
      );
    }
  }

  // Structural coherence
  if (breakdown.structural_coherence < COHERENCE_THRESHOLD) {
    const pct = breakdown.structural_coherence.toFixed(0);
    if (breakdown.structural_coherence < 30) {
      reasons.push(
        `Structural coherence critical (${pct}/100): evidence is fragmented across disconnected graph clusters — no coherent dependency chain found.`,
      );
    } else {
      reasons.push(
        `Structural coherence degraded (${pct}/100): evidence is not forming a single coherent path to the target.`,
      );
    }
  }

  // Evidence concentration
  if (breakdown.evidence_concentration < CONCENTRATION_THRESHOLD) {
    const pct = breakdown.evidence_concentration.toFixed(0);
    if (breakdown.evidence_concentration === 0) {
      reasons.push(
        'Evidence concentration zero (0/100): no ranked candidates retrieved — the retrieval produced no usable mapping targets.',
      );
    } else {
      reasons.push(
        `Evidence concentration low (${pct}/100): multiple candidates score similarly with no clear dominant target.`,
      );
    }
  }

  // Intent alignment
  if (breakdown.intent_alignment < INTENT_THRESHOLD) {
    const pct = breakdown.intent_alignment.toFixed(0);
    reasons.push(
      `Intent alignment low (${pct}/100): retrieved evidence type or mapping pattern does not match what is expected for this intent.`,
    );
  }

  // ── Summary reason when all sub-metrics pass ──────────────────────────────
  if (reasons.length === 0) {
    if (level === 'pass') {
      reasons.push(
        `Mapping quality clear (${score}/100): scope, structure, concentration, and intent alignment all pass thresholds.`,
      );
    } else {
      reasons.push(
        `Mapping quality ${level} (${score}/100): composite score below pass threshold.`,
      );
    }
  }

  return reasons;
}
