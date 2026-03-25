// Command: nirnex status
// Shows project readiness, index health, and freshness.

import { openDb, indexStats } from '@nirnex/core';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

function tick(msg: string) {
  process.stdout.write(`  \x1b[32m✔\x1b[0m ${msg}\n`);
}

function cross(msg: string) {
  process.stdout.write(`  \x1b[31m✘\x1b[0m ${msg}\n`);
}

function warn(msg: string) {
  process.stdout.write(`  \x1b[33m!\x1b[0m ${msg}\n`);
}

export function statusCommand(_args: string[]): void {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'nirnex.config.json');
  const dbPath = path.join(cwd, '.aidos.db');

  console.log('\n\x1b[1mNirnex Status\x1b[0m\n');

  // Check if project is Nirnex-enabled
  const isEnabled = existsSync(configPath);
  if (!isEnabled) {
    cross('nirnex.config.json not found — project is not Nirnex-enabled');
    console.log('\n  Run \x1b[1mnirnex setup\x1b[0m to initialize this project.\n');
    process.exit(1);
  }

  let config: Record<string, any> = {};
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
    tick(`Project: \x1b[1m${config.projectName ?? path.basename(cwd)}\x1b[0m`);
  } catch {
    warn('nirnex.config.json is malformed');
  }

  // Check .ai/ structure
  const aiDir = path.join(cwd, '.ai');
  existsSync(aiDir)
    ? tick('.ai/ workspace present')
    : cross('.ai/ workspace missing — re-run nirnex setup');

  const promptsDir = path.join(aiDir, 'prompts');
  existsSync(path.join(promptsDir, 'analyst.md')) && existsSync(path.join(promptsDir, 'implementer.md'))
    ? tick('.ai/prompts/ configured')
    : warn('.ai/prompts/ missing analyst.md or implementer.md');

  // Check index
  const dbExists = existsSync(dbPath);
  if (!dbExists) {
    cross('Index not found — run \x1b[1mnirnex index --rebuild\x1b[0m');
  } else {
    try {
      const db = openDb(dbPath);
      const stats = indexStats(db);
      db.close();

      if (stats.moduleCount === 0) {
        warn(`Index empty (0 modules) — run \x1b[1mnirnex index --rebuild\x1b[0m`);
      } else {
        tick(`Index: ${stats.moduleCount} modules, ${stats.edgeCount} edges, schema v${stats.schemaVersion}`);
      }
    } catch (e) {
      warn(`Index read error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Check freshness
  try {
    const currentHead = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
    if (dbExists) {
      try {
        const db = openDb(dbPath);
        const meta = db.prepare('SELECT value FROM _meta WHERE key = ?').get('commit_hash') as { value: string } | undefined;
        db.close();
        if (meta?.value === currentHead) {
          tick('Index is fresh (matches current HEAD)');
        } else {
          warn('Index is stale — run \x1b[1mnirnex index\x1b[0m to refresh');
        }
      } catch {}
    }
  } catch {
    // not a git repo or git not available
  }

  // Check git hook
  const hookPath = path.join(cwd, '.git', 'hooks', 'post-commit');
  existsSync(hookPath)
    ? tick('Git post-commit hook installed')
    : warn('Git post-commit hook not installed (index may drift)');

  // Check Claude hooks
  console.log('');
  console.log('\x1b[1mClaude Hooks\x1b[0m');

  const claudeSettingsPath = path.join(cwd, '.claude', 'settings.json');
  if (!existsSync(claudeSettingsPath)) {
    warn('.claude/settings.json not found — run nirnex setup to install hooks');
  } else {
    try {
      const settings = JSON.parse(readFileSync(claudeSettingsPath, 'utf8'));
      settings.hooks
        ? tick('.claude/settings.json hook bindings present')
        : warn('.claude/settings.json has no hooks section — re-run nirnex setup');
    } catch {
      warn('.claude/settings.json is malformed');
    }
  }

  const claudeHooks = [
    'nirnex-bootstrap.sh',
    'nirnex-entry.sh',
    'nirnex-guard.sh',
    'nirnex-trace.sh',
    'nirnex-validate.sh',
  ];
  const hooksDir = path.join(cwd, '.claude', 'hooks');
  let hooksMissing = 0;
  for (const h of claudeHooks) {
    if (!existsSync(path.join(hooksDir, h))) hooksMissing++;
  }
  hooksMissing === 0
    ? tick('All 5 Claude hook scripts present')
    : warn(`${hooksMissing} Claude hook script(s) missing in .claude/hooks/ — re-run nirnex setup`);

  // Check runtime state
  const runtimeDir = path.join(cwd, '.ai-index', 'runtime');
  const sessionsDir = path.join(runtimeDir, 'sessions');
  const envelopesDir = path.join(runtimeDir, 'envelopes');

  if (existsSync(sessionsDir)) {
    try {
      const sessions = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      tick(`Runtime sessions: ${sessions.length} recorded`);
    } catch {
      warn('Could not read runtime sessions dir');
    }
  } else {
    tick('Runtime sessions: none yet (hooks not yet triggered)');
  }

  if (existsSync(envelopesDir)) {
    try {
      const envelopes = readdirSync(envelopesDir).filter(f => f.endsWith('.json'));
      const activeCount = envelopes.filter(f => {
        try {
          const e = JSON.parse(readFileSync(path.join(envelopesDir, f), 'utf8'));
          return e.status === 'active';
        } catch { return false; }
      }).length;
      tick(`Task envelopes: ${envelopes.length} total, ${activeCount} active`);
    } catch {
      warn('Could not read envelopes dir');
    }
  }

  console.log('');
}
