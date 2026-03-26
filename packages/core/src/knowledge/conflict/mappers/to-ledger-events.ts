// Maps conflict detection results to Decision Ledger events.
// Events are stored as first-class trace records for replay and calibration.

import type { ConflictRecord, ConflictLedgerEvent, GateDecision, ECOConflictDimension } from '../types.js';

function now(): string {
  return new Date().toISOString();
}

export function toLedgerEvents(opts: {
  structuralConflicts: ConflictRecord[];
  semanticConflicts: ConflictRecord[];
  normalizedConflicts: ConflictRecord[];
  ecoConflict: ECOConflictDimension;
  gateDecision: GateDecision;
  affectedLane?: string;
}): ConflictLedgerEvent[] {
  const events: ConflictLedgerEvent[] = [];

  events.push({
    kind: 'conflict_detection_started',
    timestamp: now(),
    payload: {
      structural_input_count: opts.structuralConflicts.length + opts.semanticConflicts.length,
    },
  });

  if (opts.structuralConflicts.length > 0) {
    events.push({
      kind: 'structural_conflicts_found',
      timestamp: now(),
      payload: {
        count: opts.structuralConflicts.length,
        types: opts.structuralConflicts.map(c => c.type),
        severities: opts.structuralConflicts.map(c => c.severity),
        ids: opts.structuralConflicts.map(c => c.id),
      },
    });
  }

  if (opts.semanticConflicts.length > 0) {
    events.push({
      kind: 'semantic_conflicts_found',
      timestamp: now(),
      payload: {
        count: opts.semanticConflicts.length,
        types: opts.semanticConflicts.map(c => c.type),
        severities: opts.semanticConflicts.map(c => c.severity),
        ids: opts.semanticConflicts.map(c => c.id),
      },
    });
  }

  events.push({
    kind: 'conflict_normalized',
    timestamp: now(),
    payload: {
      raw_count: opts.structuralConflicts.length + opts.semanticConflicts.length,
      normalized_count: opts.normalizedConflicts.length,
      dominant_ids: opts.ecoConflict.dominant_conflicts,
    },
  });

  events.push({
    kind: 'conflict_affected_eco',
    timestamp: now(),
    payload: {
      score: opts.ecoConflict.score,
      severity: opts.ecoConflict.severity,
      summary: opts.ecoConflict.summary,
    },
  });

  events.push({
    kind: 'conflict_affected_gate',
    timestamp: now(),
    payload: {
      behavior: opts.gateDecision.behavior,
      reason: opts.gateDecision.reason,
      dominant_conflict_ids: opts.gateDecision.dominant_conflict_ids,
    },
  });

  if (opts.affectedLane) {
    events.push({
      kind: 'conflict_affected_lane',
      timestamp: now(),
      payload: {
        lane: opts.affectedLane,
        gate_behavior: opts.gateDecision.behavior,
      },
    });
  }

  return events;
}
