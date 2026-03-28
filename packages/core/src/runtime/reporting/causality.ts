/**
 * Runtime Reporting — Causality
 *
 * Builds causal graphs from normalized ReportEvent arrays.
 * Uses parent_ledger_id chains, derived_from_entry_ids, and explicit causes arrays.
 *
 * Design constraints:
 *   - Causal graph is built from emitted event data — not inferred
 *   - All edges are typed with CausalRelationship
 *   - Primary chains are those ending at outcome or critical failure nodes
 *   - Max chain depth capped to prevent degenerate graphs
 *   - Graph is read-only after construction
 */

import {
  ReportEvent,
  CausalNode,
  CausalEdge,
  CausalChain,
  CausalGraph,
  CausalRelationship,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CHAIN_DEPTH = 10;
const MAX_CHAINS = 5;

// ─── Internal helpers ─────────────────────────────────────────────────────────

type NodeKind = CausalNode['kind'];

function mapEventKindToNodeKind(kind: string): NodeKind {
  switch (kind) {
    case 'outcome':
      return 'outcome';
    case 'refusal':
    case 'deviation':
      return 'failure';
    case 'confidence_snapshot':
      return 'penalty';
    case 'decision':
    case 'steering_applied':
    case 'override':
      return 'decision';
    default:
      return 'observation';
  }
}

function resolveRelationship(
  fromKind: NodeKind,
  toKind: NodeKind,
): CausalRelationship {
  if (toKind === 'outcome' && fromKind === 'failure') return 'blocked';
  if (toKind === 'failure' && fromKind === 'decision') return 'triggered';
  if (toKind === 'penalty' && fromKind === 'decision') return 'triggered';
  if (toKind === 'decision' && fromKind === 'observation') return 'contributed_to';
  if (toKind === 'outcome') return 'contributed_to';
  return 'contributed_to';
}

// ─── buildCausalGraph ─────────────────────────────────────────────────────────

/**
 * Build a causal graph from a normalized array of ReportEvents.
 * Nodes are built from events; edges are built from the `causes` arrays.
 * Primary chains are found after graph construction.
 */
export function buildCausalGraph(events: ReportEvent[]): CausalGraph {
  // Index events by event_id for fast lookup
  const eventMap = new Map<string, ReportEvent>();
  for (const event of events) {
    eventMap.set(event.event_id, event);
  }

  // Build nodes
  const nodes: CausalNode[] = events.map((event): CausalNode => {
    const nodeKind = mapEventKindToNodeKind(event.kind);
    return {
      node_id: event.event_id,
      kind: nodeKind,
      code: event.code,
      label: event.code ?? event.kind,
      stage: event.stage,
      timestamp: event.timestamp,
    };
  });

  // Index nodes by node_id for edge resolution
  const nodeMap = new Map<string, CausalNode>();
  for (const node of nodes) {
    nodeMap.set(node.node_id, node);
  }

  // Build edges from causes arrays
  const edges: CausalEdge[] = [];
  const seenEdges = new Set<string>();

  for (const event of events) {
    const toNode = nodeMap.get(event.event_id);
    if (!toNode) continue;

    for (const causeId of event.causes) {
      if (!eventMap.has(causeId)) continue;

      const fromNode = nodeMap.get(causeId);
      if (!fromNode) continue;

      const edgeKey = `${causeId}→${event.event_id}`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);

      const relationship = resolveRelationship(fromNode.kind, toNode.kind);
      edges.push({
        from_node_id: causeId,
        to_node_id: event.event_id,
        relationship,
      });
    }
  }

  const graph: CausalGraph = {
    nodes,
    edges,
    primary_chains: [],
    secondary_chains: [],
  };

  // Find chains and partition into primary/secondary
  const allChains = findPrimaryChains(graph);
  graph.primary_chains = allChains.filter((c) => c.is_primary);
  graph.secondary_chains = allChains.filter((c) => !c.is_primary);

  return graph;
}

// ─── findPrimaryChains ────────────────────────────────────────────────────────

/**
 * Find chains ending at outcome or failure nodes.
 * Returns primary chains first, then sorted by length descending.
 * Returns at most MAX_CHAINS chains total.
 */
