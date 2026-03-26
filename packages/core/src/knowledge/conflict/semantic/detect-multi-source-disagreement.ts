// Semantic detector: multi-source disagreement.
// Finds cases where two or more non-code sources (spec, docs, bug_report, runtime)
// make incompatible claims about the same subject.

import { randomUUID } from 'crypto';
import type { Claim, ConflictRecord, ConflictEvidenceRef } from '../types.js';

const NON_CODE_SOURCES = new Set(['spec', 'bug_report', 'docs', 'runtime']);

// Polarities that represent definite, opposing positions
const ASSERTIVE_POLARITIES = new Set(['asserts', 'requires', 'forbids', 'denies']);

const CONTRADICTORY_PAIRS = new Set([
  'asserts:denies',
  'denies:asserts',
  'requires:forbids',
  'forbids:requires',
  'asserts:forbids',
  'forbids:asserts',
]);

function polarityPair(a: string, b: string): string {
  return `${a}:${b}`;
}

function subjectsOverlap(a: string, b: string): boolean {
  const tokens = (s: string) =>
    s.toLowerCase().split(/[\s_\-]+/).filter(t => t.length > 3);
  const tokensA = new Set(tokens(a));
  return tokens(b).some(t => tokensA.has(t));
}

export function detectMultiSourceDisagreement(claims: Claim[]): ConflictRecord[] {
  if (claims.length < 2) return [];

  const nonCodeClaims = claims.filter(
    c => NON_CODE_SOURCES.has(c.sourceRef.source) && ASSERTIVE_POLARITIES.has(c.polarity)
  );

  if (nonCodeClaims.length < 2) return [];

  const conflicts: ConflictRecord[] = [];
  const emitted = new Set<string>();

  for (let i = 0; i < nonCodeClaims.length; i++) {
    for (let j = i + 1; j < nonCodeClaims.length; j++) {
      const a = nonCodeClaims[i];
      const b = nonCodeClaims[j];

      // Must be different sources
      if (a.sourceRef.source === b.sourceRef.source) continue;
      if (!subjectsOverlap(a.subject, b.subject)) continue;
      if (!CONTRADICTORY_PAIRS.has(polarityPair(a.polarity, b.polarity))) continue;

      const pairKey = [a.id, b.id].sort().join(':');
      if (emitted.has(pairKey)) continue;
      emitted.add(pairKey);

      const confidence = Math.min(a.confidence, b.confidence);
      const evidence: ConflictEvidenceRef[] = [a.sourceRef, b.sourceRef];

      conflicts.push({
        id: randomUUID(),
        kind: 'semantic',
        type: 'multi_source_disagreement',
        severity: confidence >= 0.7 ? 'high' : 'medium',
        confidence,
        summary: `${a.sourceRef.source} and ${b.sourceRef.source} disagree on "${a.subject}"`,
        why_it_matters: 'Non-code sources contradict each other about the same subject — there is no single ground truth to implement against without clarification.',
        scope: {
          claims: [
            a.sourceRef.excerpt ?? a.subject,
            b.sourceRef.excerpt ?? b.subject,
          ],
        },
        evidence,
        resolution_hint: 'needs_clarification',
        detector: 'semantic/detect-multi-source-disagreement',
      });
    }
  }

  return conflicts;
}
