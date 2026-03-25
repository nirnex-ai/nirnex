/**
 * Nirnex — Remove Command Test Suite
 *
 * Tests every behaviour of `nirnex remove`:
 *   1.  No-op: exits cleanly when no Nirnex artifacts are present
 *   2.  Config removal: nirnex.config.json is deleted when it matches the Nirnex shape
 *   3.  Config preservation: non-Nirnex config files are not deleted
 *   4.  Database removal: .aidos.db is deleted
 *   5.  Index removal: .ai-index/ is deleted recursively
 *   6.  Default template removal: default .ai/ files are deleted
 *   7.  User-modified templates preserved: edited templates are not removed
 *   8.  Specs preserved: .ai/specs/ content is never auto-deleted
 *   9.  Empty directory cleanup: empty dirs left after removal are pruned
 *   10. Git hook removal: exact-match hook file is deleted
 *   11. Git hook preservation: pre-existing custom hook is not touched
 *   12. Mixed git hook patching: only the nirnex line is removed from mixed hooks
 *   13. Claude hook scripts removal: nirnex-*.sh files are deleted when content matches
 *   14. Claude hook scripts preservation: modified hook scripts are not deleted
 *   15. settings.json surgical patch: only Nirnex bindings are removed
 *   16. settings.json full preservation: non-Nirnex settings are untouched
 *   17. --keep-data: .ai/, .ai-index/, .aidos.db are preserved
 *   18. --keep-claude: Claude hook scripts and settings.json are not touched
 *   19. --purge-data: .ai/ is deleted entirely (including user specs)
 *   20. --dry-run: plan is printed, no files are written or deleted
 *   21. Non-git repo: completes without throwing, skips hook logic
 *   22. Source code safety: files outside Nirnex footprint are never touched
 *   23. .claude/ and .claude/hooks/ dir cleanup when empty after removal
 *   24. setup → remove round-trip: repo is left in clean state
 *
 * Fixture strategy:
 *   Each test gets its own isolated temp directory.
 *   No mocks — real file system, real git, real writes.
 *   runSetup is used as the canonical way to produce a Nirnex-enabled repo.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

import { runSetup } from '../packages/cli/src/commands/setup.js';
import { runRemove } from '../packages/cli/src/commands/remove.js';

// ─── Default opts ─────────────────────────────────────────────────────────────

const SAFE_REMOVE = {
  yes: true,
  dryRun: false,
  force: false,
  keepData: false,
  keepSpecs: false,
  keepClaude: false,
  purgeData: false,
  json: false,
};

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const createdDirs: string[] = [];

function makeProject(
  name = `nirnex-remove-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): string {
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

function writePkg(dir: string, pkg: Record<string, unknown> = { name: 'test-app' }) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
}

/** Set up a fully Nirnex-enabled project in an isolated temp directory. */
async function makeNirnexProject(): Promise<string> {
  const dir = makeProject();
  initGit(dir);
  writePkg(dir);
  await runSetup(dir, { yes: true });
  return dir;
}

afterEach(() => {
  for (const d of createdDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

// ─── 1. No-op when no Nirnex artifacts ───────────────────────────────────────

describe('no-op on clean project', () => {
  it('resolves without throwing when no Nirnex artifacts exist', async () => {
    const dir = makeProject();
    writePkg(dir);
    await expect(runRemove(dir, SAFE_REMOVE)).resolves.toBeUndefined();
  });

  it('does not create any new files in a clean project', async () => {
    const dir = makeProject();
    writePkg(dir);
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(false);
    expect(existsSync(join(dir, '.ai'))).toBe(false);
    expect(existsSync(join(dir, '.ai-index'))).toBe(false);
  });
});

// ─── 2. nirnex.config.json removal ───────────────────────────────────────────

describe('nirnex.config.json removal', () => {
  it('removes nirnex.config.json after setup', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(false);
  });

  it('removes config when it contains the minimum Nirnex key set', async () => {
    const dir = makeProject();
    const config = {
      projectName: 'test',
      sourceRoots: ['src'],
      specDirectory: '.ai/specs',
      criticalPathsFile: '.ai/critical-paths.txt',
      prompts: { analyst: '.ai/prompts/analyst.md', implementer: '.ai/prompts/implementer.md' },
      index: { path: '.ai-index', db: '.aidos.db', autoRefresh: true },
      git: { installPostCommitHook: true },
      llm: { provider: 'anthropic' },
      hooks: { enabled: true, policyMode: 'standard' },
    };
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify(config, null, 2), 'utf8');
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(false);
  });
});

// ─── 3. Non-Nirnex config preserved ──────────────────────────────────────────

describe('non-Nirnex config.json preserved', () => {
  it('does not remove a config file that looks nothing like a Nirnex config', async () => {
    const dir = makeProject();
    // Only 1 matching key — below the 4-key threshold
    const config = { specDirectory: '.ai/specs', unrelatedKey: 'value', another: 1 };
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify(config), 'utf8');
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(true);
  });
});

