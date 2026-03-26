import { scoreConflicts } from './knowledge/conflict/score-conflicts.js';
import type { ConflictRecord } from './knowledge/conflict/types.js';
import type { FreshnessImpact } from './knowledge/freshness/types.js';

export function scoreDimensions(context: any) {
  // ── Conflict dimension ────────────────────────────────────────────────────
  const conflicts: ConflictRecord[] = context?.conflicts ?? [];
  const conflictDim = scoreConflicts(conflicts);

  const severityMap: Record<string, 'pass' | 'warn' | 'escalate' | 'block'> = {
    none:     'pass',
    warn:     'warn',
    escalate: 'escalate',
    block:    'block',
  };

  // ── Freshness dimension ───────────────────────────────────────────────────
  // When a FreshnessImpact is provided in context, use it to build a real
  // freshness dimension entry. Otherwise fall back to 'pass'.
  const freshnessImpact: FreshnessImpact | undefined = context?.freshnessImpact;
  const freshnessSeverity: 'pass' | 'warn' | 'escalate' | 'block' =
    freshnessImpact ? (severityMap[freshnessImpact.severity] ?? 'pass') : 'pass';

  let freshnessDetail = '';
  if (freshnessImpact) {
    if (freshnessImpact.severity === 'none') {
      freshnessDetail = freshnessImpact.isStale
        ? 'Index is stale but no required scope is affected.'
        : 'Index is current.';
    } else {
      const pct = (freshnessImpact.impactRatio * 100).toFixed(0);
      freshnessDetail = `${freshnessImpact.intersectedScopeCount} stale required scope(s) — ${pct}% impact ratio.`;
      if (freshnessImpact.impactedFiles.length) {
        freshnessDetail += ` Affected: ${freshnessImpact.impactedFiles.slice(0, 3).join(', ')}`;
      }
    }
  }

  return {
    coverage: { severity: 'pass', detail: '' },
    freshness: { severity: freshnessSeverity, detail: freshnessDetail },
    mapping: { severity: 'pass', detail: '' },
    conflict: {
      severity: severityMap[conflictDim.severity] ?? 'pass',
      detail: conflictDim.summary,
      conflict_payload: conflictDim,
    },
    graph: { severity: 'pass', detail: '' },
  };
}
