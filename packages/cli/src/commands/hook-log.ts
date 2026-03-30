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
  --violations         Show only ContractViolationDetected events across all sessions
  --stage <stage>      Filter to a specific hook stage (bootstrap|entry|guard|trace|validate)
`.trimStart();

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

  const showViolations = args.includes('--violations');
  const showLast = args.includes('--last') || (!args.includes('--session') && !showViolations);
  const sessionIdx = args.indexOf('--session');
  const stageIdx = args.indexOf('--stage');
  const sessionArg = sessionIdx !== -1 ? args[sessionIdx + 1] : null;
  const stageArg = stageIdx !== -1 ? args[stageIdx + 1] : undefined;

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
