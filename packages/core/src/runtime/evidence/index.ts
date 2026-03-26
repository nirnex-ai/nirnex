/**
 * Evidence Gate — Public API
 *
 * Exports:
 *   - All evidence gate types (re-exported from types.ts)
 *   - EVIDENCE_RULES_BY_INTENT + getEvidencePolicy (from rules.ts)
 *   - evaluateEvidenceGate + extractEvidenceFacts (from checkpoints.ts)
 *   - evidenceGateHandler — the SUFFICIENCY_GATE pipeline stage handler
 *
 * The evidenceGateHandler is designed to be injected as the SUFFICIENCY_GATE
 * handler in runOrchestrator():
 *
 *   await runOrchestrator(input, {
 *     SUFFICIENCY_GATE: evidenceGateHandler,
 *     ...
 *   });
 */

import type { SufficiencyGateInput, SufficiencyGateOutput } from '../../pipeline/types.js';
import { evaluateEvidenceGate } from './checkpoints.js';
import type { EvidenceGateVerdict } from './types.js';

// Re-export everything for test and ledger consumers
export * from './types.js';
export * from './rules.js';
export { evaluateEvidenceGate, extractEvidenceFacts } from './checkpoints.js';

// ─── Verdict → SufficiencyGateOutput behavior mapping ────────────────────────

/**
 * Map internal EvidenceGateVerdict to the SufficiencyGateOutput.behavior contract.
 *
 * clarify → 'ask'   (SufficiencyGateOutput vocabulary)
 * refuse  → 'block' (SufficiencyGateOutput vocabulary)
 * pass    → 'pass'
 */
function verdictToBehavior(verdict: EvidenceGateVerdict): SufficiencyGateOutput['behavior'] {
  switch (verdict) {
    case 'pass':    return 'pass';
    case 'clarify': return 'ask';
    case 'refuse':  return 'block';
  }
}

// ─── Gate handler ─────────────────────────────────────────────────────────────

/**
 * SUFFICIENCY_GATE stage handler.
 *
 * Wraps evaluateEvidenceGate() into the SufficiencyGateOutput pipeline contract.
 * The full EvidenceGateDecision is available via the stage's BoundTrace.output
 * in the decision ledger (captured by the stage executor).
 *
 * Lane selection:
 *   - On pass: uses eco.recommended_lane if available, else defaults to 'C'
 *   - On non-pass: always returns lane 'C' (pipeline is stopping)
 */
export async function evidenceGateHandler(
  input: SufficiencyGateInput,
): Promise<SufficiencyGateOutput> {
  const decision = evaluateEvidenceGate(input);
  const behavior = verdictToBehavior(decision.verdict);

  // Retrieve recommended lane from ECO (carries forward for pass verdicts)
  const ecoAny = input as Record<string, unknown>;
  const recommendedLane = (ecoAny['recommended_lane'] as string | undefined) ?? 'C';

  return {
    behavior,
    lane:   decision.verdict === 'pass' ? recommendedLane : 'C',
    reason: decision.summary,
  };
}
