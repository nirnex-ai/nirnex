// Command: nirnex hook-log [options]
// Inspects hook lifecycle events from the append-only hook-events.jsonl stream.
//
// Usage:
//   nirnex hook-log --last                    Show timeline for the most recent session
//   nirnex hook-log --session <id>            Show timeline for a specific session
//   nirnex hook-log --violations              Show only violation events across sessions
//   nirnex hook-log --stage <stage>           Filter to a specific stage (entry, validate, ...)

import fs from 'node:fs';
import path from 'node:path';
import { loadHookEvents } from '../runtime/session.js';
import { HookEvent, ContractViolationDetectedEvent, FinalOutcomeDeclaredEvent, VerificationStatus } from '../runtime/types.js';

// ─── listCompletedRuns ────────────────────────────────────────────────────────

export interface CompletedRunRow {
  task_id: string;
  session_id: string;
  timestamp: string;
  decision: 'allow' | 'block';
  blocking_violation_count: number;
  advisory_violation_count: number;
  verification_status: VerificationStatus;
}

/**
 * Scan all sessions under .ai-index/runtime/events/ and collect FinalOutcomeDeclared events.
 * Deduplicates by task_id — keeps the most recent event when a task appears multiple times.
 * Returns rows ordered most-recent first (timestamp DESC).
 */
