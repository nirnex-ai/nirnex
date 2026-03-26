/**
 * Evidence Checkpoints — Public Entry Point
 *
 * The unconditional-pass stub has been replaced by the real Evidence Sufficiency Gate.
 * See packages/core/src/runtime/evidence/ for the full implementation.
 *
 * This module re-exports the gate handler as the canonical SUFFICIENCY_GATE handler
 * and surfaces evaluateEvidenceGate for direct use in tests and integrations.
 */

export {
  evidenceGateHandler,
  evaluateEvidenceGate,
  extractEvidenceFacts,
  getEvidencePolicy,
  EVIDENCE_RULES_BY_INTENT,
} from './runtime/evidence/index.js';

export type {
  EvidenceGateVerdict,
  EvidenceGateReasonCode,
  EvidenceGateFacts,
  EvidenceGateDecision,
  EvidenceProvenance,
  RuleResult,
  RuleCheck,
  IntentEvidencePolicy,
} from './runtime/evidence/types.js';
