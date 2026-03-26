// Conflict scorer — converts a normalized ConflictRecord[] into ECOConflictDimension.
// Conflict scoring is independent of coverage/mapping to avoid biasing toward "enough evidence."

import type { ConflictRecord, ECOConflictDimension } from './types.js';
import { dominantSeverity, ecoSeverityLabel } from './policies/severity-policy.js';

function computeConflictScore(conflicts: ConflictRecord[]): number {
  if (conflicts.length === 0) return 1.0;

  const SEVERITY_WEIGHTS: Record<ConflictRecord['severity'], number> = {
    low: 0.1,
    medium: 0.25,
    high: 0.5,
    block: 1.0,
  };

  // Score = 1 - weighted sum, capped at [0, 1]
  const totalDeduction = conflicts.reduce((acc, c) => {
    return acc + SEVERITY_WEIGHTS[c.severity] * c.confidence;
  }, 0);

  return Math.max(0, Math.min(1, 1 - totalDeduction));
}

function buildSummary(conflicts: ConflictRecord[], severity: ReturnType<typeof ecoSeverityLabel>): string {
  if (conflicts.length === 0) return 'No material conflicts detected.';
  if (severity === 'block') {
    const blocker = conflicts.find(c => c.severity === 'block');
    return blocker ? `Blocking conflict: ${blocker.summary}` : `${conflicts.length} conflict(s) including blockers.`;
  }
  if (severity === 'escalate') {
    return `${conflicts.length} high-severity conflict(s) require review.`;
  }
  if (severity === 'warn') {
    return `${conflicts.length} advisory conflict(s) — bounded execution is safe.`;
  }
  return `${conflicts.length} low-severity conflict(s) noted.`;
}

export function scoreConflicts(conflicts: ConflictRecord[]): ECOConflictDimension {
  const dominant = dominantSeverity(conflicts);
  const severity = ecoSeverityLabel(dominant);
  const score = computeConflictScore(conflicts);
  const summary = buildSummary(conflicts, severity);

  const dominant_conflicts = conflicts
    .filter(c => c.severity === dominant)
    .map(c => c.id);

  return {
    score,
    severity,
    summary,
    conflicts,
    dominant_conflicts,
  };
}
