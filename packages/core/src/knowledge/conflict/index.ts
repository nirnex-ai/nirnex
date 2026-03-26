// Public entry point for the conflict detection subsystem.

export { detectConflicts } from './detect-conflicts.js';
export type { ConflictDetectionResult } from './detect-conflicts.js';

export type {
  ConflictRecord,
  ConflictKind,
  ConflictType,
  ConflictSeverity,
  ConflictEvidenceRef,
  ResolutionHint,
  Claim,
  ClaimPolarity,
  EvidenceItem,
  EvidenceSourceType,
  StructuralConflictInput,
  SemanticConflictInput,
  ConflictDetectionInput,
  ECOConflictDimension,
  TEEConflictSection,
  GateBehavior,
  GateDecision,
  ConflictLedgerEvent,
  ConflictLedgerEventKind,
} from './types.js';
