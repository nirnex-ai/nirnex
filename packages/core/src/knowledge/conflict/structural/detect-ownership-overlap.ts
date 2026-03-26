// Structural detector: ownership overlap detection.
// Detects when the requested scope spans multiple architectural ownership zones,
// implying conflicting responsibility (e.g., API layer vs UI layer, domain vs generated).

import type { ConflictRecord, ConflictEvidenceRef } from '../types.js';
import { randomUUID } from 'crypto';

// Ownership zones by path pattern — deterministic, no inference.
type OwnershipZone = {
  name: string;
  patterns: RegExp[];
  description: string;
};

const OWNERSHIP_ZONES: OwnershipZone[] = [
  {
    name: 'api_contract',
    patterns: [/\/api\//, /\/routes\//, /\/controllers\//, /\.route\.(ts|js)$/, /\.controller\.(ts|js)$/],
    description: 'API contract layer (routes, controllers)',
  },
  {
    name: 'domain_core',
    patterns: [/\/domain\//, /\/core\//, /\/services\//, /\/use-cases\//, /\/usecases\//],
    description: 'Domain core / business logic',
  },
  {
    name: 'feature_ui',
    patterns: [/\/components\//, /\/pages\//, /\/views\//, /\/screens\//, /\.component\.(ts|tsx|js|jsx)$/, /\.page\.(ts|tsx|js|jsx)$/],
    description: 'Feature UI layer (components, pages)',
  },
  {
    name: 'generated_code',
    patterns: [/\/generated\//, /\/gen\//, /\.generated\.(ts|js)$/, /\/__generated__\//],
    description: 'Generated / auto-maintained code',
  },
  {
    name: 'app_shell',
    patterns: [/\/app\//, /\/shell\//, /\/layout\//, /\/providers\//],
    description: 'Application shell / provider layer',
  },
  {
    name: 'infrastructure',
    patterns: [/\/infra\//, /\/infrastructure\//, /\/db\//, /\/database\//, /\/migrations\//],
    description: 'Infrastructure / persistence layer',
  },
];

function classifyPath(filePath: string): OwnershipZone | null {
  for (const zone of OWNERSHIP_ZONES) {
    if (zone.patterns.some(pattern => pattern.test(filePath))) {
      return zone;
    }
  }
  return null;
}

export function detectOwnershipOverlap(
  touchedPaths: string[]
): ConflictRecord[] {
  if (touchedPaths.length === 0) return [];

  const zoneMap = new Map<string, { zone: OwnershipZone; files: string[] }>();

  for (const filePath of touchedPaths) {
    const zone = classifyPath(filePath);
    if (!zone) continue;

    if (!zoneMap.has(zone.name)) {
      zoneMap.set(zone.name, { zone, files: [] });
    }
    zoneMap.get(zone.name)!.files.push(filePath);
  }

  const occupiedZones = [...zoneMap.values()];
  if (occupiedZones.length < 2) return [];

  // Only emit conflict if incompatible zone pairs are present
  const incompatiblePairs: Array<[string, string]> = [
    ['api_contract', 'feature_ui'],
    ['domain_core', 'feature_ui'],
    ['domain_core', 'app_shell'],
    ['generated_code', 'domain_core'],
    ['generated_code', 'api_contract'],
    ['infrastructure', 'feature_ui'],
  ];

  const occupiedNames = new Set(occupiedZones.map(z => z.zone.name));
  const conflictingPairs = incompatiblePairs.filter(
    ([a, b]) => occupiedNames.has(a) && occupiedNames.has(b)
  );

  if (conflictingPairs.length === 0) return [];

  const conflicts: ConflictRecord[] = [];

  for (const [zoneA, zoneB] of conflictingPairs) {
    const entryA = zoneMap.get(zoneA)!;
    const entryB = zoneMap.get(zoneB)!;

    const allFiles = [...entryA.files, ...entryB.files];

    const evidence: ConflictEvidenceRef[] = allFiles.map(f => ({
      source: 'code' as const,
      ref: f,
      excerpt: `Member of ownership zone: ${classifyPath(f)?.name}`,
    }));

    conflicts.push({
      id: randomUUID(),
      kind: 'structural',
      type: 'ownership_overlap',
      severity: 'high',
      confidence: 0.8,
      summary: `Scope spans incompatible ownership zones: ${entryA.zone.description} × ${entryB.zone.description}`,
      why_it_matters: 'A change that crosses architectural ownership boundaries creates ambiguous responsibility and unsafe edit zones — bounded execution requires a single owning zone.',
      scope: {
        files: allFiles,
        modules: [entryA.zone.name, entryB.zone.name],
      },
      evidence,
      resolution_hint: 'needs_clarification',
      detector: 'structural/detect-ownership-overlap',
    });
  }

  return conflicts;
}