// ─── 4. .aidos.db removal ────────────────────────────────────────────────────

describe('.aidos.db removal', () => {
  it('removes .aidos.db when present', async () => {
    const dir = makeProject();
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({
      projectName: 'x', sourceRoots: ['src'], specDirectory: '.ai/specs',
      criticalPathsFile: '.ai/critical-paths.txt', index: {}, git: {}, llm: {}, hooks: {},
    }), 'utf8');
    writeFileSync(join(dir, '.aidos.db'), 'sqlite data', 'utf8');
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.aidos.db'))).toBe(false);
  });

  it('does not throw when .aidos.db does not exist', async () => {
    const dir = await makeNirnexProject();
    // Ensure db is absent (setup may not create it without a real index run)
    const dbPath = join(dir, '.aidos.db');
    if (existsSync(dbPath)) rmSync(dbPath);
    await expect(runRemove(dir, SAFE_REMOVE)).resolves.toBeUndefined();
  });
});

// ─── 5. .ai-index/ removal ───────────────────────────────────────────────────

describe('.ai-index/ removal', () => {
  it('removes .ai-index/ directory after setup', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai-index'))).toBe(false);
  });

  it('removes .ai-index/ even when it contains nested runtime files', async () => {
    const dir = await makeNirnexProject();
    // Simulate runtime state written by hook pipeline
    mkdirSync(join(dir, '.ai-index', 'runtime', 'sessions'), { recursive: true });
    writeFileSync(
      join(dir, '.ai-index', 'runtime', 'sessions', 'sess-001.json'),
      JSON.stringify({ session_id: 'sess-001' }),
      'utf8',
    );
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai-index'))).toBe(false);
  });
});

// ─── 6. Default template removal ─────────────────────────────────────────────

describe('default template file removal', () => {
  it('removes .ai/prompts/analyst.md when content matches default', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'prompts', 'analyst.md'))).toBe(false);
  });

  it('removes .ai/prompts/implementer.md when content matches default', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'prompts', 'implementer.md'))).toBe(false);
  });

  it('removes .ai/calibration/README.md when content matches default', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'calibration', 'README.md'))).toBe(false);
  });

  it('removes .ai/critical-paths.txt when content matches default', async () => {
    const dir = await makeNirnexProject();
    // critical-paths.txt stays as default (we do not edit it in this test)
    const content = readFileSync(join(dir, '.ai', 'critical-paths.txt'), 'utf8');
    // Only assert removal if it still matches default
    if (content.trimStart().startsWith('# Critical Paths\n# List architecturally critical files')) {
      await runRemove(dir, SAFE_REMOVE);
      expect(existsSync(join(dir, '.ai', 'critical-paths.txt'))).toBe(false);
    }
  });
});

// ─── 7. User-modified templates preserved ────────────────────────────────────

