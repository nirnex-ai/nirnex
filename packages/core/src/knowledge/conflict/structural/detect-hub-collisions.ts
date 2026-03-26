// Structural detector: hub collision detection.
// Emits a conflict when the requested scope touches high-centrality hub nodes,
// creating competing dependency pressure that makes bounded execution unsafe.

import type { Database } from 'better-sqlite3';
import type { ConflictRecord, ConflictEvidenceRef } from '../types.js';
import { randomUUID } from 'crypto';

type HubRow = { path: string; inbound_count: number };

export function detectHubCollisions(
  touchedPaths: string[],
  hubNodes: string[],
  db?: Database
): ConflictRecord[] {
  if (touchedPaths.length === 0) return [];

  // Prefer live DB query for inbound counts, fall back to ECO-provided hubNodes list
  let hubsInScope: Array<{ path: string; inbound_count: number }> = [];

  if (db) {
    try {
      const rows = db.prepare(`
        SELECT m.path, COUNT(e.from_id) AS inbound_count
        FROM modules m
        LEFT JOIN edges e ON e.to_id = m.id
        WHERE m.is_hub = 1
        GROUP BY m.id
      `).all() as HubRow[];

      const touchedSet = new Set(touchedPaths);
      hubsInScope = rows.filter(r => touchedSet.has(r.path));
    } catch {
      // Fall through to ECO-provided list
    }
  }

  // If no DB data, fall back to ECO hub_nodes_in_path
  if (hubsInScope.length === 0 && hubNodes.length > 0) {
    const touchedSet = new Set(touchedPaths);
    hubsInScope = hubNodes
      .filter(h => touchedSet.has(h))
      .map(h => ({ path: h, inbound_count: 51 })); // unknown exact count; threshold exceeded by definition
  }

  if (hubsInScope.length === 0) return [];

  const conflicts: ConflictRecord[] = [];

  for (const hub of hubsInScope) {
    const evidence: ConflictEvidenceRef[] = [
      {
        source: 'graph',
        ref: hub.path,
        excerpt: `Hub node with ${hub.inbound_count} inbound edges — broad blast radius`,
      },
      {
        source: 'index',
        ref: hub.path,
        excerpt: `Marked is_hub=1 by graph analysis`,
      },
    ];

    conflicts.push({
      id: randomUUID(),
      kind: 'structural',
      type: 'hub_collision',
      severity: 'high',
      confidence: 0.85,
      summary: `Scope touches hub node: ${hub.path} (${hub.inbound_count} inbound edges)`,
      why_it_matters: 'Modifying a high-centrality hub creates competing dependency pressure across all dependents — the blast radius exceeds a bounded edit zone.',
      scope: {
        files: [hub.path],
        modules: [hub.path],
      },
      evidence,
      resolution_hint: 'needs_explore',
      detector: 'structural/detect-hub-collisions',
    });
  }

  return conflicts;
}
