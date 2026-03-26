// Severity policy — deterministic rules for assigning final severity to conflicts.
// Called by the normalizer after deduplication.

import type { ConflictRecord, ConflictSeverity, ResolutionHint } from '../types.js';

// Override severity for specific conflict types where the type itself determines severity
const SEVERITY_OVERRIDES: Partial<Record<ConflictRecord['type'], ConflictSeverity>> = {
  circular_dependency: 'block',
  entrypoint_mismatch: 'block',
};

// Override resolution hint based on final severity
function hintForSeverity(severity: ConflictSeverity, kind: ConflictRecord['kind']): ResolutionHint {
  if (severity === 'block') return 'must_block';
  if (severity === 'high') {
    return kind === 'structural' ? 'needs_explore' : 'needs_clarification';
  }
  if (severity === 'medium') return 'needs_explore';
  return 'can_proceed_with_warning';
}

export function applySeverityPolicy(conflict: ConflictRecord): ConflictRecord {
  const overrideSeverity = SEVERITY_OVERRIDES[conflict.type];
  const finalSeverity: ConflictSeverity = overrideSeverity ?? conflict.severity;
  const finalHint = hintForSeverity(finalSeverity, conflict.kind);

  return {
    ...conflict,
    severity: finalSeverity,
    resolution_hint: finalHint,
  };
}

// Determine the dominant (worst) severity across a set of conflicts
export function dominantSeverity(conflicts: ConflictRecord[]): ConflictSeverity {
  const RANK: Record<ConflictSeverity, number> = { low: 0, medium: 1, high: 2, block: 3 };
  let worst: ConflictSeverity = 'low';
  for (const c of conflicts) {
    if (RANK[c.severity] > RANK[worst]) {
      worst = c.severity;
    }
  }
  return worst;
}

// Map dominant severity to ECO-level severity label
export function ecoSeverityLabel(
  severity: ConflictSeverity
): 'none' | 'warn' | 'escalate' | 'block' {
  if (severity === 'block') return 'block';
  if (severity === 'high') return 'escalate';
  if (severity === 'medium') return 'warn';
  return 'none';
}