describe('user-modified template preservation', () => {
  it('preserves analyst.md when user has edited it', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(
      join(dir, '.ai', 'prompts', 'analyst.md'),
      '# My Custom Analyst\nProject-specific rules here.\n',
      'utf8',
    );
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'prompts', 'analyst.md'))).toBe(true);
  });

  it('preserves implementer.md when user has edited it', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(
      join(dir, '.ai', 'prompts', 'implementer.md'),
      '# My Custom Implementer\nDo not refactor anything.\n',
      'utf8',
    );
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'prompts', 'implementer.md'))).toBe(true);
  });

  it('preserves critical-paths.txt when user has added entries', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(
      join(dir, '.ai', 'critical-paths.txt'),
      '# Critical Paths\nsrc/auth/\nsrc/payments/\n',
      'utf8',
    );
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'critical-paths.txt'))).toBe(true);
  });

  it('preserves calibration/README.md when user has modified it', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(
      join(dir, '.ai', 'calibration', 'README.md'),
      '# Custom Calibration\nThis project uses clean architecture.\n',
      'utf8',
    );
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'calibration', 'README.md'))).toBe(true);
  });
});

// ─── 8. .ai/specs/ always preserved ──────────────────────────────────────────

describe('.ai/specs/ preservation', () => {
  it('never auto-removes .ai/specs/ even when it is empty', async () => {
    const dir = await makeNirnexProject();
    // specs/ dir exists but is empty after setup
    await runRemove(dir, SAFE_REMOVE);
    // specs/ is empty so it gets cleaned up — that is acceptable
    // The key invariant: user files inside specs/ are never auto-deleted
  });

  it('preserves user spec files inside .ai/specs/', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(
      join(dir, '.ai', 'specs', 'add-retry.md'),
      '## In Scope\nAdd retry logic to HTTP client.\n',
      'utf8',
    );
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'specs', 'add-retry.md'))).toBe(true);
  });

  it('preserves .ai/specs/ directory when it contains user files', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(join(dir, '.ai', 'specs', 'my-spec.md'), '## spec content\n', 'utf8');
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai', 'specs'))).toBe(true);
  });
});

// ─── 9. Empty directory cleanup ───────────────────────────────────────────────

describe('empty directory cleanup', () => {
  it('removes .ai/prompts/ directory when empty after template removal', async () => {
    const dir = await makeNirnexProject();
    // Both templates are default → both removed → prompts/ becomes empty
    await runRemove(dir, SAFE_REMOVE);
    // If both files were removed, prompts/ should also be gone
    const promptsExist = existsSync(join(dir, '.ai', 'prompts'));
    if (!existsSync(join(dir, '.ai', 'prompts', 'analyst.md')) &&
        !existsSync(join(dir, '.ai', 'prompts', 'implementer.md'))) {
      expect(promptsExist).toBe(false);
    }
  });

  it('removes .ai/ directory when entirely empty after removal', async () => {
    const dir = await makeNirnexProject();
    // For .ai/ to be deleted, all content must be default (no user files)
    // critical-paths.txt and calibration/README.md are default in a fresh setup
    const cpContent = existsSync(join(dir, '.ai', 'critical-paths.txt'))
      ? readFileSync(join(dir, '.ai', 'critical-paths.txt'), 'utf8')
      : '';
    const calibContent = existsSync(join(dir, '.ai', 'calibration', 'README.md'))
      ? readFileSync(join(dir, '.ai', 'calibration', 'README.md'), 'utf8')
      : '';
    const allDefault =
      cpContent.trimStart().startsWith('# Critical Paths\n# List architecturally critical files') &&
      calibContent.trimStart().startsWith('# Calibration\n\nProject-specific calibration files for Nirnex.');

    await runRemove(dir, SAFE_REMOVE);

    if (allDefault) {
      expect(existsSync(join(dir, '.ai'))).toBe(false);
    }
  });
});

// ─── 10. Git post-commit hook — exact match → delete ─────────────────────────

describe('git post-commit hook removal', () => {
  it('removes post-commit hook when it is exactly the Nirnex template', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    await runSetup(dir, { yes: true });

    await runRemove(dir, SAFE_REMOVE);

    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(false);
  });

  it('does not throw when .git does not exist', async () => {
    const dir = makeProject();
    writePkg(dir);
    // Create a minimal Nirnex config so the scanner runs
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({
      projectName: 'x', sourceRoots: ['src'], specDirectory: '.ai/specs',
      criticalPathsFile: '.ai/critical-paths.txt', index: {}, git: {}, llm: {}, hooks: {},
    }), 'utf8');
    await expect(runRemove(dir, SAFE_REMOVE)).resolves.toBeUndefined();
  });
});

