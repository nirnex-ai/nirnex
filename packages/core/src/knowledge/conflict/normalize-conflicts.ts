// Conflict normalizer — deduplicates, merges evidence refs, and applies severity policy.
// Both detectors feed into this. Output is the canonical ConflictRecord[] for downstream.

import type { ConflictRecord } from './types.js';
import { applySeverityPolicy } from './policies/severity-policy.js';

// Two conflicts are considered duplicates if they share kind + type + same primary scope
function conflictKey(c: ConflictRecord): string {
  const scopeKey = [
    ...(c.scope.files ?? []),
    ...(c.scope.modules ?? []),
    ...(c.scope.claims ?? []),
    ...(c.scope.symbols ?? []),
  ]
    .sort()
    .slice(0, 3)
    .join('|');
  return `${c.kind}:${c.type}:${scopeKey}`;
}

function mergeEvidence(
  a: ConflictRecord['evidence'],
  b: ConflictRecord['evidence']
): ConflictRecord['evidence'] {
  const seen = new Set(a.map(r => `${r.source}:${r.ref}`));
  const merged = [...a];
  for (const ref of b) {
    const k = `${ref.source}:${ref.ref}`;
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(ref);
    }
  }
  return merged;
}

function mergeTwoConflicts(a: ConflictRecord, b: ConflictRecord): ConflictRecord {
  return {
    ...a,
    // Keep the higher confidence of the two
    confidence: Math.max(a.confidence, b.confidence),
    evidence: mergeEvidence(a.evidence, b.evidence),
    scope: {
      files: [...new Set([...(a.scope.files ?? []), ...(b.scope.files ?? [])])],
      symbols: [...new Set([...(a.scope.symbols ?? []), ...(b.scope.symbols ?? [])])],
      modules: [...new Set([...(a.scope.modules ?? []), ...(b.scope.modules ?? [])])],
      claims: [...new Set([...(a.scope.claims ?? []), ...(b.scope.claims ?? [])])],
    },
  };
}

export function normalizeConflicts(conflicts: ConflictRecord[]): ConflictRecord[] {
  if (conflicts.length === 0) return [];

  // Group by dedup key and merge
  const groups = new Map<string, ConflictRecord>();
  for (const conflict of conflicts) {
    const key = conflictKey(conflict);
    if (groups.has(key)) {
      groups.set(key, mergeTwoConflicts(groups.get(key)!, conflict));
    } else {
      groups.set(key, conflict);
    }
  }

  // Apply severity policy to each merged conflict
  return [...groups.values()].map(applySeverityPolicy);
}
