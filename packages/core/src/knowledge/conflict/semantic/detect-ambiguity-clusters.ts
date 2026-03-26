// Semantic detector: ambiguity cluster detection.
// Detects when the retrieved evidence maps the same intent/query to multiple
// plausible targets with no clear winner — operationally equivalent to conflict
// for a bounded edit system.

import { randomUUID } from 'crypto';
import type { EvidenceItem, ConflictRecord, ConflictEvidenceRef } from '../types.js';

// Minimum number of distinct plausible targets before we consider it ambiguous
const AMBIGUITY_THRESHOLD = 2;

// Patterns that indicate a specific implementation target claim
const TARGET_PATTERNS = [
  /\bin\s+([a-z][a-z/._-]{4,60})\b/gi,
  /\binside\s+([a-z][a-z/._-]{4,60})\b/gi,
  /\bat\s+([a-z][a-z/._-]{4,60})\b/gi,
  /\b([a-z][a-z/._-]{4,60}\.(ts|js|tsx|jsx|py|go|java))\b/gi,
  /\b([A-Z][a-zA-Z]{3,40}(?:Service|Handler|Controller|Manager|Validator|Processor))\b/g,
];

function extractTargetCandidates(text: string): string[] {
  const candidates = new Set<string>();
  for (const pattern of TARGET_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const candidate = (m[1] ?? m[0]).trim();
      if (candidate.length > 4 && candidate.length < 80) {
        candidates.add(candidate.toLowerCase());
      }
    }
  }
  return [...candidates];
}

export function detectAmbiguityClusters(
  evidence: EvidenceItem[],
  query?: string
): ConflictRecord[] {
  if (evidence.length === 0) return [];

  // Collect target candidates from all evidence items
  const targetMap = new Map<string, ConflictEvidenceRef[]>(); // target → evidence refs

  for (const item of evidence) {
    const targets = extractTargetCandidates(item.content);
    for (const target of targets) {
      if (!targetMap.has(target)) targetMap.set(target, []);
      targetMap.get(target)!.push({
        source: item.source as ConflictEvidenceRef['source'],
        ref: item.ref,
        excerpt: `Mentions target: ${target}`,
      });
    }
  }

  // Also extract targets from query if provided
  if (query) {
    const queryTargets = extractTargetCandidates(query);
    for (const target of queryTargets) {
      if (!targetMap.has(target)) targetMap.set(target, []);
      targetMap.get(target)!.push({
        source: 'spec',
        ref: 'query',
        excerpt: `Query references target: ${target}`,
      });
    }
  }

  // Find targets mentioned in multiple distinct sources — these are ambiguous candidates
  const ambiguousTargets = [...targetMap.entries()].filter(([, refs]) => {
    const distinctSources = new Set(refs.map(r => r.source));
    return distinctSources.size >= 1;
  });

  // Only emit if there are multiple competing plausible targets
  if (ambiguousTargets.length < AMBIGUITY_THRESHOLD) return [];

  // Gather all evidence refs
  const allEvidence: ConflictEvidenceRef[] = ambiguousTargets
    .flatMap(([, refs]) => refs)
    .filter((ref, idx, arr) =>
      arr.findIndex(r => r.ref === ref.ref && r.source === ref.source) === idx
    );

  // Need at least 2 evidence refs (requirement from plan)
  if (allEvidence.length < 2) return [];

  const targetNames = ambiguousTargets.map(([t]) => t);

  return [{
    id: randomUUID(),
    kind: 'semantic',
    type: 'ambiguity_cluster',
    severity: 'medium',
    confidence: 0.65,
    summary: `${targetNames.length} competing implementation targets found — no clear winner`,
    why_it_matters: 'Ambiguity about which module/symbol to modify is operationally equivalent to conflict — bounded execution cannot commit to a safe edit zone without disambiguation.',
    scope: {
      claims: targetNames.slice(0, 10),
    },
    evidence: allEvidence.slice(0, 6),
    resolution_hint: 'needs_clarification',
    detector: 'semantic/detect-ambiguity-clusters',
  }];
}
