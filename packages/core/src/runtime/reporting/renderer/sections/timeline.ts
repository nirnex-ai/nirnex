/**
 * Report Section — Stage Timeline
 * Renders the "Where did the path diverge?" section.
 */

import { RunEvidenceBundle, StageRecord } from '../../types.js';

export function renderTimelineSection(bundle: RunEvidenceBundle): string {
  const stages = bundle.stages;

  if (stages.length === 0) {
    return `<section id="timeline" class="report-section">
  <h2>Stage Timeline</h2>
  <p class="empty">No stage records available.</p>
</section>`;
  }

  const rows = stages.map((stage: StageRecord) => {
    const status = stage.status;
    const display_name = stage.display_name;
    const duration = stage.duration_ms != null ? stage.duration_ms + ' ms' : '—';
    const failure_count = stage.failure_count;
    const warning_count = stage.warning_count;
    const key_output = stage.key_output ?? '—';

    return `      <tr class="stage-${status}">
        <td class="mono">${display_name}</td>
        <td class="status-${status}">${status.toUpperCase()}</td>
        <td>${duration}</td>
        <td class="${failure_count > 0 ? 'has-failures' : ''}">${failure_count}</td>
        <td class="${warning_count > 0 ? 'has-warnings' : ''}">${warning_count}</td>
        <td>${key_output}</td>
      </tr>`;
  }).join('\n');

  return `<section id="timeline" class="report-section">
  <h2>Stage Timeline</h2>
  <table class="timeline-table">
    <thead>
      <tr>
        <th>Stage</th><th>Status</th><th>Duration</th>
        <th>Failures</th><th>Warnings</th><th>Key Output</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</section>`;
}
