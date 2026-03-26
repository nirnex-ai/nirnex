// Semantic detector: spec-code divergence.
// Finds cases where the spec/bug-report claims something exists in code,
// but the code evidence shows it is absent or contradicts the spec claim.

import { randomUUID } from 'crypto';
import type { Claim, ConflictRecord, ConflictEvidenceRef } from '../types.js';

// Code claims that assert presence of logic
const CODE_PRESENCE_POLARITIES = new Set(['asserts', 'implements']);

// Spec/doc claims that assert something should exist or already exists
const SPEC_ASSERTION_POLARITIES = new Set(['asserts', 'requires']);

// Code claims that deny presence
const CODE_DENIAL_POLARITIES = new Set(['denies', 'missing']);

function isSpecClaim(claim: Claim): boolean {
  return claim.sourceRef.source === 'spec' || claim.sourceRef.source === 'bug_report';
}

function isCodeClaim(claim: Claim): boolean {
  return claim.sourceRef.source === 'code' || claim.sourceRef.source === 'index';
}

// Check if subjects substantially overlap
function subjectsOverlap(a: string, b: string): boolean {
  const tokens = (s: string) =>
    s.toLowerCase().split(/[\s_-]+/).filter(t => t.length > 3);
  const tokensA = new Set(tokens(a));
  return tokens(b).some(t => tokensA.has(t));
}

export function detectSpecCodeDivergence(claims: Claim[]): ConflictRecord[] {
  if (claims.length < 2) return [];

  const specClaims = claims.filter(
    c => isSpecClaim(c) && SPEC_ASSERTION_POLARITIES.has(c.polarity)
  );
  const codeDenials = claims.filter(
    c => isCodeClaim(c) && CODE_DENIAL_POLARITIES.has(c.polarity)
  );

  const conflicts: ConflictRecord[] = [];
  const emitted = new Set<string>();

  for (const spec of specClaims) {
    for (const code of codeDenials) {
      if (!subjectsOverlap(spec.subject, code.subject)) continue;

      const pairKey = [spec.id, code.id].sort().join(':');
      if (emitted.has(pairKey)) continue;
      emitted.add(pairKey);

      const confidence = Math.min(spec.confidence, code.confidence);

      const evidence: ConflictEvidenceRef[] = [spec.sourceRef, code.sourceRef];

      conflicts.push({
        id: randomUUID(),
        kind: 'semantic',
        type: 'spec_code_divergence',
        severity: 'high',
        confidence,
        summary: `Spec asserts "${spec.subject}" exists; code shows it is absent or missing`,
        why_it_matters: 'The acceptance criteria or stop conditions derived from the spec cannot be verified when the code shows the referenced logic does not exist in the reachable path.',
        scope: {
          claims: [
            spec.sourceRef.excerpt ?? spec.subject,
            code.sourceRef.excerpt ?? code.subject,
          ],
        },
        evidence,
        resolution_hint: 'needs_explore',
        detector: 'semantic/detect-spec-code-divergence',
      });
    }
  }

  return conflicts;
}
