// Session and envelope state management.
// All state is stored under .ai-index/runtime/ as JSON files.

import fs from 'node:fs';
import path from 'node:path';
import { NirnexSession, TaskEnvelope, TraceEvent } from './types.js';

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
