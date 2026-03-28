/**
 * Report Section — Causal Chains
 * Renders the "Why did it happen?" section.
 * Shows primary causal chains, contributing factors.
 * Max 5 chains to avoid spaghetti. Raw event list is expandable.
 */

import type { RunEvidenceBundle, CausalChain, CausalNode, CausalEdge } from '../../types.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderChain(chain: CausalChain, nodes: CausalNode[]): string {
  const nodeMap = new Map<string, CausalNode>(nodes.map(n => [n.node_id, n]));

  const nodeFlowParts: string[] = [];
  for (let i = 0; i < chain.node_ids.length; i++) {
    const node = nodeMap.get(chain.node_ids[i]);
    if (!node) continue;
    const isLast = i === chain.node_ids.length - 1;
    nodeFlowParts.push(
      `<span class="causal-node node-${escapeHtml(node.kind)}">${escapeHtml(node.label)}<small class="node-stage">${escapeHtml(node.stage)}</small></span>`
    );
    if (!isLast) {
      nodeFlowParts.push(`<span class="causal-arrow">→</span>`);
    }
  }

  const nodeFlow = nodeFlowParts.join('\n    ');

  return `<div class="causal-chain ${chain.is_primary ? 'primary-chain' : 'secondary-chain'}">
  <h3>${chain.is_primary ? 'Primary' : 'Contributing'} Chain: ${escapeHtml(chain.chain_id)}</h3>
  <div class="chain-flow">
    ${nodeFlow}
  </div>
</div>`;
}

export function renderCausalitySection(bundle: RunEvidenceBundle): string {
  const { causal_graph, raw_events } = bundle;
  const { nodes, primary_chains, secondary_chains } = causal_graph;

  const chainsToRender: CausalChain[] = [
    ...primary_chains.slice(0, 3),
    ...secondary_chains.slice(0, 2),
  ];

  let chainsHtml: string;
  if (chainsToRender.length === 0) {
    chainsHtml = `<p class="empty">No causal chains could be constructed from available events.</p>`;
  } else {
    chainsHtml = chainsToRender.map(chain => renderChain(chain, nodes)).join('\n');
  }

  const eventRows = raw_events.map(event => {
    const { timestamp, stage, kind, code, severity } = event;
    return `<tr class="kind-${escapeHtml(kind)} ${severity ? 'severity-' + severity : ''}">
  <td class="mono">${escapeHtml(timestamp)}</td>
  <td>${escapeHtml(stage)}</td>
  <td>${escapeHtml(kind)}</td>
  <td class="mono">${code != null ? escapeHtml(code) : '—'}</td>
  <td>${severity != null ? escapeHtml(severity) : '—'}</td>
</tr>`;
  }).join('\n');

  const rawEventsHtml = `<details class="raw-events">
  <summary>Raw Event Log (${raw_events.length} events)</summary>
  <table class="event-table">
    <thead>
      <tr><th>Timestamp</th><th>Stage</th><th>Kind</th><th>Code</th><th>Severity</th></tr>
    </thead>
    <tbody>
      ${eventRows}
    </tbody>
  </table>
</details>`;

  return `<section id="causality" class="report-section">
  <h2>Causal Chains</h2>
  ${chainsHtml}
  ${rawEventsHtml}
</section>`;
}
