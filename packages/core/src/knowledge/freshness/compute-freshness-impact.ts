import { FRESHNESS_REASON_CODES } from './freshness-reason-codes.js';
import type { FreshnessSnapshot, RequiredScopeRef, StaleScopeRef, FreshnessImpact } from './types.js';

/**
 * Core scope intersection engine.
 *
 * Deterministic rule:
 *   freshness only penalises ECO when:
 *     required_scopes ∩ stale_scopes ≠ ∅
 *
 * Severity thresholds (impactRatio = intersected / max(required, 1)):
 *   none     → 0
 *   warn     → >0 and <0.25
 *   escalate → ≥0.25 and <0.60
 *   block    → ≥0.60
 *   block    → also when a deleted or renamed stale scope intersects required set
 *
 * No model inference. Same inputs → same output always.
 */
export function computeFreshnessImpact(
  snapshot: FreshnessSnapshot,
  requiredScopes: RequiredScopeRef[],
  staleScopes: StaleScopeRef[],
): FreshnessImpact {
  // ── Fresh index — no penalty ──────────────────────────────────────────────
  if (!snapshot.isStale) {
    return {
      isStale: false,
      staleScopeCount: 0,
      requiredScopeCount: requiredScopes.length,
      intersectedScopeCount: 0,
      impactedFiles: [],
      impactedScopeIds: [],
      impactRatio: 0,
      severity: 'none',
      reasonCodes: [FRESHNESS_REASON_CODES.INDEX_FRESH],
    };
  }

  // ── No required scopes → nothing to intersect ─────────────────────────────
  if (requiredScopes.length === 0) {
    return {
      isStale: true,
      staleScopeCount: staleScopes.length,
      requiredScopeCount: 0,
      intersectedScopeCount: 0,
      impactedFiles: [],
      impactedScopeIds: [],
      impactRatio: 0,
      severity: 'none',
      reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_NO_SCOPE_INTERSECTION],
    };
  }

  // ── Build lookup sets ─────────────────────────────────────────────────────
  // Required scope IDs (from retrieval / intent / graph)
  const requiredIds = new Set(requiredScopes.map(r => r.scopeId));

  // Stale scope index: scopeId → StaleScopeRef (for change-type lookups)
  const staleByScope = new Map<string, StaleScopeRef>();
  for (const s of staleScopes) {
    for (const sid of s.scopeIds) {
      staleByScope.set(sid, s);
    }
  }

  // ── Compute intersection ──────────────────────────────────────────────────
  const impactedScopeIds: string[] = [];
  const impactedFiles     = new Set<string>();
  const reasonCodes       = new Set<string>();

  let hasDeletedIntersection = false;
  let hasRenamedIntersection = false;

  for (const scopeId of requiredIds) {
    const staleRef = staleByScope.get(scopeId);
    if (!staleRef) continue;

    impactedScopeIds.push(scopeId);
    impactedFiles.add(staleRef.filePath);

    if (staleRef.changeType === 'deleted') hasDeletedIntersection = true;
    if (staleRef.changeType === 'renamed') hasRenamedIntersection = true;
  }

  const intersectedScopeCount = impactedScopeIds.length;

  // ── No intersection — stale but unrelated ─────────────────────────────────
  if (intersectedScopeCount === 0) {
    return {
      isStale: true,
      staleScopeCount: staleScopes.length,
      requiredScopeCount: requiredScopes.length,
      intersectedScopeCount: 0,
      impactedFiles: [],
      impactedScopeIds: [],
      impactRatio: 0,
      severity: 'none',
      reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_NO_SCOPE_INTERSECTION],
    };
  }

  // ── Intersection exists — compute ratio and severity ──────────────────────
  const impactRatio = intersectedScopeCount / Math.max(requiredScopes.length, 1);

  // Deleted / renamed required scope always escalates to block
  if (hasDeletedIntersection) {
    reasonCodes.add(FRESHNESS_REASON_CODES.INDEX_STALE_REQUIRED_SCOPE_DELETED);
  }
  if (hasRenamedIntersection) {
    reasonCodes.add(FRESHNESS_REASON_CODES.INDEX_STALE_REQUIRED_SCOPE_RENAMED);
  }

  let severity: FreshnessImpact['severity'];

  if (hasDeletedIntersection || hasRenamedIntersection) {
    severity = 'block';
  } else if (impactRatio >= 0.60) {
    severity = 'block';
    reasonCodes.add(FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_HIGH);
  } else if (impactRatio >= 0.25) {
    severity = 'escalate';
    reasonCodes.add(FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_MEDIUM);
  } else {
    severity = 'warn';
    reasonCodes.add(FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_LOW);
  }

  return {
    isStale: true,
    staleScopeCount: staleScopes.length,
    requiredScopeCount: requiredScopes.length,
    intersectedScopeCount,
    impactedFiles: Array.from(impactedFiles),
    impactedScopeIds,
    impactRatio,
    severity,
    reasonCodes: Array.from(reasonCodes),
  };
}
