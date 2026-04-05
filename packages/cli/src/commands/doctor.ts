// Command: nirnex doctor
// Unified project health, index freshness, and runtime contract check.
//
// Sections:
//   1. Project      — config, .ai/ workspace, prompt files
//   2. Index        — database, module/edge counts, freshness, post-commit hook
//   3. Claude Hooks — settings.json bindings, hook scripts present + executable + strategy
//   4. Runtime      — runtime-contract.json, node binary, CLI entry, launch strategy
//   5. Sessions     — recorded sessions and active task envelopes
//
// Exit codes:
//   0 — all checks passed
//   1 — one or more checks failed
//
// To repair a broken runtime:
//   nirnex setup --refresh-hooks

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { openDb, indexStats } from '@nirnex/core';

// ─── Output helpers ───────────────────────────────────────────────────────────

function tick(msg: string) {
  process.stdout.write(`  \x1b[32m✔\x1b[0m ${msg}\n`);
}

function cross(msg: string) {
  process.stdout.write(`  \x1b[31m✘\x1b[0m ${msg}\n`);
}

function warn(msg: string) {
  process.stdout.write(`  \x1b[33m!\x1b[0m ${msg}\n`);
}

function section(title: string) {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HOOK_NAMES = [
  'nirnex-bootstrap.sh',
  'nirnex-entry.sh',
  'nirnex-guard.sh',
  'nirnex-trace.sh',
  'nirnex-validate.sh',
] as const;

// ─── Command ─────────────────────────────────────────────────────────────────

export function doctorCommand(_args: string[]): void {
  const cwd = process.cwd();
  let allOk = true;

  console.log('\n\x1b[1mNirnex Doctor\x1b[0m\n');

  // ── 1. Project ───────────────────────────────────────────────────────────────

  section('Project');

  const configPath = path.join(cwd, 'nirnex.config.json');
  if (!fs.existsSync(configPath)) {
    cross('nirnex.config.json not found — project is not Nirnex-enabled');
    process.stdout.write('     Run \x1b[1mnirnex setup\x1b[0m to initialize this project.\n');
    // Nothing else can be checked — exit early.
    console.log('\n\x1b[31m\x1b[1mProject is not Nirnex-enabled.\x1b[0m\n');
    process.exit(1);
  }

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    tick(`Project: \x1b[1m${config.projectName ?? path.basename(cwd)}\x1b[0m`);
  } catch {
    warn('nirnex.config.json is malformed (invalid JSON)');
    allOk = false;
  }

  const aiDir = path.join(cwd, '.ai');
  if (fs.existsSync(aiDir)) {
    tick('.ai/ workspace present');
  } else {
    cross('.ai/ workspace missing — re-run nirnex setup');
    allOk = false;
  }

  const promptsDir = path.join(aiDir, 'prompts');
  const analystOk    = fs.existsSync(path.join(promptsDir, 'analyst.md'));
  const implementerOk = fs.existsSync(path.join(promptsDir, 'implementer.md'));
  if (analystOk && implementerOk) {
    tick('.ai/prompts/ configured (analyst.md, implementer.md)');
  } else {
    warn(`.ai/prompts/ missing ${[!analystOk && 'analyst.md', !implementerOk && 'implementer.md'].filter(Boolean).join(', ')}`);
    allOk = false;
  }

  // ── 2. Index ─────────────────────────────────────────────────────────────────

  section('Index');

  const dbPath = path.join(cwd, '.aidos.db');
  const dbExists = fs.existsSync(dbPath);

  if (!dbExists) {
    cross('Index not found (.aidos.db) — run \x1b[1mnirnex index --rebuild\x1b[0m');
    allOk = false;
  } else {
    try {
      const db = openDb(dbPath);
      const stats = indexStats(db);
      db.close();

      if (stats.moduleCount === 0) {
        warn('Index is empty (0 modules) — run \x1b[1mnirnex index --rebuild\x1b[0m');
        allOk = false;
      } else {
        tick(`Index: ${stats.moduleCount} modules, ${stats.edgeCount} edges, schema v${stats.schemaVersion}`);
      }
    } catch (e) {
      warn(`Index read error: ${e instanceof Error ? e.message : String(e)}`);
      allOk = false;
    }
  }

  // Freshness
  if (dbExists) {
    try {
      const currentHead = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      try {
        const db = openDb(dbPath);
        const meta = db.prepare('SELECT value FROM _meta WHERE key = ?').get('commit_hash') as { value: string } | undefined;
        db.close();
        if (meta?.value === currentHead) {
          tick('Index is fresh (matches current HEAD)');
        } else {
          warn('Index is stale — run \x1b[1mnirnex index\x1b[0m to refresh');
          allOk = false;
        }
      } catch { /* db unreadable — already reported above */ }
    } catch { /* not a git repo or git unavailable — skip freshness */ }
  }

  // Git post-commit hook
  const gitHookPath = path.join(cwd, '.git', 'hooks', 'post-commit');
  if (fs.existsSync(gitHookPath)) {
    tick('Git post-commit hook installed');
  } else {
    warn('Git post-commit hook not installed (index may drift on commit)');
  }

  // ── 3. Claude Hooks ──────────────────────────────────────────────────────────

  section('Claude Hooks');

  const claudeSettingsPath = path.join(cwd, '.claude', 'settings.json');
  if (!fs.existsSync(claudeSettingsPath)) {
    warn('.claude/settings.json not found — run nirnex setup to install hooks');
    allOk = false;
  } else {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8')) as Record<string, unknown>;
      if (settings.hooks) {
        tick('.claude/settings.json hook bindings present');
      } else {
        warn('.claude/settings.json has no hooks section — re-run nirnex setup');
        allOk = false;
      }
    } catch {
      warn('.claude/settings.json is malformed');
      allOk = false;
    }
  }

  const hooksDir = path.join(cwd, '.claude', 'hooks');
  let hooksMissing = 0;
  let hooksNotExecutable = 0;
  let hooksUseEnvNode = 0;

  for (const hookName of HOOK_NAMES) {
    const hookPath = path.join(hooksDir, hookName);

    if (!fs.existsSync(hookPath)) {
      cross(`Missing: .claude/hooks/${hookName}`);
      hooksMissing++;
      allOk = false;
      continue;
    }

    const mode = fs.statSync(hookPath).mode;
    if (!(mode & 0o100)) {
      cross(`Not executable: .claude/hooks/${hookName}`);
      hooksNotExecutable++;
      allOk = false;
      continue;
    }

    const content = fs.readFileSync(hookPath, 'utf8');
    const bodyLines = content.split('\n').slice(1); // skip #!/bin/sh
    if (bodyLines.some(l => l.includes('env node'))) {
      warn(`Legacy env node shebang (fragile in restricted shell): .claude/hooks/${hookName}`);
      warn('  Run nirnex setup --refresh-hooks to rewrite with direct-node-entry strategy');
      hooksUseEnvNode++;
      allOk = false;
      continue;
    }

    tick(`.claude/hooks/${hookName}`);
  }

  if (hooksMissing === 0 && hooksNotExecutable === 0 && hooksUseEnvNode === 0) {
    tick('All 5 Claude hook scripts are present, executable, and use direct-node-entry');
  }

  // ── 4. Runtime Contract ──────────────────────────────────────────────────────

  section('Runtime Contract');

  const contractPath = path.join(cwd, '.ai', 'runtime-contract.json');
  if (!fs.existsSync(contractPath)) {
    cross('.ai/runtime-contract.json not found');
    process.stdout.write(
      '     Run \x1b[1mnirnex setup --refresh-hooks\x1b[0m to generate it.\n'
    );
    allOk = false;
  } else {
    let contract: { nodePath?: string; nirnexEntry?: string; resolvedAt?: string; strategy?: string } = {};
    try {
      contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
      tick('.ai/runtime-contract.json present');
    } catch {
      cross('.ai/runtime-contract.json is malformed (invalid JSON)');
      allOk = false;
    }

    if (contract.nodePath) {
      if (fs.existsSync(contract.nodePath)) {
        tick(`node binary: ${contract.nodePath}`);
      } else {
        cross(`node binary not found: ${contract.nodePath}`);
        process.stdout.write(
          '     Node may have been updated or moved. Run \x1b[1mnirnex setup --refresh-hooks\x1b[0m.\n'
        );
        allOk = false;
      }
    } else {
      warn('runtime-contract.json missing nodePath field');
      allOk = false;
    }

    if (contract.nirnexEntry) {
      if (fs.existsSync(contract.nirnexEntry)) {
        tick(`CLI entry: ${contract.nirnexEntry}`);
      } else {
        cross(`CLI entry not found: ${contract.nirnexEntry}`);
        process.stdout.write(
          '     Run \x1b[1mnirnex setup --refresh-hooks\x1b[0m to repair.\n'
        );
        allOk = false;
      }
    } else {
      warn('runtime-contract.json missing nirnexEntry field');
      allOk = false;
    }

    if (contract.strategy === 'direct-node-entry') {
      tick(`launch strategy: ${contract.strategy}`);
    } else if (contract.strategy) {
      warn(`unexpected launch strategy: ${contract.strategy} (expected direct-node-entry)`);
      warn('  Run nirnex setup --refresh-hooks to upgrade to the current strategy');
      allOk = false;
    }
  }

  // ── 5. Sessions ───────────────────────────────────────────────────────────────

  section('Sessions');

  const runtimeDir  = path.join(cwd, '.ai-index', 'runtime');
  const sessionsDir = path.join(runtimeDir, 'sessions');
  const envelopesDir = path.join(runtimeDir, 'envelopes');

  if (fs.existsSync(sessionsDir)) {
    try {
      const sessions = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      tick(`Sessions: ${sessions.length} recorded`);
    } catch {
      warn('Could not read runtime sessions directory');
    }
  } else {
    tick('Sessions: none yet (hooks not yet triggered)');
  }

  if (fs.existsSync(envelopesDir)) {
    try {
      const envelopes = fs.readdirSync(envelopesDir).filter(f => f.endsWith('.json'));
      const activeCount = envelopes.filter(f => {
        try {
          const e = JSON.parse(fs.readFileSync(path.join(envelopesDir, f), 'utf8')) as { status?: string };
          return e.status === 'active';
        } catch { return false; }
      }).length;
      tick(`Task envelopes: ${envelopes.length} total, ${activeCount} active`);
    } catch {
      warn('Could not read envelopes directory');
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  console.log('');
  if (allOk) {
    console.log('\x1b[32m\x1b[1mAll checks passed.\x1b[0m\n');
  } else {
    console.log('\x1b[31m\x1b[1mOne or more checks failed.\x1b[0m');
    console.log('Run \x1b[1mnirnex setup --refresh-hooks\x1b[0m to repair hook scripts and the runtime contract.\n');
    process.exit(1);
  }
}
