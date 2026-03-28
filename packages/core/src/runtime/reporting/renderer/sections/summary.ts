/**
 * Report Section — Run Summary
 * Renders the "What happened?" header section.
 */

import { RunEvidenceBundle } from '../../types.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSummarySection(bundle: RunEvidenceBundle): string {
  const s = bundle.summary;

  const run_id = escapeHtml(s.run_id);
  const request_id = escapeHtml(s.request_id);
  const final_status = escapeHtml(s.final_status);
  const lane = s.lane != null ? escapeHtml(s.lane) : '—';
  const started_at = s.started_at != null ? escapeHtml(s.started_at) : '—';
  const finished_at = s.finished_at != null ? escapeHtml(s.finished_at) : '—';
  const duration = s.duration_ms != null ? s.duration_ms + ' ms' : '—';
  const input_ref = s.input_ref != null ? escapeHtml(s.input_ref) : '—';
  const stop_condition = s.stop_condition != null ? escapeHtml(s.stop_condition) : '—';
  const report_integrity_status = escapeHtml(s.report_integrity_status);

  return `<section id="summary" class="report-section">
  <h2>Run Summary</h2>
  <table class="summary-table">
    <tr><th>Run ID</th><td class="mono">${run_id}</td></tr>
    <tr><th>Request ID</th><td class="mono">${request_id}</td></tr>
    <tr><th>Status</th><td class="status-${final_status}">${final_status.toUpperCase()}</td></tr>
    <tr><th>Lane</th><td>${lane}</td></tr>
    <tr><th>Started</th><td>${started_at}</td></tr>
    <tr><th>Finished</th><td>${finished_at}</td></tr>
    <tr><th>Duration</th><td>${duration}</td></tr>
    <tr><th>Input Ref</th><td>${input_ref}</td></tr>
    <tr><th>Stop Condition</th><td>${stop_condition}</td></tr>
    <tr><th>Report Integrity</th><td class="integrity-${report_integrity_status}">${report_integrity_status.toUpperCase()}</td></tr>
  </table>
</section>`;
}
