// Semantic detector: source claim contradiction.
// Finds pairs of claims from different sources that assert incompatible facts
// about the same subject. Rule-based only — no LLM inference.

import { randomUUID } from 'crypto';
import type { Claim, ConflictRecord, ConflictEvidenceRef } from '../types.js';

// Polarity pairs that are directly contradictory
const CONTRADICTORY_PAIRS = new Set([
  'requires:forbids',
  'forbids:requires',
  'asserts:denies',
  'denies:asserts',
  'implements:denies',
  'denies:implements',
  'requires:denies',
  'denies:requires',
]);

function polarityKey(a: string, b: string): string {
  return `${a}:${b}`;
}

// Subjects are considered the same if they share a significant token
function subjectsOverlap(subjectA: string, subjectB: string): boolean {
  const tokenize = (s: string) =>
    s.toLowerCase().split(/\s+/).filter(t => t.length > 3);

  const tokensA = new Set(tokenize(subjectA));
  const tokensB = tokenize(subjectB);

  return tokensB.some(t => tokensA.has(t));
}

export function detectClaimContradictions(claims: Claim[]): ConflictRecord[] {
  if (claims.length < 2) return [];

  const conflicts: ConflictRecord[] = [];
  const emittedPairs = new Set<string>(); // prevent duplicate pairs

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];

      // Must come from different sources
      if (a.sourceRef.source === b.sourceRef.source) continue;

      // Subjects must overlap
      if (!subjectsOverlap(a.subject, b.subject)) continue;

      // Polarities must be contradictory
      if (!CONTRADICTORY_PAIRS.has(polarityKey(a.polarity, b.polarity))) continue;

      // Avoid duplicate conflict for the same pair (order-independent)
      const pairKey = [a.id, b.id].sort().join(':');
      if (emittedPairs.has(pairKey)) continue;
      emittedPairs.add(pairKey);

      const confidence = Math.min(a.confidence, b.confidence);
      const evidence: ConflictEvidenceRef[] = [a.sourceRef, b.sourceRef];

      conflicts.push({
        id: randomUUID(),
        kind: 'semantic',
        type: 'source_claim_contradiction',
        severity: confidence >= 0.7 ? 'high' : 'medium',
        confidence,
        summary: `Contradiction: "${a.subject}" — ${a.sourceRef.source} ${a.polarity} vs ${b.sourceRef.source} ${b.polarity}`,
        why_it_matters: 'Two evidence sources make incompatible factual claims about the same subject — proceeding silently would ground execution on contradictory truth.',
        scope: {
          claims: [a.sourceRef.excerpt ?? a.subject, b.sourceRef.excerpt ?? b.subject],
        },
        evidence,
        resolution_hint: confidence >= 0.7 ? 'must_block' : 'needs_clarification',
        detector: 'semantic/detect-claim-contradictions',
      });
    }
  }

  return conflicts;
}
