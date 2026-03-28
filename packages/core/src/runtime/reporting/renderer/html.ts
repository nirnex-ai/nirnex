/**
 * Runtime Reporting — Static HTML Renderer
 *
 * Renders RunEvidenceBundle as a self-contained static HTML report.
 * No client-side framework. Minimal vanilla JS for expand/collapse only.
 * JSON bundle embedded as a data island for programmatic access.
 *
 * Design constraints:
 *   - HTML is derived from JSON bundle — never the reverse
 *   - No external resources (self-contained, works offline)
 *   - Semantic HTML with inline CSS (no CSS framework dependency)
 *   - JS limited to accordion expand/collapse and tab navigation
 *   - Integrity issues are visible at the top when present
 *   - Truthful over pretty
 */

import { renderSummarySection } from './sections/summary.js';
import { renderTimelineSection } from './sections/timeline.js';
import { renderFailuresSection } from './sections/failures.js';
import { renderCausalitySection } from './sections/causality.js';
import { renderConfidenceSection } from './sections/confidence.js';
import { renderOptimisationSection } from './sections/optimization.js';
import { renderIntegritySection } from './sections/integrity.js';
import type { RunEvidenceBundle, RunComparison } from '../types.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; font-size: 14px; background: #0f0f0f; color: #e0e0e0; }
.report-header { background: #1a1a1a; border-bottom: 1px solid #333; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
.report-title { font-size: 18px; font-weight: 600; color: #fff; }
.run-id-display { font-size: 12px; color: #888; font-family: monospace; }
nav { background: #1a1a1a; border-bottom: 1px solid #222; padding: 0 24px; display: flex; gap: 0; }
nav a { display: inline-block; padding: 10px 16px; color: #aaa; text-decoration: none; font-size: 13px; border-bottom: 2px solid transparent; }
nav a:hover { color: #fff; border-bottom-color: #555; }
.health-banner { padding: 12px 24px; font-weight: 600; font-size: 14px; }
.health-banner.status-success { background: #0d2a1a; color: #4caf50; border-left: 4px solid #4caf50; }
.health-banner.status-refused, .health-banner.status-blocked { background: #2a0d0d; color: #f44336; border-left: 4px solid #f44336; }
.health-banner.status-escalated { background: #2a1f0d; color: #ff9800; border-left: 4px solid #ff9800; }
.health-banner.status-incomplete { background: #1a1a1a; color: #888; border-left: 4px solid #555; }
.report-main { padding: 24px; max-width: 1200px; margin: 0 auto; }
.report-section { margin-bottom: 40px; padding: 20px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 6px; }
.report-section h2 { font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #333; }
.report-section h3 { font-size: 14px; font-weight: 600; color: #ccc; margin: 16px 0 10px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 8px 10px; background: #222; color: #aaa; font-weight: 500; border-bottom: 1px solid #333; }
td { padding: 7px 10px; border-bottom: 1px solid #1f1f1f; vertical-align: top; }
tr:hover td { background: #1f1f1f; }
.mono { font-family: monospace; font-size: 12px; }
.status-success, .status-ok { color: #4caf50; }
.status-blocked, .status-refused, .status-abandoned { color: #f44336; }
.status-escalated { color: #ff9800; }
.status-degraded { color: #ff9800; }
.status-incomplete { color: #888; }
.severity-critical { color: #f44336; font-weight: 600; }
.severity-error { color: #ef5350; }
.severity-warning { color: #ff9800; }
.severity-info { color: #29b6f6; }
.has-failures { color: #f44336; font-weight: 600; }
.has-warnings { color: #ff9800; }
.integrity-failed { background: #2a0d0d; color: #f44336; padding: 10px 14px; border-radius: 4px; margin-bottom: 12px; font-weight: 600; }
.integrity-ok { background: #0d2a1a; color: #4caf50; padding: 10px 14px; border-radius: 4px; margin-bottom: 12px; }
.integrity-section.integrity-failed { border-color: #f44336; }
.hint-card { background: #222; border: 1px solid #2e2e2e; border-radius: 4px; padding: 14px; margin-bottom: 12px; }
.hint-header { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.hint-confidence.high { color: #f44336; }
.hint-confidence.medium { color: #ff9800; }
.hint-confidence.low { color: #29b6f6; }
.rule-notice { color: #888; font-size: 12px; margin-bottom: 16px; font-style: italic; }
.observation { color: #e0e0e0; margin-bottom: 6px; }
.evidence-basis { color: #aaa; font-size: 12px; }
.causal-chain { margin-bottom: 16px; padding: 12px; background: #222; border-radius: 4px; }
.primary-chain { border-left: 3px solid #4caf50; }
.secondary-chain { border-left: 3px solid #555; }
.chain-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; }
.causal-node { display: inline-flex; flex-direction: column; align-items: center; padding: 6px 10px; border-radius: 4px; font-size: 12px; background: #2a2a2a; border: 1px solid #333; max-width: 160px; text-align: center; }
.node-outcome { border-color: #4caf50; }
.node-failure { border-color: #f44336; }
.node-decision { border-color: #29b6f6; }
.node-penalty { border-color: #ff9800; }
.causal-arrow { color: #555; font-size: 18px; }
.node-stage { color: #666; font-size: 10px; margin-top: 2px; }
.evidence-category { margin-bottom: 12px; }
.evidence-category.has-issues strong { color: #ff9800; }
.band-high { color: #4caf50; }
.band-moderate { color: #8bc34a; }
.band-low { color: #ff9800; }
.band-very_low { color: #f44336; }
.band-blocked { color: #f44336; font-weight: 600; }
.delta-positive { color: #4caf50; }
.delta-negative { color: #f44336; }
.delta-neutral { color: #888; }
.comparison-section { border-color: #333; }
details summary { cursor: pointer; color: #aaa; font-size: 13px; padding: 6px 0; }
details summary:hover { color: #fff; }
.empty { color: #555; font-style: italic; font-size: 13px; }
.subsystem { background: #2a2a2a; color: #888; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-family: monospace; }
.rule-id { color: #29b6f6; font-size: 11px; }
.integrity-detail { margin-top: 8px; color: #aaa; font-size: 12px; }
.integrity-detail code { background: #222; padding: 1px 4px; border-radius: 3px; }
`.trim();

function getBannerMessage(bundle: RunEvidenceBundle): string {
  const { final_status, lane, stop_condition } = bundle.summary;
  const confidence = bundle.confidence.band;

  switch (final_status) {
    case 'success':
      return `Run completed successfully. Lane: ${lane ?? '—'}. Confidence: ${confidence}.`;
    case 'refused':
      return `Run refused by policy. Stop condition: ${stop_condition ?? '—'}.`;
    case 'blocked':
      return `Run blocked. Stop condition: ${stop_condition ?? '—'}.`;
    case 'escalated':
      return `Run escalated. Lane: ${lane ?? '—'}.`;
    case 'abandoned':
      return `Run abandoned.`;
    case 'incomplete':
    default:
      return `Run data is incomplete.`;
  }
}

function renderComparisonSection(comparison: RunComparison): string {
  const { baseline_run_id, current_run_id, deltas, regression_findings } = comparison;

  const deltaRows: string[] = [];

  if (deltas.duration_ms != null) {
    const { baseline, current, direction } = deltas.duration_ms;
    deltaRows.push(`<tr>
  <td>Duration (ms)</td>
  <td>${baseline}</td>
  <td>${current}</td>
  <td class="${direction === 'improved' ? 'delta-positive' : direction === 'degraded' ? 'delta-negative' : 'delta-neutral'}">${direction}</td>
</tr>`);
  }

  if (deltas.confidence != null) {
    const { baseline, current, direction } = deltas.confidence;
    deltaRows.push(`<tr>
  <td>Confidence</td>
  <td>${baseline}</td>
  <td>${current}</td>
  <td class="${direction === 'improved' ? 'delta-positive' : direction === 'degraded' ? 'delta-negative' : 'delta-neutral'}">${direction}</td>
</tr>`);
  }

  if (deltas.failure_count != null) {
    const { baseline, current, direction } = deltas.failure_count;
    deltaRows.push(`<tr>
  <td>Failure Count</td>
  <td>${baseline}</td>
  <td>${current}</td>
  <td class="${direction === 'improved' ? 'delta-positive' : direction === 'degraded' ? 'delta-negative' : 'delta-neutral'}">${direction}</td>
</tr>`);
  }

  if (deltas.lane != null) {
    const { baseline, current, direction } = deltas.lane;
    deltaRows.push(`<tr>
  <td>Lane</td>
  <td>${escapeHtml(baseline)}</td>
  <td>${escapeHtml(current)}</td>
  <td class="${direction === 'improved' ? 'delta-positive' : direction === 'degraded' ? 'delta-negative' : 'delta-neutral'}">${direction}</td>
</tr>`);
  }

  if (deltas.override_count != null) {
    const { baseline, current, direction } = deltas.override_count;
    deltaRows.push(`<tr>
  <td>Override Count</td>
  <td>${baseline}</td>
  <td>${current}</td>
  <td class="${direction === 'improved' ? 'delta-positive' : direction === 'degraded' ? 'delta-negative' : 'delta-neutral'}">${direction}</td>
</tr>`);
  }

  const regressionHtml = regression_findings.length > 0
    ? `<div class="hint-card"><strong>Regression Findings:</strong><ul>${regression_findings.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>`
    : '';

  return `<section id="comparison" class="report-section comparison-section">
  <h2>Run Comparison</h2>
  <p>Baseline: <code class="mono">${escapeHtml(baseline_run_id)}</code> vs Current: <code class="mono">${escapeHtml(current_run_id)}</code></p>
  <table>
    <thead><tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Direction</th></tr></thead>
    <tbody>
      ${deltaRows.join('\n      ')}
    </tbody>
  </table>
  ${regressionHtml}
</section>`;
}

export function renderHtml(bundle: RunEvidenceBundle): string {
  const { run_id, generated_at } = bundle;
  const { final_status } = bundle.summary;
  const integrity = bundle.integrity;

  const integrityWarningBanner = integrity.valid === false
    ? `<div style="background:#2a0d0d;color:#f44336;padding:10px 24px;font-size:13px;"><strong>⚠ Report Integrity Warning:</strong> This report has validation issues. Some data may be incomplete. See the Integrity section for details.</div>`
    : '';

  const comparisonNavLink = bundle.comparison ? `<a href="#comparison">Comparison</a>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nirnex Run Report — ${escapeHtml(run_id)}</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="report-header">
    <div>
      <div class="report-title">Nirnex Run Report</div>
      <div class="run-id-display">${escapeHtml(run_id)}</div>
    </div>
    <div style="margin-left: auto; color: #666; font-size: 12px;">Generated: ${escapeHtml(generated_at)}</div>
  </header>

  <nav>
    <a href="#summary">Summary</a>
    <a href="#timeline">Timeline</a>
    <a href="#failures">Failures</a>
    <a href="#causality">Causality</a>
    <a href="#confidence">Confidence</a>
    <a href="#optimisation">Hints</a>
    <a href="#integrity">Integrity</a>
    ${comparisonNavLink}
  </nav>

  <div class="health-banner status-${escapeHtml(final_status)}">
    ${getBannerMessage(bundle)}
  </div>

  ${integrityWarningBanner}

  <main class="report-main">
    ${renderSummarySection(bundle)}
    ${renderTimelineSection(bundle)}
    ${renderFailuresSection(bundle)}
    ${renderCausalitySection(bundle)}
    ${renderConfidenceSection(bundle)}
    ${renderOptimisationSection(bundle)}
    ${renderIntegritySection(bundle)}
    ${bundle.comparison ? renderComparisonSection(bundle.comparison) : ''}
  </main>

  <script type="application/json" id="nirnex-bundle">
  ${JSON.stringify(bundle, null, 2)}
  </script>

  <script>
  // Minimal: smooth scroll for nav links
  document.querySelectorAll('nav a[href^="#"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      var target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
    });
  });
  </script>
</body>
</html>`;
}
