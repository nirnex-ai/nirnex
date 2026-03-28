/**
 * Report Section — Failure Matrix
 * Renders classified failures grouped by class and severity.
 */

import { RunEvidenceBundle, FailureRecord } from '../../types.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderFailuresSection(bundle: RunEvidenceBundle): string {
  const failures = bundle.failures;

  if (failures.length === 0) {
    return `<section id="failures" class="report-section">
  <h2>Failure Matrix</h2>
  <p class="empty">No failures recorded.</p>
</section>`;
  }

  // Group by class
  const grouped = new Map<string, FailureRecord[]>();
  for (const failure of failures) {
    const cls = failure.class;
    if (!grouped.has(cls)) {
      grouped.set(cls, []);
    }
    grouped.get(cls)!.push(failure);
  }

  const classGroups = Array.from(grouped.entries()).map(([className, records]) => {
    const failureRows = records.map(f => {
      const severity = f.severity;
      const code = escapeHtml(f.code);
      const blocking = f.blocking;
      const stage = f.stage != null ? escapeHtml(f.stage) : '—';
      const recoverability = escapeHtml(f.recoverability);
      const determinism = escapeHtml(f.determinism);
      const message = escapeHtml(f.message);

      return `        <tr class="severity-${severity}">
          <td class="mono">${code}</td>
          <td class="severity-${severity}">${severity.toUpperCase()}</td>
          <td>${blocking ? '⛔ Yes' : 'No'}</td>
          <td>${stage}</td>
          <td>${recoverability}</td>
          <td>${determinism}</td>
          <td>${message}</td>
        </tr>`;
    }).join('\n');

    return `  <div class="failure-group">
    <h3>${escapeHtml(className)}</h3>
    <table class="failure-table">
      <thead>
        <tr><th>Code</th><th>Severity</th><th>Blocking</th><th>Stage</th><th>Recoverability</th><th>Determinism</th><th>Message</th></tr>
      </thead>
      <tbody>
${failureRows}
      </tbody>
    </table>
  </div>`;
  }).join('\n');

  return `<section id="failures" class="report-section">
  <h2>Failure Matrix</h2>
${classGroups}
</section>`;
}
