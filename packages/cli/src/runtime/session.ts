// Session and envelope state management.
// All state is stored under .ai-index/runtime/ as JSON files.

import fs from 'node:fs';
import path from 'node:path';
import { NirnexSession, TaskEnvelope, TraceEvent, HookEvent, HookEventType, HookStage, HookWriteFailedEvent } from './types.js';

export const RUNTIME_DIR = '.ai-index/runtime';

function runtimeDir(repoRoot: string): string {
  return path.join(repoRoot, RUNTIME_DIR);
}

function sessionsDir(repoRoot: string): string {
  return path.join(runtimeDir(repoRoot), 'sessions');
}

function envelopesDir(repoRoot: string): string {
  return path.join(runtimeDir(repoRoot), 'envelopes');
}

function eventsDir(repoRoot: string, sessionId: string): string {
  return path.join(runtimeDir(repoRoot), 'events', sessionId);
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ─── Session ──────────────────────────────────────────────────────────────

export function createSession(repoRoot: string, sessionId: string, partial: Partial<NirnexSession> = {}): NirnexSession {
  ensureDir(sessionsDir(repoRoot));
  const session: NirnexSession = {
    session_id: sessionId,
    repo_root: repoRoot,
    db_path: path.join(repoRoot, '.aidos.db'),
    index_freshness: 'unknown',
    current_head: '',
    policy_mode: 'standard',
    created_at: new Date().toISOString(),
    tasks: [],
    ...partial,
  };
  saveSession(repoRoot, session);
  return session;
}

export function loadSession(repoRoot: string, sessionId: string): NirnexSession | null {
  const p = path.join(sessionsDir(repoRoot), `${sessionId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as NirnexSession;
  } catch {
    return null;
  }
}

export function saveSession(repoRoot: string, session: NirnexSession): void {
  ensureDir(sessionsDir(repoRoot));
  fs.writeFileSync(
    path.join(sessionsDir(repoRoot), `${session.session_id}.json`),
    JSON.stringify(session, null, 2),
    'utf8',
  );
}

// ─── Envelope ─────────────────────────────────────────────────────────────

export function saveEnvelope(repoRoot: string, envelope: TaskEnvelope): void {
  ensureDir(envelopesDir(repoRoot));
  fs.writeFileSync(
    path.join(envelopesDir(repoRoot), `${envelope.task_id}.json`),
    JSON.stringify(envelope, null, 2),
    'utf8',
  );
}

export function loadEnvelope(repoRoot: string, taskId: string): TaskEnvelope | null {
  const p = path.join(envelopesDir(repoRoot), `${taskId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as TaskEnvelope;
  } catch {
    return null;
  }
}

/**
 * Returns true when the envelope has been successfully completed by a prior Stop
 * hook invocation (G3 fix). An envelope is considered finalized only when BOTH:
 *   1. `finalized_at` is a non-empty ISO 8601 string, AND
 *   2. `status === 'completed'` (the allow path).
 *
 * A `status === 'failed'` envelope (block outcome) is intentionally NOT treated
 * as finalized. This prevents the G3 guard from returning `allow` after a prior
 * BLOCK decision — the duplicate invocation should re-block, not silently allow.
 *
 * `undefined` (pre-G3 envelopes) and empty string are treated as NOT finalized
 * so the guard is backward-compatible with existing runtime state.
 */
export function isEnvelopeFinalized(envelope: TaskEnvelope): boolean {
  return (
    typeof envelope.finalized_at === 'string' &&
    envelope.finalized_at.length > 0 &&
    envelope.status === 'completed'
  );
}

export function loadActiveEnvelope(repoRoot: string, sessionId: string): TaskEnvelope | null {
  const session = loadSession(repoRoot, sessionId);
  if (!session?.active_task_id) return null;
  return loadEnvelope(repoRoot, session.active_task_id);
}

// ─── Trace events ─────────────────────────────────────────────────────────

export function appendTraceEvent(repoRoot: string, sessionId: string, event: TraceEvent): void {
  const dir = eventsDir(repoRoot, sessionId);
  ensureDir(dir);
  const eventsPath = path.join(dir, 'events.jsonl');
  fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n', 'utf8');
}

export function loadTraceEvents(repoRoot: string, sessionId: string): TraceEvent[] {
  const eventsPath = path.join(eventsDir(repoRoot, sessionId), 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as TraceEvent; } catch { return null; }
    })
    .filter((e): e is TraceEvent => e !== null);
}

export function generateTaskId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `task_${ts}_${rand}`;
}

export function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `evt_${ts}_${rand}`;
}

export function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `run_${ts}_${rand}`;
}

// ─── Hook lifecycle events ─────────────────────────────────────────────────
// Separate from trace events (tool executions) to avoid breaking loadTraceEvents()
// readers that cast every line to TraceEvent.