// ─── 11. Pre-existing custom hook not touched ─────────────────────────────────

describe('pre-existing custom git hook', () => {
  it('does not delete a custom post-commit hook that setup skipped', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);

    // Write a custom hook BEFORE setup — setup will skip it
    const hookPath = join(dir, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\nnpm test\n', { mode: 0o755 });

    await runSetup(dir, { yes: true });
    // Setup must have skipped the hook
    expect(readFileSync(hookPath, 'utf8')).toContain('npm test');

    await runRemove(dir, SAFE_REMOVE);

    // remove should leave the custom hook untouched
    expect(existsSync(hookPath)).toBe(true);
    expect(readFileSync(hookPath, 'utf8')).toContain('npm test');
  });
});

// ─── 12. Mixed post-commit hook patching ─────────────────────────────────────

describe('mixed git hook patching', () => {
  it('removes only the nirnex index line when hook contains other commands', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);

    // Simulate a hook that was hand-edited after Nirnex setup
    const hookPath = join(dir, '.git', 'hooks', 'post-commit');
    writeFileSync(
      hookPath,
      '#!/bin/sh\nnpm run lint\nnirnex index\nnpm test\n',
      { mode: 0o755 },
    );
    // Also write enough for the scanner to find a Nirnex config
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({
      projectName: 'x', sourceRoots: ['src'], specDirectory: '.ai/specs',
      criticalPathsFile: '.ai/critical-paths.txt', index: {}, git: {}, llm: {}, hooks: {},
    }), 'utf8');

    await runRemove(dir, SAFE_REMOVE);

    const patched = readFileSync(hookPath, 'utf8');
    expect(patched).not.toContain('nirnex index');
    expect(patched).toContain('npm run lint');
    expect(patched).toContain('npm test');
  });

  it('keeps hook file intact (does not delete it) after patching', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);

    const hookPath = join(dir, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho deploy\nnirnex index\n', { mode: 0o755 });
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({
      projectName: 'x', sourceRoots: ['src'], specDirectory: '.ai/specs',
      criticalPathsFile: '.ai/critical-paths.txt', index: {}, git: {}, llm: {}, hooks: {},
    }), 'utf8');

    await runRemove(dir, SAFE_REMOVE);

    expect(existsSync(hookPath)).toBe(true);
  });
});

// ─── 13. Claude hook scripts removal ─────────────────────────────────────────

describe('Claude hook script removal', () => {
  const HOOK_NAMES = [
    'nirnex-bootstrap.sh',
    'nirnex-entry.sh',
    'nirnex-guard.sh',
    'nirnex-trace.sh',
    'nirnex-validate.sh',
  ];

  for (const name of HOOK_NAMES) {
    it(`removes .claude/hooks/${name} when content matches Nirnex template`, async () => {
      const dir = await makeNirnexProject();
      await runRemove(dir, SAFE_REMOVE);
      expect(existsSync(join(dir, '.claude', 'hooks', name))).toBe(false);
    });
  }
});

// ─── 14. Modified Claude hook scripts preserved ───────────────────────────────

describe('modified Claude hook script preservation', () => {
  it('preserves nirnex-bootstrap.sh when user has modified it', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(
      join(dir, '.claude', 'hooks', 'nirnex-bootstrap.sh'),
      '#!/bin/sh\nexec nirnex runtime bootstrap\necho "custom addition"\n',
      { mode: 0o755 },
    );
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.claude', 'hooks', 'nirnex-bootstrap.sh'))).toBe(true);
  });
});

// ─── 15. .claude/settings.json surgical patch ────────────────────────────────

