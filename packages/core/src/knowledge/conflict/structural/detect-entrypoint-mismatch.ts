// Structural detector: entrypoint mismatch detection.
// Detects when the requested target (from query/spec) does not match the
// reachable implementation path through the graph.

import type { Database } from 'better-sqlite3';
import type { ConflictRecord, ConflictEvidenceRef } from '../types.js';
import { randomUUID } from 'crypto';

// Keywords that indicate a backend/domain intent in the query
const DOMAIN_KEYWORDS = [
  /validat/i, /calculat/i, /process/i, /service/i, /logic/i,
  /backend/i, /server/i, /api/i, /handler/i, /worker/i,
  /payment/i, /auth/i, /order/i, /invoice/i, /pricing/i,
];

// Path patterns indicating display-only / UI-only modules
const UI_ONLY_PATTERNS = [
  /\/components\//, /\/pages\//, /\/views\//, /\/screens\//,
  /\.component\.(ts|tsx|js|jsx)$/, /\.page\.(ts|tsx|js|jsx)$/,
  /\/ui\//, /\/presentation\//,
];

function isDomainQuery(query: string): boolean {
  return DOMAIN_KEYWORDS.some(kw => kw.test(query));
}

function isDisplayOnlyPath(filePath: string): boolean {
  return UI_ONLY_PATTERNS.some(p => p.test(filePath));
}

export function detectEntrypointMismatch(
  touchedPaths: string[],
  query: string,
  db?: Database
): ConflictRecord[] {
  if (!query || touchedPaths.length === 0) return [];

  // Check if query implies domain/backend target but all touched paths are UI-only
  if (!isDomainQuery(query)) return [];

  const allUIOnly = touchedPaths.every(isDisplayOnlyPath);
  if (!allUIOnly) return [];

  const evidence: ConflictEvidenceRef[] = [
    {
      source: 'spec',
      ref: 'query',
      excerpt: `Query implies domain/backend target: "${query.slice(0, 120)}"`,
    },
    ...touchedPaths.map(p => ({
      source: 'code' as const,
      ref: p,
      excerpt: 'Retrieved path is display-layer only — no domain implementation reachable',
    })),
  ];

  return [{
    id: randomUUID(),
    kind: 'structural',
    type: 'entrypoint_mismatch',
    severity: 'block',
    confidence: 0.75,
    summary: `Query targets domain logic but retrieved scope contains only display-layer paths`,
    why_it_matters: 'The requested implementation target is not reachable through the retrieved entry points — modifying display paths will not satisfy the domain requirement.',
    scope: {
      files: touchedPaths,
      claims: [query],
    },
    evidence,
    resolution_hint: 'needs_explore',
    detector: 'structural/detect-entrypoint-mismatch',
  }];
}
