// Conflict detection orchestrator.
// Single execution path: structural → semantic → normalize → score → gate → map → ledger.

import type { ConflictDetectionInput, ConflictRecord, ECOConflictDimension, TEEConflictSection, GateDecision, ConflictLedgerEvent } from './types.js';

import { detectCircularDeps } from './structural/detect-circular-deps.js';
import { detectHubCollisions } from './structural/detect-hub-collisions.js';
import { detectOwnershipOverlap } from './structural/detect-ownership-overlap.js';
import { detectEntrypointMismatch } from './structural/detect-entrypoint-mismatch.js';

import { extractClaims } from './semantic/extract-claims.js';
import { detectClaimContradictions } from './semantic/detect-claim-contradictions.js';
import { detectSpecCodeDivergence } from './semantic/detect-spec-code-divergence.js';
import { detectMultiSourceDisagreement } from './semantic/detect-multi-source-disagreement.js';
import { detectAmbiguityClusters } from './semantic/detect-ambiguity-clusters.js';

import { normalizeConflicts } from './normalize-conflicts.js';
import { scoreConflicts } from './score-conflicts.js';
import { applyGatePolicy } from './policies/gate-policy.js';
import { toECOConflictEntry } from './mappers/to-eco-conflict.js';
import { toTEEConflictSection } from './mappers/to-tee-conflict.js';
import { toLedgerEvents } from './mappers/to-ledger-events.js';

export type ConflictDetectionResult = {
  // Normalized, deduplicated conflicts
  conflicts: ConflictRecord[];

  // ECO dimension payload
  eco: ECOConflictDimension;
  ecoEntry: ReturnType<typeof toECOConflictEntry>;

  // TEE conflict section
  tee: TEEConflictSection;

  // Gate decision
  gate: GateDecision;

  // Decision ledger events
  ledgerEvents: ConflictLedgerEvent[];

  // Developer-visible trace for debugging
  trace: {
    structural: ConflictRecord[];
    semantic: ConflictRecord[];
    normalized: ConflictRecord[];
    claimsExtracted: number;
    semanticDetectorError?: string;
  };
};

export function detectConflicts(input: ConflictDetectionInput): ConflictDetectionResult {
  // ── Step 1: Structural detection ─────────────────────────────────────────

  const structuralConflicts: ConflictRecord[] = [
    ...detectCircularDeps(input.touchedPaths, input.db),
    ...detectHubCollisions(input.touchedPaths, input.hubNodes, input.db),
    ...detectOwnershipOverlap(input.touchedPaths),
    ...detectEntrypointMismatch(input.touchedPaths, input.query ?? '', input.db),
  ];

  // ── Step 2: Semantic detection ────────────────────────────────────────────

  let semanticConflicts: ConflictRecord[] = [];
  let claimsExtracted = 0;
  let semanticDetectorError: string | undefined;

  try {
    const claims = extractClaims(input.evidence ?? []);
    claimsExtracted = claims.length;

    semanticConflicts = [
      ...detectClaimContradictions(claims),
      ...detectSpecCodeDivergence(claims),
      ...detectMultiSourceDisagreement(claims),
      ...detectAmbiguityClusters(input.evidence ?? [], input.query),
    ];
  } catch (err) {
    // Semantic detector failure degrades gracefully to structural-only mode
    semanticDetectorError = err instanceof Error ? err.message : String(err);
  }

  // ── Step 3: Normalize + dedupe ────────────────────────────────────────────

  const allRaw = [...structuralConflicts, ...semanticConflicts];
  const normalizedConflicts = normalizeConflicts(allRaw);

  // ── Step 4: Score → ECO dimension ────────────────────────────────────────

  const eco = scoreConflicts(normalizedConflicts);
  const ecoEntry = toECOConflictEntry(eco);

  // ── Step 5: Gate policy ───────────────────────────────────────────────────

  const gate = applyGatePolicy(normalizedConflicts);

  // ── Step 6: TEE conflict section ──────────────────────────────────────────

  const tee = toTEEConflictSection(normalizedConflicts);

  // ── Step 7: Ledger events ─────────────────────────────────────────────────

  const ledgerEvents = toLedgerEvents({
    structuralConflicts,
    semanticConflicts,
    normalizedConflicts,
    ecoConflict: eco,
    gateDecision: gate,
  });

  return {
    conflicts: normalizedConflicts,
    eco,
    ecoEntry,
    tee,
    gate,
    ledgerEvents,
    trace: {
      structural: structuralConflicts,
      semantic: semanticConflicts,
      normalized: normalizedConflicts,
      claimsExtracted,
      semanticDetectorError,
    },
  };
}