export function findPrimaryChains(graph: CausalGraph): CausalChain[] {
  const nodeMap = new Map<string, CausalNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.node_id, node);
  }

  // Build adjacency: outgoing edges per node
  const outgoing = new Map<string, string[]>();
  // Build adjacency: incoming edges per node (for reverse traversal)
  const incoming = new Map<string, string[]>();

  for (const node of graph.nodes) {
    outgoing.set(node.node_id, []);
    incoming.set(node.node_id, []);
  }
  for (const edge of graph.edges) {
    outgoing.get(edge.from_node_id)?.push(edge.to_node_id);
    incoming.get(edge.to_node_id)?.push(edge.from_node_id);
  }

  // Identify terminal nodes: kind 'outcome' or 'failure', or nodes with no outgoing edges
  const terminalNodes = graph.nodes.filter((node) => {
    const isOutcomeOrFailure = node.kind === 'outcome' || node.kind === 'failure';
    const hasNoOutgoing = (outgoing.get(node.node_id) ?? []).length === 0;
    return isOutcomeOrFailure || hasNoOutgoing;
  });

  // Build a chain for each terminal node
  const chains: CausalChain[] = [];
  for (const terminal of terminalNodes) {
    const chain = buildCausalChain(graph, terminal.node_id);
    if (chain !== null) {
      chains.push(chain);
    }
  }

  // Sort: primary chains first, then by length descending
  chains.sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return b.node_ids.length - a.node_ids.length;
  });

  return chains.slice(0, MAX_CHAINS);
}

// ─── buildCausalChain ─────────────────────────────────────────────────────────

/**
 * Build a single causal chain ending at terminalNodeId.
 * Traces backwards through incoming edges to find the root.
 * Returns null if the node is not found or the chain is degenerate.
 */
export function buildCausalChain(
  graph: CausalGraph,
  terminalNodeId: string,
): CausalChain | null {
  const nodeMap = new Map<string, CausalNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.node_id, node);
  }

  if (!nodeMap.has(terminalNodeId)) return null;

  // Build reverse adjacency: incoming edges per node
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) {
    incoming.set(node.node_id, []);
  }
  for (const edge of graph.edges) {
    incoming.get(edge.to_node_id)?.push(edge.from_node_id);
  }

  // Reverse BFS from terminal to root, collecting the path
  // We collect nodes in reverse order (terminal → root) then reverse at the end
  const visited = new Set<string>();
  const pathReversed: string[] = [];
  const queue: string[] = [terminalNodeId];
  visited.add(terminalNodeId);

  while (queue.length > 0 && pathReversed.length < MAX_CHAIN_DEPTH) {
    const current = queue.shift()!;
    pathReversed.push(current);

    const parents = incoming.get(current) ?? [];
    for (const parentId of parents) {
      if (!visited.has(parentId)) {
        visited.add(parentId);
        queue.push(parentId);
      }
    }
  }

  // Degenerate: single node with no edges connecting to or from it
  if (pathReversed.length === 1) {
    const nodeEdges = graph.edges.filter(
      (e) => e.from_node_id === terminalNodeId || e.to_node_id === terminalNodeId,
    );
    if (nodeEdges.length === 0) return null;
  }

  // Reverse to get root → terminal order
  const nodeIds = pathReversed.reverse();

  // Collect edges relevant to this chain
  const nodeIdSet = new Set(nodeIds);
  const chainEdges = graph.edges.filter(
    (e) => nodeIdSet.has(e.from_node_id) && nodeIdSet.has(e.to_node_id),
  );

  const rootNodeId = nodeIds[0];
  const terminalNode = nodeMap.get(terminalNodeId);
  const isPrimary = terminalNode?.kind === 'outcome';

  return {
    chain_id: `chain_${terminalNodeId.slice(0, 8)}`,
    root_node_id: rootNodeId,
    terminal_node_id: terminalNodeId,
    node_ids: nodeIds,
    edges: chainEdges,
    is_primary: isPrimary ?? false,
  };
}

// ─── extractCausalContext ─────────────────────────────────────────────────────

/**
 * Get the immediate causal context for a specific event (1-hop).
 * ancestors: nodes that contributed to this event
 * descendants: nodes that this event contributed to
 */
export function extractCausalContext(
  graph: CausalGraph,
  eventId: string,
): { ancestors: CausalNode[]; descendants: CausalNode[] } {
  const nodeMap = new Map<string, CausalNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.node_id, node);
  }

  const ancestors: CausalNode[] = [];
  const descendants: CausalNode[] = [];

  for (const edge of graph.edges) {
    if (edge.to_node_id === eventId) {
      const ancestor = nodeMap.get(edge.from_node_id);
      if (ancestor) ancestors.push(ancestor);
    }
    if (edge.from_node_id === eventId) {
      const descendant = nodeMap.get(edge.to_node_id);
      if (descendant) descendants.push(descendant);
    }
  }

  return { ancestors, descendants };
}