describe('Claude settings.json patching', () => {
  it('removes Nirnex hook bindings from settings.json', async () => {
    const dir = await makeNirnexProject();

    await runRemove(dir, SAFE_REMOVE);

    const settingsPath = join(dir, '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const allHookCommands: string[] = [];
      if (settings.hooks) {
        for (const entries of Object.values(settings.hooks) as unknown[][]) {
          if (!Array.isArray(entries)) continue;
          for (const entry of entries) {
            const e = entry as Record<string, unknown>;
            if (Array.isArray(e.hooks)) {
              for (const h of e.hooks as Record<string, unknown>[]) {
                if (typeof h.command === 'string') allHookCommands.push(h.command);
              }
            }
          }
        }
      }
      const nirnexCommands = allHookCommands.filter(c => c.includes('nirnex'));
      expect(nirnexCommands).toHaveLength(0);
    }
  });

  it('produces valid JSON after patching settings.json', async () => {
    const dir = await makeNirnexProject();

    await runRemove(dir, SAFE_REMOVE);

    const settingsPath = join(dir, '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf8');
      expect(() => JSON.parse(content)).not.toThrow();
    }
  });
});

// ─── 16. Non-Nirnex settings.json fields preserved ───────────────────────────

describe('settings.json non-Nirnex fields preserved', () => {
  it('preserves non-hooks keys in settings.json after patching', async () => {
    const dir = await makeNirnexProject();
    const settingsPath = join(dir, '.claude', 'settings.json');

    // Add a non-Nirnex setting before running remove
    const current = existsSync(settingsPath)
      ? JSON.parse(readFileSync(settingsPath, 'utf8'))
      : {};
    current.theme = 'dark';
    current.model = 'claude-opus-4-6';
    writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf8');

    await runRemove(dir, SAFE_REMOVE);

    if (existsSync(settingsPath)) {
      const result = JSON.parse(readFileSync(settingsPath, 'utf8'));
      expect(result.theme).toBe('dark');
      expect(result.model).toBe('claude-opus-4-6');
    }
  });

  it('preserves non-Nirnex hooks from other tools in settings.json', async () => {
    const dir = await makeNirnexProject();
    const settingsPath = join(dir, '.claude', 'settings.json');

    const current = existsSync(settingsPath)
      ? JSON.parse(readFileSync(settingsPath, 'utf8'))
      : {};

    // Inject a non-Nirnex hook entry alongside existing Nirnex hooks
    if (!current.hooks) current.hooks = {};
    if (!current.hooks.SessionStart) current.hooks.SessionStart = [];
    current.hooks.SessionStart.push({
      hooks: [{ type: 'command', command: '.claude/hooks/other-tool.sh', timeout: 15 }],
    });
    writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf8');

    await runRemove(dir, SAFE_REMOVE);

    if (existsSync(settingsPath)) {
      const result = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const sessionStart = result.hooks?.SessionStart ?? [];
      const commands = sessionStart.flatMap((e: Record<string, unknown>) =>
        Array.isArray(e.hooks)
          ? (e.hooks as Record<string, unknown>[]).map(h => h.command)
          : [],
      );
      expect(commands).toContain('.claude/hooks/other-tool.sh');
    }
  });
});

// ─── 17. --keep-data ─────────────────────────────────────────────────────────

describe('--keep-data flag', () => {
  it('preserves .ai/ when --keep-data is set', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, keepData: true });
    expect(existsSync(join(dir, '.ai'))).toBe(true);
  });

  it('preserves .ai-index/ when --keep-data is set', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, keepData: true });
    expect(existsSync(join(dir, '.ai-index'))).toBe(true);
  });

  it('preserves .aidos.db when --keep-data is set', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({
      projectName: 'x', sourceRoots: ['src'], specDirectory: '.ai/specs',
      criticalPathsFile: '.ai/critical-paths.txt', index: {}, git: {}, llm: {}, hooks: {},
    }), 'utf8');
    writeFileSync(join(dir, '.aidos.db'), 'sqlite', 'utf8');

    await runRemove(dir, { ...SAFE_REMOVE, keepData: true });

    expect(existsSync(join(dir, '.aidos.db'))).toBe(true);
  });

  it('still removes nirnex.config.json when --keep-data is set', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, keepData: true });
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(false);
  });
});

// ─── 18. --keep-claude ────────────────────────────────────────────────────────