export function listCompletedRuns(repoRoot: string): CompletedRunRow[] {
  const eventsRoot = path.join(repoRoot, '.ai-index', 'runtime', 'events');
  if (!fs.existsSync(eventsRoot)) return [];

  const sessionDirs = fs.readdirSync(eventsRoot).filter(entry => {
    return fs.statSync(path.join(eventsRoot, entry)).isDirectory();
  });

  // task_id → latest CompletedRunRow
  const byTask = new Map<string, CompletedRunRow>();

  for (const sessionId of sessionDirs) {
    const events = loadHookEvents(repoRoot, sessionId);
    const finals = events.filter(e => e.event_type === 'FinalOutcomeDeclared') as FinalOutcomeDeclaredEvent[];

    for (const ev of finals) {
      const existing = byTask.get(ev.task_id);
      if (!existing || ev.timestamp > existing.timestamp) {
        byTask.set(ev.task_id, {
          task_id: ev.task_id,
          session_id: ev.session_id,
          timestamp: ev.timestamp,
          decision: ev.payload.decision,
          blocking_violation_count: ev.payload.blocking_violation_count,
          advisory_violation_count: ev.payload.advisory_violation_count,
          verification_status: ev.payload.verification_status,
        });
      }
    }
  }

  return Array.from(byTask.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

const HOOK_LOG_USAGE = `
nirnex hook-log [options]

Options:
  --last               Show timeline for the most recent session
  --session <id>       Show timeline for a specific session
  --list               List all sessions chronologically with summary info
  --violations         Show only ContractViolationDetected events across all sessions
  --stage <stage>      Filter to a specific hook stage (bootstrap|entry|guard|trace|validate)
`.trimStart();

// ─── Session summary ──────────────────────────────────────────────────────────

export interface SessionSummaryRow {
  session_id: string;
  first_event_ts: string;       // ISO timestamp of first event in the session
  task_count: number;           // distinct task_ids (excluding sentinel 'none')
  event_count: number;          // total hook events
  outcome: 'ALLOW' | 'BLOCK' | 'INCOMPLETE'; // last FinalOutcomeDeclared decision, or INCOMPLETE
  verification_status: VerificationStatus | '—';
  blocking_violations: number;
  advisory_violations: number;
  reason_codes: string[];       // distinct reason codes seen across the session
}

/**
 * Scan every session under .ai-index/runtime/events/ and build one summary row per session.
 * Rows are ordered oldest-first (timestamp ASC) so the list reads chronologically.
 */
export function buildSessionSummaries(repoRoot: string): SessionSummaryRow[] {
  const eventsRoot = path.join(repoRoot, '.ai-index', 'runtime', 'events');
  if (!fs.existsSync(eventsRoot)) return [];

  const sessionDirs = fs.readdirSync(eventsRoot).filter(entry =>
    fs.statSync(path.join(eventsRoot, entry)).isDirectory(),
  );

  const rows: SessionSummaryRow[] = [];

  for (const sessionId of sessionDirs) {
    const events = loadHookEvents(repoRoot, sessionId);
    if (events.length === 0) continue;

    // Distinct task ids (ignore sentinel value used before an envelope is created)
    const taskIds = new Set(events.map(e => e.task_id).filter(id => id && id !== 'none'));

    // Violations
    const violations = events.filter(e => e.event_type === 'ContractViolationDetected') as ContractViolationDetectedEvent[];
    const blocking = violations.filter(v => v.payload.severity === 'blocking').length;
    const advisory = violations.filter(v => v.payload.severity === 'advisory').length;
    const reasonCodes = [...new Set(violations.map(v => v.payload.reason_code))];

    // Final outcome — use the last FinalOutcomeDeclared in the session
    const finalOutcome = events.filter(e => e.event_type === 'FinalOutcomeDeclared').at(-1);
    const decision = (finalOutcome as any)?.payload?.decision;
    const verificationStatus: VerificationStatus | '—' =
      (finalOutcome as any)?.payload?.verification_status ?? '—';

    const outcome: SessionSummaryRow['outcome'] =
      decision === 'block' ? 'BLOCK' :
      decision === 'allow' ? 'ALLOW' :
      'INCOMPLETE';

    rows.push({
      session_id: sessionId,
      first_event_ts: events[0].timestamp,
      task_count: taskIds.size,
      event_count: events.length,
      outcome,
      verification_status: verificationStatus,
      blocking_violations: blocking,
      advisory_violations: advisory,
      reason_codes: reasonCodes,
    });
  }

  // Oldest first so the list reads as a timeline from top to bottom
  return rows.sort((a, b) => a.first_event_ts.localeCompare(b.first_event_ts));
}

function printSessionList(rows: SessionSummaryRow[]): void {
  if (rows.length === 0) {
    console.log('  · No sessions found.');
    console.log('  · Sessions are created when Claude runs a task with Nirnex hooks active.');
    return;
  }

  const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const dim   = (s: string) => `\x1b[90m${s}\x1b[0m`;
  const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

  const COL = { ts: 22, session: 30, tasks: 7, events: 8, outcome: 11, verify: 14, violations: 18, codes: 0 };

  const header =
    'TIMESTAMP'.padEnd(COL.ts) +
    'SESSION'.padEnd(COL.session) +
    'TASKS'.padEnd(COL.tasks) +
    'EVENTS'.padEnd(COL.events) +
    'OUTCOME'.padEnd(COL.outcome) +
    'VERIFY'.padEnd(COL.verify) +
    'VIOLATIONS'.padEnd(COL.violations) +
    'REASON CODES';

  process.stdout.write(`\n${bold('Nirnex Sessions')}  ${dim(`(${rows.length} session${rows.length !== 1 ? 's' : ''})`)}\n\n`);
  process.stdout.write(`  ${dim(header)}\n`);
  process.stdout.write(`  ${'─'.repeat(130)}\n`);

  for (const r of rows) {
    const ts = r.first_event_ts.replace('T', ' ').slice(0, 19) + 'Z';

    // Truncate session id to fit column: show first 12 + … + last 6
    const sid = r.session_id.length > 26
      ? r.session_id.slice(0, 18) + '…' + r.session_id.slice(-6)
      : r.session_id;

    const outcomeStr =
      r.outcome === 'BLOCK'      ? red('BLOCK')       :
      r.outcome === 'ALLOW'      ? green('ALLOW')      :
      yellow('INCOMPLETE');

    const verifyStr =
      r.verification_status === 'fail'         ? red('fail')          :
      r.verification_status === 'pass'         ? green('pass')        :
      r.verification_status === 'skipped'      ? yellow('skipped')    :
      r.verification_status === 'not_requested'? dim('not_requested') :
      r.verification_status === 'unknown'      ? dim('unknown')       :
      dim('—');

    const violStr =
      r.blocking_violations > 0
        ? red(`${r.blocking_violations} blocking`) + (r.advisory_violations > 0 ? `, ${r.advisory_violations} advisory` : '')
        : r.advisory_violations > 0
          ? yellow(`${r.advisory_violations} advisory`)
          : green('none');

    const codesStr = r.reason_codes.length > 0 ? dim(r.reason_codes.join(', ')) : '';

    // Print with ANSI-aware padding: pad plain text width, then apply colour
    const row =
      ts.padEnd(COL.ts) +
      sid.padEnd(COL.session) +
      String(r.task_count).padEnd(COL.tasks) +
      String(r.event_count).padEnd(COL.events);

    // Colour fields don't pad cleanly — write them with fixed widths manually
    process.stdout.write(
      `  ${row}${outcomeStr.padEnd ? '' : ''}` +
      `${outcomeStr}${' '.repeat(Math.max(0, COL.outcome - r.outcome.length))}` +
      `${verifyStr}${' '.repeat(Math.max(0, COL.verify - String(r.verification_status).length))}` +
      `${violStr}   ` +
      `${codesStr}\n`,
    );
  }

  process.stdout.write(`\n  ${dim('Use nirnex hook-log --session <id> to inspect a session in full.')}\n\n`);
}

function findSessionsDir(repoRoot: string): string {
  return path.join(repoRoot, '.ai-index', 'runtime', 'sessions');
}

function findEventsDir(repoRoot: string): string {
  return path.join(repoRoot, '.ai-index', 'runtime', 'events');
}

function listSessions(repoRoot: string): string[] {
  const dir = findSessionsDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

function mostRecentSession(repoRoot: string): string | null {
  const eventsDir = findEventsDir(repoRoot);
  if (!fs.existsSync(eventsDir)) return null;

  // Find the session with the most recently modified hook-events.jsonl
  const sessions = fs.readdirSync(eventsDir).filter(s => {
    const p = path.join(eventsDir, s, 'hook-events.jsonl');
    return fs.existsSync(p);
  });

  if (sessions.length === 0) return null;

  return sessions
    .map(s => ({
      id: s,
      mtime: fs.statSync(path.join(eventsDir, s, 'hook-events.jsonl')).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)[0].id;
}

function formatRow(
  ts: string,
  stage: string,
  eventType: string,
  status: string,
  reasonCode: string,
  summary: string,
): string {
  const time = ts.slice(11, 19); // HH:MM:SS
  const stageCol = stage.padEnd(10);
  const typeCol = eventType.padEnd(28);
  const statusCol = status.padEnd(10);
  const rcCol = reasonCode.padEnd(36);
  return `${time}  ${stageCol}  ${typeCol}  ${statusCol}  ${rcCol}  ${summary}`;
}

function printTimeline(events: HookEvent[], stageFilter?: string): void {
  const filtered = stageFilter
    ? events.filter(e => e.hook_stage === stageFilter)
    : events;

  if (filtered.length === 0) {
    console.log('  (no events)');
    return;
  }

  console.log(
    formatRow('TIME    ', 'STAGE     ', 'EVENT_TYPE                  ', 'STATUS    ', 'REASON_CODE                         ', 'SUMMARY'),
  );
  console.log('─'.repeat(120));

  for (const e of filtered) {
    let status = '';
    let reasonCode = '';
    let summary = '';

    if (e.event_type === 'ContractViolationDetected') {
      const v = e as ContractViolationDetectedEvent;
      status = `[${v.payload.severity}]`;
      reasonCode = v.payload.reason_code;
      summary = `${v.payload.violated_contract.slice(0, 60)}`;
    } else if (e.event_type === 'StageCompleted') {
      status = (e as any).status ?? '';
      summary = `blockers=${(e as any).payload?.blocker_count ?? 0} violations=${(e as any).payload?.violation_count ?? 0}`;
    } else if (e.event_type === 'FinalOutcomeDeclared') {
      const p = (e as any).payload;
      status = p?.decision ?? '';
      summary = `blocking=${p?.blocking_violation_count ?? 0} advisory=${p?.advisory_violation_count ?? 0} verify=${p?.verification_status ?? '?'}`;
    } else if (e.event_type === 'InputEnvelopeCaptured') {
      const p = (e as any).payload;
      summary = `lane=${p?.lane} mandatory_verification=${p?.mandatory_verification_required} source=${p?.verification_requirement_source}`;
    } else if (e.event_type === 'HookInvocationStarted') {
      summary = `pid=${(e as any).payload?.pid}`;
    }

    console.log(formatRow(e.timestamp, e.hook_stage, e.event_type, status, reasonCode, summary));
  }
}

export function hookLogCommand(args: string[]): void {
  const repoRoot = process.env.NIRNEX_REPO_ROOT ?? process.cwd();

  if (!fs.existsSync(path.join(repoRoot, 'nirnex.config.json'))) {
    console.error('Not a Nirnex project (nirnex.config.json not found).');
    process.exit(1);
  }

  const showList       = args.includes('--list');
  const showViolations = args.includes('--violations');
  const showLast = args.includes('--last') || (!args.includes('--session') && !showViolations && !showList);
  const sessionIdx = args.indexOf('--session');
  const stageIdx = args.indexOf('--stage');
  const sessionArg = sessionIdx !== -1 ? args[sessionIdx + 1] : null;
  const stageArg = stageIdx !== -1 ? args[stageIdx + 1] : undefined;

  if (showList) {
    const rows = buildSessionSummaries(repoRoot);
    printSessionList(rows);
    return;
  }

  if (showViolations) {
    // Show all ContractViolationDetected events across all sessions
    const sessions = listSessions(repoRoot);
    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }
    let total = 0;
    for (const sid of sessions) {
      const events = loadHookEvents(repoRoot, sid).filter(e => e.event_type === 'ContractViolationDetected');
      if (events.length === 0) continue;
      console.log(`\nSession: ${sid} (${events.length} violations)`);
      printTimeline(events, stageArg);
      total += events.length;
    }
    if (total === 0) {
      console.log('No contract violations found across all sessions.');
    } else {
      console.log(`\nTotal violations: ${total}`);
    }
    return;
  }

  const sessionId = sessionArg ?? mostRecentSession(repoRoot);
  if (!sessionId) {
    console.error('No hook-events.jsonl found. Have any hooks run yet?');
    process.exit(1);
  }

  const events = loadHookEvents(repoRoot, sessionId);
  if (events.length === 0) {
    console.log(`Session ${sessionId}: no hook events recorded.`);
    return;
  }

  console.log(`Session: ${sessionId}  (${events.length} events)`);
  printTimeline(events, stageArg);

  // Summary footer
  const violations = events.filter(e => e.event_type === 'ContractViolationDetected') as ContractViolationDetectedEvent[];
  const blocking = violations.filter(v => v.payload.severity === 'blocking');
  const finalOutcome = events.filter(e => e.event_type === 'FinalOutcomeDeclared').at(-1);
  const decision = (finalOutcome as any)?.payload?.decision;

  console.log('');
  if (violations.length === 0) {
    console.log('✓ No contract violations detected.');
  } else {
    console.log(`⚠ ${violations.length} violation(s): ${blocking.length} blocking, ${violations.length - blocking.length} advisory`);
  }
  if (decision) {
    console.log(`Final outcome: ${decision.toUpperCase()}`);
  }
}
