/**
 * Mapping Dimension Evaluator
 *
 * Measures how well retrieved evidence maps structurally to the actual requested
 * change area. This is NOT about evidence presence (coverage) or coherence (conflict).
 *
 * Inputs (from DimensionSignals):
 *   - mappingPattern     → '1:1' | '1:chain' | '1:scattered' | 'ambiguous' | 'unknown'
 *   - primaryCandidateScore / alternateCandidateScore → scatter detection
 *   - symbolsResolved / symbolsUnresolved → symbol alignment
 *
 * Design constraints:
 *   - Must not depend on coverage, freshness, conflict, or graph results
 *   - '1:scattered' → always block (no scatter ever safe)
 *   - 'unknown' → warn minimum (cannot silently pass when pattern is undetected)
 *   - Ambiguous competing alternates → at least escalate
 */

import type { DimensionResult, DimensionSignals, DimensionThresholds } from './types.js';
import { MAPPING_REASON_CODES } from './reason-codes.js';

// Pattern base scores — intrinsic quality before scatter adjustment
const PATTERN_BASE: Record<string, number> = {
  '1:1':         1.00,
  '1:chain':     0.85,
  'ambiguous':   0.50,
  '1:scattered': 0.00, // always block
  'unknown':     0.45,
};

export function computeMappingDimension(
  signals: DimensionSignals,
  thresholds: DimensionThresholds,
): DimensionResult {
  const { mapping: t } = thresholds;
  const {
    mappingPattern,
    primaryCandidateScore,
    alternateCandidateScore,
  } = signals;

  // ── Hard block: scattered pattern ─────────────────────────────────────────
  if (mappingPattern === '1:scattered') {
    return {
      value: 0.05,
      status: 'block',
      reason_codes: [MAPPING_REASON_CODES.MAPPING_SCATTERED],
      summary: 'Mapping scattered across unrelated targets — no reliable primary candidate.',
      provenance: {
        signals: ['mappingPattern'],
        thresholds: { pass: t.pass, warn: t.warn, escalate: t.escalate },
      },
      metrics: {
        mappingPattern,
        scatterRatio: 0,
        primaryCandidateScore,
        alternateCandidateScore,
      },
    };
  }

  // ── Get pattern base score ─────────────────────────────────────────────────
  const patternBase = PATTERN_BASE[mappingPattern] ?? 0.45;

  // ── Scatter ratio: how much the alternate competes with the primary ────────
  // A scatter ratio of 1.0 means the alternate is as strong as the primary.
  const scatterRatio = primaryCandidateScore > 0
    ? alternateCandidateScore / primaryCandidateScore
    : (alternateCandidateScore > 0 ? 1.0 : 0);

  // Scatter deduction: up to 40% deducted when alternate is as strong as primary
  const scatterDeduction = Math.min(scatterRatio * 0.35, 0.40);

  // ── Compute value ─────────────────────────────────────────────────────────
  let value = patternBase * (1 - scatterDeduction);

  // No primary target at all → cap value
  if (primaryCandidateScore === 0) {
    value = Math.min(value, 0.30);
  }

  value = Math.max(0, Math.min(1, value));

  // ── Reason codes ──────────────────────────────────────────────────────────
  const reason_codes: string[] = [];

  if (mappingPattern === 'ambiguous') {
    reason_codes.push(MAPPING_REASON_CODES.MAPPING_PRIMARY_TARGET_AMBIGUOUS);
  } else if (mappingPattern === '1:1') {
    reason_codes.push(MAPPING_REASON_CODES.MAPPING_CLEAN_SINGLE_TARGET);
  } else if (mappingPattern === '1:chain') {
    reason_codes.push(MAPPING_REASON_CODES.MAPPING_CHAIN_TARGET);
  } else if (mappingPattern === 'unknown') {
    reason_codes.push(MAPPING_REASON_CODES.MAPPING_PATTERN_UNKNOWN);
  }

  if (scatterRatio >= 0.5) {
    reason_codes.push(MAPPING_REASON_CODES.MAPPING_SCATTER_DETECTED);
  }

  if (primaryCandidateScore === 0) {
    reason_codes.push(MAPPING_REASON_CODES.MAPPING_NO_PRIMARY_TARGET);
  }

  // ── Status ────────────────────────────────────────────────────────────────
  let status: DimensionResult['status'];

  // Ambiguous pattern always escalates at minimum
  if (mappingPattern === 'ambiguous') {
    status = value >= t.escalate ? 'escalate' : 'block';
  } else if (value >= t.pass) {
    // Competing alternate candidate (≥30% of primary) → downgrade to warn
    // A strong alternate means execution target is not unambiguously identified
    if (alternateCandidateScore >= 0.30) {
      status = 'warn';
    } else {
      status = 'pass';
    }
  } else if (value >= t.warn) {
    status = 'warn';
  } else if (value >= t.escalate) {
    status = 'escalate';
  } else {
    status = 'block';
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const scatterPct = Math.round(scatterRatio * 100);
  const summary =
    status === 'pass'
      ? `Mapping clean — ${mappingPattern} pattern, primary target well-defined.`
      : status === 'warn'
        ? `Mapping adequate — ${mappingPattern} with ${scatterPct}% scatter.`
        : status === 'escalate'
          ? `Mapping ambiguous — competing candidates detected (scatter: ${scatterPct}%).`
          : `Mapping unreliable — ${mappingPattern} pattern, no safe execution target.`;

  return {
    value,
    status,
    reason_codes: [...new Set(reason_codes)],
    summary,
    provenance: {
      signals: ['mappingPattern', 'primaryCandidateScore', 'alternateCandidateScore'],
      thresholds: { pass: t.pass, warn: t.warn, escalate: t.escalate },
    },
    metrics: {
      mappingPattern,
      patternBaseScore: patternBase,
      scatterRatio: Number(scatterRatio.toFixed(4)),
      primaryCandidateScore,
      alternateCandidateScore,
    },
  };
}