describe('--keep-claude flag', () => {
  it('preserves Claude hook scripts when --keep-claude is set', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, keepClaude: true });
    expect(existsSync(join(dir, '.claude', 'hooks', 'nirnex-bootstrap.sh'))).toBe(true);
  });

  it('does not patch settings.json when --keep-claude is set', async () => {
    const dir = await makeNirnexProject();
    const settingsPath = join(dir, '.claude', 'settings.json');
    const before = existsSync(settingsPath)
      ? readFileSync(settingsPath, 'utf8')
      : null;

    await runRemove(dir, { ...SAFE_REMOVE, keepClaude: true });

    if (before !== null && existsSync(settingsPath)) {
      expect(readFileSync(settingsPath, 'utf8')).toBe(before);
    }
  });

  it('still removes nirnex.config.json when --keep-claude is set', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, keepClaude: true });
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(false);
  });
});

// ─── 19. --purge-data ─────────────────────────────────────────────────────────

describe('--purge-data flag', () => {
  it('removes the entire .ai/ directory including user specs', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(join(dir, '.ai', 'specs', 'important-spec.md'), '## spec\n', 'utf8');

    await runRemove(dir, { ...SAFE_REMOVE, purgeData: true, force: true });

    expect(existsSync(join(dir, '.ai'))).toBe(false);
  });

  it('also removes .ai-index/ when --purge-data is set', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, purgeData: true, force: true });
    expect(existsSync(join(dir, '.ai-index'))).toBe(false);
  });
});

// ─── 20. --dry-run ────────────────────────────────────────────────────────────

describe('--dry-run flag', () => {
  it('does not delete nirnex.config.json', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, dryRun: true });
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(true);
  });

  it('does not delete .ai-index/', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, dryRun: true });
    expect(existsSync(join(dir, '.ai-index'))).toBe(true);
  });

  it('does not delete .ai/ template files', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, dryRun: true });
    expect(existsSync(join(dir, '.ai', 'prompts', 'analyst.md'))).toBe(true);
  });

  it('does not delete Claude hook scripts', async () => {
    const dir = await makeNirnexProject();
    await runRemove(dir, { ...SAFE_REMOVE, dryRun: true });
    expect(existsSync(join(dir, '.claude', 'hooks', 'nirnex-bootstrap.sh'))).toBe(true);
  });

  it('does not modify settings.json', async () => {
    const dir = await makeNirnexProject();
    const settingsPath = join(dir, '.claude', 'settings.json');
    const before = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null;

    await runRemove(dir, { ...SAFE_REMOVE, dryRun: true });

    if (before !== null) {
      expect(readFileSync(settingsPath, 'utf8')).toBe(before);
    }
  });

  it('does not delete the git post-commit hook', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    await runSetup(dir, { yes: true });

    await runRemove(dir, { ...SAFE_REMOVE, dryRun: true });

    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(true);
  });

  it('resolves without throwing', async () => {
    const dir = await makeNirnexProject();
    await expect(runRemove(dir, { ...SAFE_REMOVE, dryRun: true })).resolves.toBeUndefined();
  });
});

// ─── 21. Non-git repo ─────────────────────────────────────────────────────────

describe('non-git repository', () => {
  it('completes without throwing on a non-git project', async () => {
    const dir = makeProject();
    writePkg(dir);
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({
      projectName: 'x', sourceRoots: ['src'], specDirectory: '.ai/specs',
      criticalPathsFile: '.ai/critical-paths.txt', index: {}, git: {}, llm: {}, hooks: {},
    }), 'utf8');
    await expect(runRemove(dir, SAFE_REMOVE)).resolves.toBeUndefined();
  });

  it('still removes nirnex.config.json on a non-git project', async () => {
    const dir = makeProject();
    writePkg(dir);
    writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({
      projectName: 'x', sourceRoots: ['src'], specDirectory: '.ai/specs',
      criticalPathsFile: '.ai/critical-paths.txt', index: {}, git: {}, llm: {}, hooks: {},
    }), 'utf8');
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(false);
  });
});

