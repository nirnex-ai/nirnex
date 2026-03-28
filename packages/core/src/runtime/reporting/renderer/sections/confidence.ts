/**
 * Report Section — Confidence & Evidence
 * Renders confidence evolution, dimension breakdown, and evidence health.
 */

import { RunEvidenceBundle } from '../../types.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderConfidenceSection(bundle: RunEvidenceBundle): string {
  const conf = bundle.confidence;
  const health = bundle.knowledge_health;

  // ── 1. Confidence Summary ──────────────────────────────────────────────────
  const lane = conf.lane != null ? escapeHtml(conf.lane) : '—';
  const band = escapeHtml(conf.band);

  const confidenceSummary = `  <div class="confidence-summary">
    <table class="summary-table">
      <tr><th>Overall Confidence</th><td>${conf.overall_confidence}</td></tr>
      <tr><th>Effective Confidence</th><td>${conf.effective_confidence}</td></tr>
      <tr><th>Band</th><td class="band-${band}">${band}</td></tr>
      <tr><th>Lane</th><td>${lane}</td></tr>
    </table>
  </div>`;

  // ── 2. Dimension Breakdown ─────────────────────────────────────────────────
  const dimensionRows = Object.entries(conf.dimensions).map(([dim, score]) => {
    const scoreDisplay = score === 'uncomputed' ? 'uncomputed' : String(score);
    return `        <tr>
          <td>${escapeHtml(dim)}</td>
          <td>${escapeHtml(scoreDisplay)}</td>
        </tr>`;
  }).join('\n');

  const dimensionBreakdown = `  <div class="dimensions">
    <h3>Dimension Scores</h3>
    <table class="dimension-table">
      <thead><tr><th>Dimension</th><th>Score</th></tr></thead>
      <tbody>
${dimensionRows}
      </tbody>
    </table>
  </div>`;

  // ── 3. Evidence Health ─────────────────────────────────────────────────────
  const absent = health.absent_evidence;
  const conflicting = health.conflicting_evidence;
  const stale = health.stale_evidence;
  const weak = health.weak_evidence;

  const renderEvidenceList = (items: typeof absent): string => {
    if (items.length === 0) return '<p>None</p>';
    return '<ul>' + items.map(e => `<li>${escapeHtml(e.description)}</li>`).join('') + '</ul>';
  };

  const evidenceHealth = `  <div class="evidence-health">
    <h3>Evidence Health</h3>
    <div class="evidence-category ${absent.length > 0 ? 'has-issues' : ''}">
      <strong>Absent Evidence (${absent.length})</strong>
      ${renderEvidenceList(absent)}
    </div>
    <div class="evidence-category ${conflicting.length > 0 ? 'has-issues' : ''}">
      <strong>Conflicting Evidence (${conflicting.length})</strong>
      ${renderEvidenceList(conflicting)}
    </div>
    <div class="evidence-category ${stale.length > 0 ? 'has-issues' : ''}">
      <strong>Stale Evidence (${stale.length})</strong>
      ${renderEvidenceList(stale)}
    </div>
    <div class="evidence-category ${weak.length > 0 ? 'has-issues' : ''}">
      <strong>Weak Evidence (${weak.length})</strong>
      ${renderEvidenceList(weak)}
    </div>
  </div>`;

  // ── 4. Confidence Checkpoints ──────────────────────────────────────────────
  const checkpointRows = conf.checkpoints.map((cp, idx) => {
    const delta = cp.delta;
    let deltaDisplay = '—';
    let deltaClass = '';
    if (delta != null) {
      if (delta > 0) {
        deltaDisplay = `+${delta}`;
        deltaClass = 'delta-positive';
      } else if (delta < 0) {
        deltaDisplay = String(delta);
        deltaClass = 'delta-negative';
      } else {
        deltaDisplay = '0';
        deltaClass = 'delta-neutral';
      }
    }

    return `        <tr>
          <td>${cp.snapshot_index}</td>
          <td>${escapeHtml(cp.trigger)}</td>
          <td>${escapeHtml(cp.stage_name)}</td>
          <td>${cp.computed_confidence}</td>
          <td>${cp.effective_confidence}</td>
          <td>${escapeHtml(cp.band)}</td>
          <td class="${deltaClass}">${deltaDisplay}</td>
        </tr>`;
  }).join('\n');

  const checkpoints = `  <div class="checkpoints">
    <h3>Confidence Evolution</h3>
    <table>
      <thead><tr><th>#</th><th>Trigger</th><th>Stage</th><th>Computed</th><th>Effective</th><th>Band</th><th>Delta</th></tr></thead>
      <tbody>
${checkpointRows}
      </tbody>
    </table>
  </div>`;

  return `<section id="confidence" class="report-section">
  <h2>Confidence &amp; Evidence</h2>
${confidenceSummary}
${dimensionBreakdown}
${evidenceHealth}
${checkpoints}
</section>`;
}
