// SessionStart hook handler.
// Called by .claude/hooks/nirnex-bootstrap.sh at the start of each Claude session.
// Reads nirnex.config.json, checks index freshness, writes env vars to CLAUDE_ENV_FILE,
// and creates a session state file.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createSession, saveSession, loadSession, appendHookEvent, generateEventId, generateRunId } from './session.js';
import { HookSessionStart, HookInvocationStartedEvent } from './types.js';

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
  });
}

function getIndexFreshness(repoRoot: string): { freshness: 'fresh' | 'stale' | 'unknown'; head: string } {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
    const dbPath = path.join(repoRoot, '.aidos.db');
    if (!fs.existsSync(dbPath)) return { freshness: 'unknown', head };

    // Read stored commit hash from DB
    const { openDb } = require('@nirnex/core/dist/db.js');
    const db = openDb(dbPath);
    const meta = db.prepare('SELECT value FROM _meta WHERE key = ?').get('commit_hash') as { value: string } | undefined;
    db.close();

    return { freshness: meta?.value === head ? 'fresh' : 'stale', head };
  } catch {
    return { freshness: 'unknown', head: '' };
  }
}

export async function runBootstrap(): Promise<void> {
  const runId = generateRunId();
  const raw = await readStdin();
  let hookData: HookSessionStart = { session_id: 'unknown' };

  try {
    hookData = JSON.parse(raw || '{}') as HookSessionStart;
  } catch {
    // Non-fatal: proceed with generated session id
  }

  const sessionId = hookData.session_id || `sess_${Date.now().toString(36)}`;
  const repoRoot = process.cwd();

  // Emit invocation evidence as first action — before any early exits
  const invocationEvent: HookInvocationStartedEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: 'none',
    run_id: runId,
    hook_stage: 'bootstrap',
    event_type: 'HookInvocationStarted',
    payload: { stage: 'bootstrap', cwd: repoRoot, repo_root: repoRoot, pid: process.pid },
  };
  appendHookEvent(repoRoot, sessionId, invocationEvent);

  // Verify project is Nirnex-enabled
  const configPath = path.join(repoRoot, 'nirnex.config.json');
  if (!fs.existsSync(configPath)) {
    // Not a Nirnex project — exit silently
    process.exit(0);
  }

  let config: Record<string, any> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    process.exit(0);
  }

  const { freshness, head } = getIndexFreshness(repoRoot);

  // Create or update session
  const existing = loadSession(repoRoot, sessionId);
  const session = existing ?? createSession(repoRoot, sessionId, {
    index_freshness: freshness,
    current_head: head,
    policy_mode: config.hooks?.policyMode ?? 'standard',
  });

  if (!existing) {
    saveSession(repoRoot, session);
  }

  // Write env vars to CLAUDE_ENV_FILE if set
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile) {
    const envVars = [
      `NIRNEX_REPO_ROOT=${repoRoot}`,
      `NIRNEX_DB_PATH=${path.join(repoRoot, '.aidos.db')}`,
      `NIRNEX_INDEX_FRESHNESS=${freshness}`,
      `NIRNEX_CURRENT_HEAD=${head}`,
      `NIRNEX_POLICY_MODE=${session.policy_mode}`,
      `NIRNEX_SESSION_ID=${sessionId}`,
    ].join('\n') + '\n';

    try {
      fs.writeFileSync(envFile, envVars, 'utf8');
    } catch {
      // Non-fatal
    }
  }

  // No JSON output needed for SessionStart (env vars are the output)
  process.exit(0);
}
