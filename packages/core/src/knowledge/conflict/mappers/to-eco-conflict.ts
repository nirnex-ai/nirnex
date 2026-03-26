// Maps ECOConflictDimension to the ECO dimension payload shape.
// The existing ECO uses { severity: string, detail: string } for each dimension.
// We extend it to carry the full typed conflict set while remaining backward-compatible.

import type { ECOConflictDimension } from '../types.js';

export type ECOConflictDimensionEntry = {
  severity: 'pass' | 'warn' | 'escalate' | 'block';
  detail: string;
  conflict_payload: ECOConflictDimension;
};

export function toECOConflictEntry(dim: ECOConflictDimension): ECOConflictDimensionEntry {
  // Map 'none' → 'pass' for compatibility with existing dimension severity schema
  const severity =
    dim.severity === 'none' ? 'pass' : dim.severity;

  return {
    severity,
    detail: dim.summary,
    conflict_payload: dim,
  };
}
