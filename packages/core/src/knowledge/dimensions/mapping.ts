/**
 * Mapping Dimension Evaluator
 *
 * Quantitative adapter that bridges the ECO dimension contract (DimensionResult)
 * with the Sprint-14 Mapping Quality Metric engine (scoreMappingQuality).
 *
 * Inputs (from DimensionSignals):
 *   - mappingPattern            → qualitative pattern label
 *   - primaryCandidateScore     → normalized 0..1 score of top candidate
 *   - alternateCandidateScore   → normalized 0..1 score of second candidate
 *   - allCandidateScores        → full ranked list (for evidence_concentration)
 *   - disconnectedClusterCount  → graph fragmentation signal
 *   - matchedScopeCount         → evidence coverage count
 *   - requestedScopeCount       → required scope count
 *   - retrievedEvidenceClasses  → actual evidence types retrieved
 *   - requiredEvidenceClasses   → mandatory evidence types for intent
 *   - symbolsResolved / Unresolved → symbol alignment (forward-compat)
 *
 * Design constraints:
 *   - Must not depend on coverage, freshness, conflict, or graph results
 *   - All scoring logic lives in the mapping sub-module (packages/core/src/knowledge/mapping/)
 *   - This file is a pure adapter — no scoring logic here
 */

import type { DimensionResult, DimensionSignals, DimensionThresholds } from './types.js';
import { MAPPING_QUALITY_REASON_CODES } from './reason-codes.js';
import { scoreMappingQuality } from '../mapping/score.js';
import { buildMappingQualityInput } from '../mapping/signals.js';

export function computeMappingDimension(
  signals: DimensionSignals,
  thresholds: DimensionThresholds,
): DimensionResult {
  const { mapping: t } = thresholds;

  // ── Build normalized input for the quantitative engine ─────────────────────
  const mqInput = buildMappingQualityInput(signals);

  // ── Run the 4-sub-metric scoring engine ────────────────────────────────────
  const mqResult = scoreMappingQuality(mqInput);

  // ── Convert 0..100 score → 0..1 dimension value ───────────────────────────
  const value = Math.max(0, Math.min(1, mqResult.score / 100));

  // ── Map MappingQualityResult.level → DimensionSeverity ────────────────────
  // level values match DimensionSeverity exactly: pass | warn | escalate | block
  const status = mqResult.level as DimensionResult['status'];

  // ── Reason codes ──────────────────────────────────────────────────────────
  const reason_codes: string[] = [MAPPING_QUALITY_REASON_CODES.MAPPING_QUALITY_SCORED];
  if (mqResult.hard_block) {
    reason_codes.push(MAPPING_QUALITY_REASON_CODES.MAPPING_QUALITY_HARD_BLOCK);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = mqResult.reasons[0]
    ?? `Mapping quality ${mqResult.level} (${mqResult.score}/100).`;

  return {
    value,
    status,
    reason_codes,
    summary,
    provenance: {
      signals: [
        'mappingPattern',
        'primaryCandidateScore',
        'alternateCandidateScore',
        'allCandidateScores',
        'disconnectedClusterCount',
        'matchedScopeCount',
        'requestedScopeCount',
        'retrievedEvidenceClasses',
        'requiredEvidenceClasses',
        'symbolsResolved',
        'symbolsUnresolved',
      ],
      thresholds: { pass: t.pass, warn: t.warn, escalate: t.escalate },
    },
    metrics: {
      mapping_quality_score:            mqResult.score,
      hard_block:                       mqResult.hard_block,
      mapping_quality_level:            mqResult.level,
      // Serialized breakdown for calibration/replay — use JSON.parse(metrics.mapping_quality_breakdown) to recover
      mapping_quality_breakdown:        JSON.stringify(mqResult.breakdown),
      breakdown_scope_alignment:        mqResult.breakdown.scope_alignment,
      breakdown_structural_coherence:   mqResult.breakdown.structural_coherence,
      breakdown_evidence_concentration: mqResult.breakdown.evidence_concentration,
      breakdown_intent_alignment:       mqResult.breakdown.intent_alignment,
      mappingPattern:                   signals.mappingPattern,
      primaryCandidateScore:            signals.primaryCandidateScore,
      alternateCandidateScore:          signals.alternateCandidateScore,
    },
  };
}
