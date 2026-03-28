/**
 * Report Section — Report Integrity
 * Shows what validation found, making honesty visible.
 * A report that fails integrity checks shows a prominent warning.
 */

import type { RunEvidenceBundle, ReportIntegrityResult, ReportValidationIssue } from '../../types.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderIssueRow(issue: ReportValidationIssue): string {
  const { kind, severity, message, affected_id } = issue;
  return `<tr class="issue-${severity}">
  <td class="mono">${escapeHtml(kind)}</td>
  <td class="severity-${severity}">${severity.toUpperCase()}</td>
  <td>${escapeHtml(message)}</td>
  <td class="mono">${affected_id != null ? escapeHtml(affected_id) : '—'}</td>
</tr>`;
}

export function renderIntegritySection(bundle: RunEvidenceBundle): string {
  const integrity: ReportIntegrityResult = bundle.integrity;
  const { valid, issues, missing_stages, broken_causal_refs, unclassified_failure_codes } = integrity;

  const validationBanner = valid
    ? `<div class="integrity-ok">✓ Report integrity validated</div>`
    : `<div class="integrity-failed">⚠ Report integrity issues detected — some conclusions may be incomplete</div>`;

  const issueTable = issues.length > 0
    ? `<table class="integrity-table">
  <thead><tr><th>Kind</th><th>Severity</th><th>Message</th><th>Affected ID</th></tr></thead>
  <tbody>
    ${issues.map(renderIssueRow).join('\n    ')}
  </tbody>
</table>`
    : `<p class="empty">No integrity issues.</p>`;

  const missingStagesHtml = missing_stages.length > 0
    ? `<div class="integrity-detail"><strong>Missing stages:</strong> <code>${escapeHtml(missing_stages.join(', '))}</code></div>`
    : '';

  const brokenCausalRefsHtml = broken_causal_refs.length > 0
    ? `<div class="integrity-detail"><strong>Broken causal references:</strong> <code>${escapeHtml(broken_causal_refs.join(', '))}</code></div>`
    : '';

  const unclassifiedFailuresHtml = unclassified_failure_codes.length > 0
    ? `<div class="integrity-detail"><strong>Unclassified failures:</strong> <code>${escapeHtml(unclassified_failure_codes.join(', '))}</code></div>`
    : '';

  return `<section id="integrity" class="report-section integrity-${valid ? 'valid' : 'failed'}">
  <h2>Report Integrity</h2>
  ${validationBanner}

  ${issueTable}

  ${missingStagesHtml}
  ${brokenCausalRefsHtml}
  ${unclassifiedFailuresHtml}
</section>`;
}
