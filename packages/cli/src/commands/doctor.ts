// Command: nirnex doctor
// Validates the runtime contract and Claude hook scripts.
//
// Checks:
//   1. .ai/runtime-contract.json exists and is valid JSON
//   2. Recorded node binary path still exists on disk
//   3. Recorded CLI entry path still exists on disk
//   4. All 5 Claude hook scripts are present
//   5. All 5 hook scripts are executable
//   6. No hook script relies on shebang-based `env node` resolution
//
// Exit codes:
//   0 — all checks passed
//   1 — one or more checks failed
//
// To repair a broken runtime:
//   nirnex setup --refresh-hooks

import fs from 'node:fs';
import path from 'node:path';

function tick(msg: string) {
  process.stdout.write(`  \x1b[32m✔\x1b[0m ${msg}\n`);
}

function cross(msg: string) {
  process.stdout.write(`  \x1b[31m✘\x1b[0m ${msg}\n`);
}

function warn(msg: string) {
  process.stdout.write(`  \x1b[33m!\x1b[0m ${msg}\n`);
}

const HOOK_NAMES = [
  'nirnex-bootstrap.sh',
  'nirnex-entry.sh',
  'nirnex-guard.sh',
  'nirnex-trace.sh',
  'nirnex-validate.sh',
] as const;

export function doctorCommand(_args: string[]): void {
  const cwd = process.cwd();
  let allOk = true;

  console.log('\n\x1b[1mNirnex Doctor\x1b[0m\n');

  // ── 1. Runtime contract ───────────────────────────────────────────────────

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

    // ── 2. Node binary ──────────────────────────────────────────────────────
    if (contract.nodePath) {
      if (fs.existsSync(contract.nodePath)) {
        tick(`node binary exists: ${contract.nodePath}`);
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

    // ── 3. CLI entry ────────────────────────────────────────────────────────
    if (contract.nirnexEntry) {
      if (fs.existsSync(contract.nirnexEntry)) {
        tick(`CLI entry exists: ${contract.nirnexEntry}`);
      } else {
        cross(`CLI entry not found: ${contract.nirnexEntry}`);
        process.stdout.write(
          '     Nirnex may have been moved or the dist/ build is missing.\n' +
          '     Run \x1b[1mnirnex setup --refresh-hooks\x1b[0m to repair.\n'
        );
        allOk = false;
      }
    } else {
      warn('runtime-contract.json missing nirnexEntry field');
      allOk = false;
    }

    // ── 4. Strategy field ───────────────────────────────────────────────────
    if (contract.strategy === 'direct-node-entry') {
      tick(`launch strategy: ${contract.strategy}`);
    } else if (contract.strategy) {
      warn(`unexpected launch strategy: ${contract.strategy} (expected direct-node-entry)`);
      warn('Run nirnex setup --refresh-hooks to upgrade to the current strategy');
    }
  }

  // ── 5–6. Claude hook scripts ──────────────────────────────────────────────

  console.log('');
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
    if (content.includes('/usr/bin/env node') || content.includes('env node')) {
      // env-node shebang in hook body (not just the shebang line of the script itself)
      const lines = content.split('\n');
      const bodyLines = lines.slice(1); // skip #!/bin/sh
      if (bodyLines.some(l => l.includes('env node'))) {
        warn(`Hook uses env node (fragile in restricted shell): .claude/hooks/${hookName}`);
        warn('  Run nirnex setup --refresh-hooks to rewrite with direct-node-entry strategy');
        hooksUseEnvNode++;
        allOk = false;
        continue;
      }
    }

    tick(`.claude/hooks/${hookName}`);
  }

  if (hooksMissing === 0 && hooksNotExecutable === 0 && hooksUseEnvNode === 0) {
    tick('All 5 Claude hook scripts are present, executable, and use direct-node-entry');
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('');
  if (allOk) {
    console.log('\x1b[32m\x1b[1mAll checks passed.\x1b[0m Runtime contract is healthy.\n');
  } else {
    console.log('\x1b[31m\x1b[1mOne or more checks failed.\x1b[0m');
    console.log('Run \x1b[1mnirnex setup --refresh-hooks\x1b[0m to repair the runtime contract and regenerate hooks.\n');
    process.exit(1);
  }
}
