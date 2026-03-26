/**
 * Coverage Dimension Evaluator
 *
 * Measures whether retrieved evidence adequately covers the requested intent and scope.
 *
 * Inputs (from DimensionSignals):
 *   - matchedScopeCount / requestedScopeCount  → scope coverage ratio
 *   - retrievedEvidenceClasses vs requiredEvidenceClasses → mandatory evidence gap
 *
 * This dimension measures PRESENCE and SUFFICIENCY, not coherence.
 * Coherence belongs to the Conflict dimension.
 *
 * Design constraints:
 *   - Must not depend on freshness, mapping, conflict, or graph results
 *   - Unknown scope count → warn (not silent pass)
 *   - All mandatory evidence missing → block regardless of scope ratio
 */

import type { DimensionResult, DimensionSignals, DimensionThresholds } from './types.js';
import { COVERAGE_REASON_CODES } from './reason-codes.js';

export function computeCoverageDimension(
  signals: DimensionSignals,
  thresholds: DimensionThresholds,
): DimensionResult {
  const { coverage: t } = thresholds;

  const {
    matchedScopeCount,
    requestedScopeCount,
    retrievedEvidenceClasses,
    requiredEvidenceClasses,
  } = signals;

  // ── Scope coverage ratio ───────────────────────────────────────────────────
  const scopeRatio = requestedScopeCount > 0
    ? matchedScopeCount / requestedScopeCount
    : 1.0; // no scope expected → full coverage by definition

  // ── Mandatory evidence gap ────────────────────────────────────────────────
  const missingMandatory = requiredEvidenceClasses.filter(
    c => !retrievedEvidenceClasses.includes(c),
  );
  const mandatoryMissingCount = missingMandatory.length;
  const allMandatoryMissing =
    mandatoryMissingCount >= requiredEvidenceClasses.length &&
    requiredEvidenceClasses.length > 0;

  // ── Compute normalized value ───────────────────────────────────────────────
  // Each missing mandatory class deducts 20% (capped at 60% total deduction)
  const mandatoryPenalty = Math.min(mandatoryMissingCount * 0.20, 0.60);
  const value = Math.max(0, scopeRatio * (1 - mandatoryPenalty));

  // ── Hard block conditions ──────────────────────────────────────────────────
  const noScopeMatched = matchedScopeCount === 0 && requestedScopeCount > 0;
  const hardBlock = noScopeMatched || allMandatoryMissing;

  // ── Reason codes ──────────────────────────────────────────────────────────
  const reason_codes: string[] = [];

  if (mandatoryMissingCount > 0) {
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_REQUIRED_EVIDENCE_MISSING);
  }
  if (allMandatoryMissing) {
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_ALL_MANDATORY_MISSING);
  }
  if (noScopeMatched) {
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_NO_SCOPE_MATCHED);
  }

  // ── Determine status from value ────────────────────────────────────────────
  // Mandatory evidence missing ALWAYS forces minimum escalate, regardless of scope ratio.
  // This enforces: missing required inputs = cannot safely proceed at pass/warn level.
  let status: DimensionResult['status'];
  if (hardBlock) {
    status = 'block';
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_SIGNIFICANT_GAP);
  } else if (mandatoryMissingCount >= 1) {
    // At least one mandatory class missing → minimum escalate
    // (allMandatoryMissing would have triggered hardBlock above)
    status = value >= t.escalate ? 'escalate' : 'block';
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_SIGNIFICANT_GAP);
  } else if (value >= t.pass) {
    status = 'pass';
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_FULL);
  } else if (value >= t.warn) {
    status = 'warn';
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_PARTIAL_SCOPE);
  } else if (value >= t.escalate) {
    status = 'escalate';
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_SIGNIFICANT_GAP);
  } else {
    status = 'block';
    reason_codes.push(COVERAGE_REASON_CODES.COVERAGE_SIGNIFICANT_GAP);
  }

  // ── Build summary ─────────────────────────────────────────────────────────
  const pct = Math.round(scopeRatio * 100);
  const summary =
    status === 'pass'
      ? `Coverage complete — ${pct}% scope matched, all required evidence present.`
      : status === 'warn'
        ? `Coverage partial — ${pct}% scope matched.${mandatoryMissingCount > 0 ? ` Missing: ${missingMandatory.join(', ')}.` : ''}`
        : status === 'escalate'
          ? `Coverage degraded — ${pct}% scope matched, ${mandatoryMissingCount} required evidence class(es) absent.`
          : `Coverage insufficient — ${noScopeMatched ? 'no scope matched' : `${mandatoryMissingCount} mandatory evidence class(es) missing`}.`;

  return {
    value: hardBlock ? Math.min(value, 0.15) : value,
    status,
    reason_codes: [...new Set(reason_codes)],
    summary,
    provenance: {
      signals: ['matchedScopeCount', 'requestedScopeCount', 'retrievedEvidenceClasses', 'requiredEvidenceClasses'],
      thresholds: { pass: t.pass, warn: t.warn, escalate: t.escalate },
    },
    metrics: {
      scopeRatio: Number(scopeRatio.toFixed(4)),
      matchedScopeCount,
      requestedScopeCount,
      mandatoryMissingCount,
      retrievedCount: retrievedEvidenceClasses.length,
      requiredCount: requiredEvidenceClasses.length,
    },
  };
}