function hookEventsPath(repoRoot: string, sessionId: string): string {
  return path.join(eventsDir(repoRoot, sessionId), 'hook-events.jsonl');
}

/**
 * Sidecar file for write-failure records. Deliberately separate from the main
 * hook-events.jsonl so that a failure in the primary file does not prevent the
 * failure record from being persisted (different inode, same directory).
 */
function hookWriteFailuresPath(repoRoot: string, sessionId: string): string {
  return path.join(eventsDir(repoRoot, sessionId), 'hook-write-failures.jsonl');
}

/**
 * Emit a structured HookWriteFailedEvent to both process.stderr and the sidecar
 * file. Never throws — stderr is the last-resort channel if the sidecar also fails.
 *
 * Design rationale:
 *  - stderr: always available; captured by the Claude Code process log regardless
 *    of filesystem state.
 *  - sidecar: a separate inode from hook-events.jsonl so validate.ts can query
 *    failures programmatically via loadHookWriteFailures().
 */
function emitWriteFailure(
  repoRoot: string,
  sessionId: string,
  event: HookEvent,
  reason: 'write_error' | 'malformed_event',
  error: string,
  missingFields?: string[],
): void {
  const record: HookWriteFailedEvent = {
    event_id:   generateEventId(),
    timestamp:  new Date().toISOString(),
    session_id: event.session_id || sessionId,
    task_id:    event.task_id    || '',
    run_id:     event.run_id     || '',
    hook_stage: (event.hook_stage || 'unknown') as HookStage | 'unknown',
    event_type: 'HookWriteFailed',
    payload: {
      reason,
      failed_event_type: (event.event_type || 'unknown') as HookEventType | 'unknown',
      failed_event_id:   event.event_id || '',
      error,
      target_path: hookEventsPath(repoRoot, sessionId),
      ...(missingFields && missingFields.length > 0 ? { missing_fields: missingFields } : {}),
    },
  };

  // Channel 1 — stderr: always reachable, captured by the Claude Code process.
  process.stderr.write(JSON.stringify(record) + '\n');

  // Channel 2 — sidecar file: separate I/O path from the failing main JSONL.
  // validate.ts reads this via loadHookWriteFailures() to detect audit gaps.
  try {
    fs.appendFileSync(hookWriteFailuresPath(repoRoot, sessionId), JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // Sidecar also failed — stderr record above is the remaining signal.
  }
}

export function appendHookEvent(repoRoot: string, sessionId: string, event: HookEvent): void {
  // Ensure the events directory exists first so both the main JSONL and the
  // sidecar failures file can be written (best-effort; if this throws we still
  // emit to stderr below via the write-failure path).
  const dir = eventsDir(repoRoot, sessionId);
  try {
    ensureDir(dir);
  } catch {
    // Directory creation failed — fall through; the write attempt below will
    // also fail and the catch block will emit a structured failure record.
  }

  // Validate required universal fields.  Malformed events must never reach the
  // audit JSONL, but they must also never be silently discarded — emit a
  // structured failure record so the gap is observable.
  const missingFields: string[] = [];
  if (!event.event_id)   missingFields.push('event_id');
  if (!event.timestamp)  missingFields.push('timestamp');
  if (!event.session_id) missingFields.push('session_id');
  if (!event.hook_stage) missingFields.push('hook_stage');
  if (!event.event_type) missingFields.push('event_type');

  if (missingFields.length > 0) {
    emitWriteFailure(
      repoRoot, sessionId, event,
      'malformed_event',
      `event rejected: missing required fields [${missingFields.join(', ')}]`,
      missingFields,
    );
    return;
  }

  try {
    fs.appendFileSync(hookEventsPath(repoRoot, sessionId), JSON.stringify(event) + '\n', 'utf8');
  } catch (writeErr) {
    // Write failed — emit a structured failure record to stderr and the sidecar.
    // Never throw: hook execution must not be interrupted by an audit write failure.
    emitWriteFailure(
      repoRoot, sessionId, event,
      'write_error',
      writeErr instanceof Error ? writeErr.message : String(writeErr),
    );
  }
}

export function loadHookEvents(repoRoot: string, sessionId: string): HookEvent[] {
  const p = hookEventsPath(repoRoot, sessionId);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as HookEvent; } catch { return null; }
    })
    .filter((e): e is HookEvent => e !== null);
}

/**
 * Load all HookWriteFailedEvent records from the sidecar failures file.
 *
 * Called by validate.ts to determine whether the audit trail for the current
 * session is complete before making a governance decision.  Any non-empty
 * result means one or more hook events were lost — the caller must treat the
 * evidence base as potentially incomplete (see G4).
 */
export function loadHookWriteFailures(repoRoot: string, sessionId: string): HookWriteFailedEvent[] {
  const p = hookWriteFailuresPath(repoRoot, sessionId);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as HookWriteFailedEvent; } catch { return null; }
    })
    .filter((e): e is HookWriteFailedEvent => e !== null);
}
