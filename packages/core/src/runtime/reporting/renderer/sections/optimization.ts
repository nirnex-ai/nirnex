/**
 * Report Section — Optimisation Hints
 * Renders rule-based improvement suggestions.
 * Clearly marked as rule-based inference, not root cause certainty.
 */

import type { RunEvidenceBundle, OptimisationHint } from '../../types.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHintCard(hint: OptimisationHint): string {
  const { rule_id, observation, evidence_basis, hint_confidence, subsystem } = hint;
  return `<div class="hint-card hint-confidence-${hint_confidence}">
  <div class="hint-header">
    <span class="rule-id mono">${escapeHtml(rule_id)}</span>
    <span class="hint-confidence ${hint_confidence}">${hint_confidence.toUpperCase()} CONFIDENCE</span>
    <span class="subsystem">${escapeHtml(subsystem)}</span>
  </div>
  <p class="observation">${escapeHtml(observation)}</p>
  <p class="evidence-basis"><strong>Evidence basis:</strong> ${escapeHtml(evidence_basis)}</p>
</div>`;
}

export function renderOptimisationSection(bundle: RunEvidenceBundle): string {
  const hints = bundle.optimisation_hints;

  const hintCards = hints.length === 0
    ? `<p class="empty">No optimisation hints generated for this run.</p>`
    : hints.map(renderHintCard).join('\n');

  return `<section id="optimisation" class="report-section">
  <h2>Optimisation Hints</h2>
  <p class="rule-notice">These hints are rule-based observations derived from structured run data. They suggest probable improvement paths — not root cause certainties.</p>
  ${hintCards}
</section>`;
}