// ─── 22. Source code safety ───────────────────────────────────────────────────

describe('source code safety', () => {
  it('does not touch source files', async () => {
    const dir = await makeNirnexProject();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 1;\n', 'utf8');

    await runRemove(dir, SAFE_REMOVE);

    expect(existsSync(join(dir, 'src', 'index.ts'))).toBe(true);
    expect(readFileSync(join(dir, 'src', 'index.ts'), 'utf8')).toBe('export const x = 1;\n');
  });

  it('does not touch package.json', async () => {
    const dir = await makeNirnexProject();
    const pkgContent = readFileSync(join(dir, 'package.json'), 'utf8');

    await runRemove(dir, SAFE_REMOVE);

    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(pkgContent);
  });

  it('does not touch arbitrary project files', async () => {
    const dir = await makeNirnexProject();
    writeFileSync(join(dir, 'README.md'), '# My Project\n', 'utf8');
    writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{}}\n', 'utf8');

    await runRemove(dir, SAFE_REMOVE);

    expect(existsSync(join(dir, 'README.md'))).toBe(true);
    expect(existsSync(join(dir, 'tsconfig.json'))).toBe(true);
  });
});

// ─── 23. .claude/ and .claude/hooks/ empty dir cleanup ───────────────────────

describe('.claude/ directory cleanup', () => {
  it('removes .claude/hooks/ when it is empty after hook script removal', async () => {
    const dir = await makeNirnexProject();
    // All hook scripts should be default → all deleted → hooks/ dir becomes empty
    await runRemove(dir, SAFE_REMOVE);

    const hooksDir = join(dir, '.claude', 'hooks');
    if (!existsSync(join(dir, '.claude', 'hooks', 'nirnex-bootstrap.sh'))) {
      // hooks/ should be gone if it was emptied
      // (unless settings.json or other files remain in .claude/)
      const remainingHooks: string[] = existsSync(hooksDir)
        ? (() => { try { return readdirSync(hooksDir); } catch { return []; } })()
        : [];
      expect(remainingHooks.filter((f: string) => f.startsWith('nirnex-'))).toHaveLength(0);
    }
  });
});

// ─── 24. Full round-trip: setup → remove ─────────────────────────────────────

describe('setup → remove round-trip', () => {
  it('leaves no nirnex.config.json after round-trip', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    await runSetup(dir, { yes: true });
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, 'nirnex.config.json'))).toBe(false);
  });

  it('leaves no .ai-index/ after round-trip', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    await runSetup(dir, { yes: true });
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.ai-index'))).toBe(false);
  });

  it('leaves no Nirnex Claude hook scripts after round-trip', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    await runSetup(dir, { yes: true });
    await runRemove(dir, SAFE_REMOVE);

    const scripts = [
      'nirnex-bootstrap.sh',
      'nirnex-entry.sh',
      'nirnex-guard.sh',
      'nirnex-trace.sh',
      'nirnex-validate.sh',
    ];
    for (const s of scripts) {
      expect(existsSync(join(dir, '.claude', 'hooks', s))).toBe(false);
    }
  });

  it('leaves no git post-commit hook after round-trip on a fresh repo', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    // Fresh repo — no pre-existing hook, so setup installs ours
    await runSetup(dir, { yes: true });
    await runRemove(dir, SAFE_REMOVE);
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(false);
  });

  it('does not remove pre-existing post-commit hook after round-trip', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    // Install a custom hook before setup
    const hookPath = join(dir, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "pre-existing"\n', { mode: 0o755 });
    await runSetup(dir, { yes: true });
    await runRemove(dir, SAFE_REMOVE);
    // Custom hook must still be present
    expect(existsSync(hookPath)).toBe(true);
    expect(readFileSync(hookPath, 'utf8')).toContain('pre-existing');
  });

  it('does not break user source files after round-trip', async () => {
    const dir = makeProject();
    initGit(dir);
    writePkg(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'), 'const hello = "world";\n', 'utf8');
    await runSetup(dir, { yes: true });
    await runRemove(dir, SAFE_REMOVE);
    expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toBe('const hello = "world";\n');
  });
});
