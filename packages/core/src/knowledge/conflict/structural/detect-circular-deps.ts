// Structural detector: circular dependency detection.
// Uses the SQLite graph (edges table) to find cycles that touch the requested scope.

import type { Database } from 'better-sqlite3';
import type { ConflictRecord, ConflictEvidenceRef } from '../types.js';
import { randomUUID } from 'crypto';

type EdgeRow = { from_path: string; to_path: string };

function buildAdjacencyList(edges: EdgeRow[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const { from_path, to_path } of edges) {
    if (!graph.has(from_path)) graph.set(from_path, new Set());
    graph.get(from_path)!.add(to_path);
  }
  return graph;
}

// DFS-based cycle detection. Returns the first cycle path found, or null.
function findCycle(
  graph: Map<string, Set<string>>,
  startNodes: string[]
): string[] | null {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    if (stack.has(node)) {
      // Found a cycle — capture the cycle path from where we entered
      const cycleStart = path.indexOf(node);
      return true; // signal to caller
    }
    if (visited.has(node)) return false;

    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (dfs(neighbor)) return true;
    }

    stack.delete(node);
    path.pop();
    return false;
  }

  for (const node of startNodes) {
    if (!visited.has(node)) {
      if (dfs(node)) {
        return [...path];
      }
    }
  }

  return null;
}

export function detectCircularDeps(
  touchedPaths: string[],
  db?: Database
): ConflictRecord[] {
  if (!db || touchedPaths.length === 0) return [];

  let edges: EdgeRow[] = [];
  try {
    edges = db.prepare(`
      SELECT m_from.path AS from_path, m_to.path AS to_path
      FROM edges e
      JOIN modules m_from ON m_from.id = e.from_id
      JOIN modules m_to ON m_to.id = e.to_id
      WHERE m_from.tier = 'FULL'
    `).all() as EdgeRow[];
  } catch {
    return [];
  }

  if (edges.length === 0) return [];

  const graph = buildAdjacencyList(edges);
  const cyclePath = findCycle(graph, touchedPaths);

  if (!cyclePath || cyclePath.length === 0) return [];

  // Only emit if the cycle intersects the touched scope
  const touchedSet = new Set(touchedPaths);
  const cycleIntersectsTouched = cyclePath.some(p => touchedSet.has(p));
  if (!cycleIntersectsTouched) return [];

  const evidence: ConflictEvidenceRef[] = cyclePath.map(p => ({
    source: 'graph' as const,
    ref: p,
    excerpt: `Part of circular dependency chain`,
  }));

  return [{
    id: randomUUID(),
    kind: 'structural',
    type: 'circular_dependency',
    severity: 'block',
    confidence: 0.95,
    summary: `Circular dependency detected through ${cyclePath.length} modules`,
    why_it_matters: 'A cycle in the dependency graph makes bounded execution unsafe — changes propagate unpredictably through the loop.',
    scope: {
      files: cyclePath,
      modules: cyclePath,
    },
    evidence,
    resolution_hint: 'must_block',
    detector: 'structural/detect-circular-deps',
  }];
}
