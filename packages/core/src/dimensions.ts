import { scoreConflicts } from './knowledge/conflict/score-conflicts.js';
import type { ConflictRecord } from './knowledge/conflict/types.js';

export function scoreDimensions(context: any) {
  // Conflict dimension uses the typed scorer if conflicts are present
  const conflicts: ConflictRecord[] = context?.conflicts ?? [];
  const conflictDim = scoreConflicts(conflicts);

  const conflictSeverityMap: Record<string, 'pass' | 'warn' | 'escalate' | 'block'> = {
    none: 'pass',
    warn: 'warn',
    escalate: 'escalate',
    block: 'block',
  };

  return {
    coverage: { severity: 'pass', detail: '' },
    freshness: { severity: 'pass', detail: '' },
    mapping: { severity: 'pass', detail: '' },
    conflict: {
      severity: conflictSeverityMap[conflictDim.severity] ?? 'pass',
      detail: conflictDim.summary,
      conflict_payload: conflictDim,
    },
    graph: { severity: 'pass', detail: '' },
  };
}
