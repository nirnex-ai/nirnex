/**
 * Nirnex — Doctor Command Test Suite
 *
 * Tests the `nirnex doctor` command which validates the runtime contract and
 * Claude hook scripts.
 *
 *   1.  Passes when runtime contract and hooks are healthy
 *   2.  Detects missing runtime-contract.json
 *   3.  Detects malformed runtime-contract.json
 *   4.  Detects stale (non-existent) nodePath in contract
 *   5.  Detects stale (non-existent) nirnexEntry in contract
 *   6.  Detects missing hook scripts
 *   7.  Detects hooks that still use env node (old strategy)
 *   8.  Reports strategy field correctly
 *
 * Fixture strategy:
 *   Each test gets an isolated temp directory. runSetup is used to create a
 *   known-good baseline, then specific files are manipulated to exercise each
 *   failure mode. The doctorCommand is run by capturing process.exit calls.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

import { runSetup } from '../packages/cli/src/commands/setup.js';
import { doctorCommand } from '../packages/cli/src/commands/doctor.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const createdDirs: string[] = [];

function makeProject(name = `nirnex-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`): string {
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

function initGit(dir: string) {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
}

function writePkg(dir: string, pkg: Record<string, unknown>) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
}

function readContract(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, '.ai', 'runtime-contract.json'), 'utf8'));
}

afterEach(() => {
  for (const d of createdDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

/**
 * Run doctorCommand capturing process.exit to avoid killing the test process.
 * Returns the exit code (0 = healthy, 1 = failure).
 */
async function runDoctor(dir: string): Promise<number> {
  const originalCwd = process.cwd();
  process.chdir(dir);
  let exitCode = 0;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  });
  try {
    doctorCommand([]);
  } catch (e) {
    // Swallow the artificial throw from exit mock
    if (!(e instanceof Error && e.message.startsWith('process.exit'))) throw e;
  } finally {
    exitSpy.mockRestore();
    process.chdir(originalCwd);
  }
  return exitCode;
}

/** Create a minimal valid setup: setup + working contract */
async function makeHealthyProject(): Promise<string> {
  const dir = makeProject();
  initGit(dir);
  writePkg(dir, { name: 'my-app' });
  await runSetup(dir, { yes: true });
  return dir;
}

// ─── 1. All checks pass ───────────────────────────────────────────────────────

describe('healthy project', () => {
  it('exits 0 when runtime contract and all hooks are valid', async () => {
    const dir = await makeHealthyProject();

    // The contract's nodePath and nirnexEntry might point to files that don't
    // exist in the test environment — patch them to known-existing paths.
    const contract = readContract(dir);
    contract.nodePath = process.execPath;
    contract.nirnexEntry = process.argv[1] ?? process.execPath;
    writeFileSync(join(dir, '.ai', 'runtime-contract.json'), JSON.stringify(contract, null, 2), 'utf8');

    const code = await runDoctor(dir);
    expect(code).toBe(0);
  });
});

// ─── 2. Missing runtime-contract.json ────────────────────────────────────────

describe('missing runtime contract', () => {
  it('exits 1 when .ai/runtime-contract.json does not exist', async () => {
    const dir = await makeHealthyProject();
    rmSync(join(dir, '.ai', 'runtime-contract.json'), { force: true });

    const code = await runDoctor(dir);
    expect(code).toBe(1);
  });
});

// ─── 3. Malformed runtime-contract.json ──────────────────────────────────────

describe('malformed runtime contract', () => {
  it('exits 1 when runtime-contract.json contains invalid JSON', async () => {
    const dir = await makeHealthyProject();
    writeFileSync(join(dir, '.ai', 'runtime-contract.json'), '{ not valid json }', 'utf8');

    const code = await runDoctor(dir);
    expect(code).toBe(1);
  });
});

// ─── 4. Stale nodePath ────────────────────────────────────────────────────────

describe('stale nodePath', () => {
  it('exits 1 when contract nodePath points to non-existent file', async () => {
    const dir = await makeHealthyProject();
    const contract = readContract(dir);
    contract.nodePath = '/nonexistent/path/to/node';
    writeFileSync(join(dir, '.ai', 'runtime-contract.json'), JSON.stringify(contract, null, 2), 'utf8');

    const code = await runDoctor(dir);
    expect(code).toBe(1);
  });
});

// ─── 5. Stale nirnexEntry ────────────────────────────────────────────────────

describe('stale nirnexEntry', () => {
  it('exits 1 when contract nirnexEntry points to non-existent file', async () => {
    const dir = await makeHealthyProject();
    const contract = readContract(dir);
    contract.nodePath    = process.execPath; // valid node
    contract.nirnexEntry = '/nonexistent/path/to/index.js';
    writeFileSync(join(dir, '.ai', 'runtime-contract.json'), JSON.stringify(contract, null, 2), 'utf8');

    const code = await runDoctor(dir);
    expect(code).toBe(1);
  });
});

// ─── 6. Missing hook scripts ──────────────────────────────────────────────────

describe('missing hook scripts', () => {
  it('exits 1 when a Claude hook script is missing', async () => {
    const dir = await makeHealthyProject();

    // Patch contract to use real paths so we isolate the hook-missing failure
    const contract = readContract(dir);
    contract.nodePath    = process.execPath;
    contract.nirnexEntry = process.argv[1] ?? process.execPath;
    writeFileSync(join(dir, '.ai', 'runtime-contract.json'), JSON.stringify(contract, null, 2), 'utf8');

    rmSync(join(dir, '.claude', 'hooks', 'nirnex-bootstrap.sh'), { force: true });

    const code = await runDoctor(dir);
    expect(code).toBe(1);
  });
});

// ─── 7. Hook uses env node (old strategy) ────────────────────────────────────

describe('legacy hook strategy', () => {
  it('exits 1 when a hook script uses env node in its body', async () => {
    const dir = await makeHealthyProject();

    // Patch contract to use real paths
    const contract = readContract(dir);
    contract.nodePath    = process.execPath;
    contract.nirnexEntry = process.argv[1] ?? process.execPath;
    writeFileSync(join(dir, '.ai', 'runtime-contract.json'), JSON.stringify(contract, null, 2), 'utf8');

    // Rewrite one hook to use the old env-node pattern
    writeFileSync(
      join(dir, '.claude', 'hooks', 'nirnex-bootstrap.sh'),
      '#!/bin/sh\nexport PATH="/usr/local/bin:$PATH"\nexec env node /usr/local/bin/nirnex runtime bootstrap\n',
      { mode: 0o755 }
    );

    const code = await runDoctor(dir);
    expect(code).toBe(1);
  });
});

// ─── 8. Strategy field ───────────────────────────────────────────────────────

describe('contract strategy field', () => {
  it('setup writes direct-node-entry strategy', async () => {
    const dir = await makeHealthyProject();
    const contract = readContract(dir);
    expect(contract.strategy).toBe('direct-node-entry');
  });
});
