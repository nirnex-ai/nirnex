// Canonical conflict contract for the Knowledge Layer.
// All detectors emit ConflictRecord[]. All downstream consumers (ECO, TEE, ledger) use this shape.

export type ConflictKind = 'structural' | 'semantic';

export type ConflictType =
  | 'circular_dependency'
  | 'hub_collision'
  | 'ownership_overlap'
  | 'entrypoint_mismatch'
  | 'constraint_mismatch'
  | 'source_claim_contradiction'
  | 'spec_code_divergence'
  | 'multi_source_disagreement'
  | 'ambiguity_cluster';

export type ConflictSeverity = 'low' | 'medium' | 'high' | 'block';

export type ConflictEvidenceSource =
  | 'graph'
  | 'code'
  | 'spec'
  | 'bug_report'
  | 'docs'
  | 'runtime'
  | 'index';

export type ConflictEvidenceRef = {
  source: ConflictEvidenceSource;
  ref: string;
  excerpt?: string;
};

export type ResolutionHint =
  | 'needs_clarification'
  | 'needs_explore'
  | 'can_proceed_with_warning'
  | 'must_block';

export type ConflictRecord = {
  id: string;
  kind: ConflictKind;
  type: ConflictType;
  severity: ConflictSeverity;
  confidence: number; // 0..1
  summary: string;
  why_it_matters: string;
  scope: {
    files?: string[];
    symbols?: string[];
    modules?: string[];
    claims?: string[];
  };
  evidence: ConflictEvidenceRef[];
  resolution_hint: ResolutionHint;
  detector: string;
};

// Normalized claim extracted from an evidence source — used by semantic detectors.
export type ClaimPolarity =
  | 'asserts'
  | 'denies'
  | 'requires'
  | 'forbids'
  | 'implements'
  | 'missing';

export type Claim = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  polarity: ClaimPolarity;
  sourceRef: ConflictEvidenceRef;
  confidence: number;
};

// Evidence item fed into semantic detection — typed retrieval result.
export type EvidenceSourceType =
  | 'spec'
  | 'bug_report'
  | 'docs'
  | 'code'
  | 'runtime';

export type EvidenceItem = {
  source: EvidenceSourceType;
  ref: string;
  content: string;
  metadata?: Record<string, unknown>;
};

// Input to the structural detector.
export type StructuralConflictInput = {
  touchedPaths: string[];
  touchedSymbols: string[];
  hubNodes: string[];
  crossModuleEdges: string[];
  criticalPathHit: boolean;
  db?: import('better-sqlite3').Database;
};

// Input to the semantic detector.
export type SemanticConflictInput = {
  evidence: EvidenceItem[];
  query?: string;
  specPath?: string;
};

// Full conflict detection input.
export type ConflictDetectionInput = StructuralConflictInput & SemanticConflictInput;

// ECO conflict dimension payload — extends the existing scalar with typed records.
export type ECOConflictDimension = {
  score: number;              // 0..1, higher = healthier (less conflict)
  severity: 'none' | 'warn' | 'escalate' | 'block';
  summary: string;
  conflicts: ConflictRecord[];
  dominant_conflicts: string[]; // ids of the most severe
};

// TEE conflict section — injected into the Task Execution Envelope.
export type TEEConflictSection = {
  blocked_paths: string[];
  blocked_symbols: string[];
  clarification_questions: string[];
  proceed_warnings: string[];
};

// Gate policy output.
export type GateBehavior = 'pass' | 'ask' | 'explore' | 'refuse';

export type GateDecision = {
  behavior: GateBehavior;
  reason: string;
  dominant_conflict_ids: string[];
};

// Ledger event kinds for conflict detection.
export type ConflictLedgerEventKind =
  | 'conflict_detection_started'
  | 'structural_conflicts_found'
  | 'semantic_conflicts_found'
  | 'conflict_normalized'
  | 'conflict_affected_eco'
  | 'conflict_affected_gate'
  | 'conflict_affected_lane';

export type ConflictLedgerEvent = {
  kind: ConflictLedgerEventKind;
  timestamp: string;
  payload: Record<string, unknown>;
};
