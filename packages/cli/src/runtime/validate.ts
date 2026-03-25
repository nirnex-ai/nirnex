// Stop hook handler.
// Called when Claude thinks it is done with a task.
// Validates the active task envelope against the trace, and blocks completion
// if required conditions are not met.

import fs from 'node:fs';
import path from 'node:path';
import { loadActiveEnvelope, loadTraceEvents } from './session.js';
import { HookStop, ValidateDecision } from './types.js';

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
  });
}

export async function runValidate(): Promise<void> {
  const raw = await readStdin();

  let hookData: HookStop = { session_id: 'unknown' };
  try {
    hookData = JSON.parse(raw || '{}') as HookStop;
  } catch {
    // Non-fatal
  }

  const repoRoot = process.env.NIRNEX_REPO_ROOT ?? process.cwd();
  const sessionId = hookData.session_id ?? process.env.NIRNEX_SESSION_ID ?? '';

  if (!fs.existsSync(path.join(repoRoot, 'nirnex.config.json'))) {
    const out: ValidateDecision = { decision: 'allow' };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

  const envelope = loadActiveEnvelope(repoRoot, sessionId);

  // No active envelope → nothing to validate
  if (!envelope) {
    process.stdout.write(JSON.stringify({ decision: 'allow' } as ValidateDecision));
    process.exit(0);
  }

  const events = loadTraceEvents(repoRoot, sessionId);
  const reasons: string[] = [];

  // If ECO was blocked, Claude should not have proceeded at all
  if (envelope.eco_summary.blocked) {
    reasons.push('Task was marked blocked by ECO — no changes should have been made');
  }

  // If ECO was forced unknown for a non-trivial task, require human verification
  if (envelope.eco_summary.forced_unknown && envelope.lane !== 'A') {
    reasons.push('Task confidence is insufficient (forced_unknown=true) — human verification required before accepting changes');
  }

  // Lane C: require at least one trace event (cannot stop without having done something traceable)
  if (envelope.lane === 'C' && events.length === 0) {
    reasons.push('Lane C task completed with no recorded tool events — trace is empty');
  }

  // Check for unresolved deviations in trace
  const unresolvedDeviations = events
    .flatMap(e => e.deviation_flags)
    .filter(f => f.startsWith('file_in_blocked_path:'));

  if (unresolvedDeviations.length > 0) {
    reasons.push(`Unresolved blocked-path deviations: ${unresolvedDeviations.join(', ')}`);
  }

  // Check deadlock: Lane C with denied patterns triggered but required files unchanged
  if (envelope.lane === 'C') {
    const touchedFiles = new Set(events.flatMap(e => e.affected_files));
    const expectedTouched = envelope.scope.modules_expected;
    if (expectedTouched.length > 0) {
      const anyExpectedTouched = expectedTouched.some(m => [...touchedFiles].some(f => f.includes(m)));
      if (!anyExpectedTouched) {
        reasons.push(
          `Lane C task expected changes in [${expectedTouched.join(', ')}] but no matching files were modified — possible deadlock or guard block`,
        );
      }
    }
  }

  if (reasons.length > 0) {
    const out: ValidateDecision = {
      decision: 'block',
      reason: `[Nirnex Validate] ${reasons.join(' | ')}`,
    };
    process.stdout.write(JSON.stringify(out));
  } else {
    // Mark envelope as completed
    try {
      envelope.status = 'completed';
      const { saveEnvelope } = await import('./session.js');
      saveEnvelope(repoRoot, envelope);
    } catch {
      // Non-fatal
    }
    process.stdout.write(JSON.stringify({ decision: 'allow' } as ValidateDecision));
  }

  process.exit(0);
}
