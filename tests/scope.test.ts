/**
 * Nirnex — Scope Control Test Suite
 *
 * Tests all deliverables from the initial scope-control release contract:
 *   1. globToRegex / matchesGlob — pattern compilation
 *   2. isKnownNoise — built-in noise table
 *   3. isExecutionCritical — runtime-bearing heuristic
 *   4. isFrameworkCritical — per-subtree framework detection
 *   5. classifyFile — full 7-step decision pipeline
 *   6. loadScopePolicy — .nirnexignore / .nirnexinclude / CLI overrides
 *   7. detectRepoContext — single-app and monorepo, framework detection
 *   8. explainScope — per-file trust surface
 *   9. buildScopeSummary — aggregation and top-rule ranking
 *  10. checkSchemaVersionOrRebuild — schema migration guard
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ── Import scope functions directly from source (via tsx / ts-node resolution)
import {
  globToRegex,
  matchesGlob,
  isKnownNoise,
  isExecutionCritical,
  isFrameworkCritical,
  classifyFile,
} from '../packages/core/src/scope/classifier.js';

import {
  loadScopePolicy,
} from '../packages/core/src/scope/policy.js';

import { detectRepoContext } from '../packages/core/src/scope/context.js';

import {
  explainScope,
  buildScopeSummary,
} from '../packages/core/src/scope/summary.js';

import {
  checkSchemaVersionOrRebuild,
} from '../packages/core/src/db.js';

import type {
  CandidateFile,
  ScopeDecision,
  RepoContext,
  ScopePolicy,
} from '../packages/core/src/scope/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEST_ROOT = join(tmpdir(), `nirnex-scope-test-${Date.now()}`);

function writeFixture(relPath: string, content: string): string {
  const fullPath = join(TEST_ROOT, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

/** Build a minimal CandidateFile for testing classifyFile() directly */
function candidate(
  relPath: string,
  overrides: Partial<CandidateFile> = {}
): CandidateFile {
  const ext = relPath.slice(relPath.lastIndexOf('.'));
  return {
    path: relPath,
    absPath: join(TEST_ROOT, relPath),
    ext,
    size: 1024,
    isBinary: false,
    ...overrides,
  };
}

/** Empty repo context (no app contexts) for tests that don't need framework info */
function emptyCtx(): RepoContext {
  return {
    repoRoot: TEST_ROOT,
    appContexts: [],
    tsconfigPathsByRoot: {},
    isMonorepo: false,
  };
}

/** Default policy with no user overrides */
function defaultPolicy(): ScopePolicy {
  return loadScopePolicy(TEST_ROOT);
}

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// A — globToRegex / matchesGlob
// ─────────────────────────────────────────────────────────────────────────────

describe('A — globToRegex / matchesGlob', () => {
  describe('directory prefix shorthand', () => {
    it('matches exact directory prefix', () => {
      expect(matchesGlob('dist/index.js', 'dist/')).toBe(true);
    });

    it('matches file inside nested subdir', () => {
      expect(matchesGlob('dist/esm/index.js', 'dist/')).toBe(true);
    });

    it('does not match sibling prefix', () => {
      expect(matchesGlob('distribution/index.js', 'dist/')).toBe(false);
    });
  });

  describe('single star *', () => {
    it('matches any file in a directory', () => {
      expect(matchesGlob('src/foo.ts', 'src/*.ts')).toBe(true);
    });

    it('does not match across directory boundaries', () => {
      expect(matchesGlob('src/sub/foo.ts', 'src/*.ts')).toBe(false);
    });
  });

  describe('double star **', () => {
    it('matches nested paths', () => {
      expect(matchesGlob('node_modules/react/index.js', 'node_modules/**')).toBe(true);
    });

    it('matches immediate child', () => {
      expect(matchesGlob('node_modules/react', 'node_modules/**')).toBe(true);
    });
  });

  describe('exact filename patterns', () => {
    it('matches literal path', () => {
      expect(matchesGlob('src/utils/helpers.ts', 'src/utils/helpers.ts')).toBe(true);
    });

    it('does not match different file', () => {
      expect(matchesGlob('src/utils/other.ts', 'src/utils/helpers.ts')).toBe(false);
    });
  });

  describe('leading ./ normalization', () => {
    it('strips leading ./ from pattern', () => {
      expect(matchesGlob('src/foo.ts', './src/foo.ts')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — isKnownNoise
// ─────────────────────────────────────────────────────────────────────────────

describe('B — isKnownNoise', () => {
  describe('build output directories', () => {
    it('flags dist/', () => {
      expect(isKnownNoise('dist/index.js')).toBe(true);
    });

    it('flags .next/', () => {
      expect(isKnownNoise('.next/server/app/page.js')).toBe(true);
    });

    it('flags build/', () => {
      expect(isKnownNoise('build/static/main.js')).toBe(true);
    });

    it('flags coverage/', () => {
      expect(isKnownNoise('coverage/lcov.info')).toBe(true);
    });

    it('flags __mocks__/', () => {
      expect(isKnownNoise('src/__mocks__/api.ts')).toBe(true);
    });

    it('flags .turbo/', () => {
      expect(isKnownNoise('.turbo/cache/file.json')).toBe(true);
    });
  });

  describe('exact filenames', () => {
    it('flags package-lock.json', () => {
      expect(isKnownNoise('package-lock.json')).toBe(true);
    });

    it('flags yarn.lock', () => {
      expect(isKnownNoise('yarn.lock')).toBe(true);
    });

    it('flags pnpm-lock.yaml', () => {
      expect(isKnownNoise('pnpm-lock.yaml')).toBe(true);
    });
  });

  describe('filename suffixes', () => {
    it('flags .min.js', () => {
      expect(isKnownNoise('static/bundle.min.js')).toBe(true);
    });

    it('flags .d.ts', () => {
      expect(isKnownNoise('src/types.d.ts')).toBe(true);
    });
  });

  describe('real source files are not noise', () => {
    it('does not flag src/index.ts', () => {
      expect(isKnownNoise('src/index.ts')).toBe(false);
    });

    it('does not flag components/Button.tsx', () => {
      expect(isKnownNoise('components/Button.tsx')).toBe(false);
    });

    it('does not flag app/page.tsx (Next.js App Router)', () => {
      expect(isKnownNoise('app/page.tsx')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — isExecutionCritical
// ─────────────────────────────────────────────────────────────────────────────

describe('C — isExecutionCritical', () => {
  describe('filename suffix patterns', () => {
    it('flags .service.ts', () => {
      expect(isExecutionCritical('src/auth/auth.service.ts')).toBe(true);
    });

    it('flags .controller.ts', () => {
      expect(isExecutionCritical('src/users/users.controller.ts')).toBe(true);
    });

    it('flags .store.ts', () => {
      expect(isExecutionCritical('src/state/counter.store.ts')).toBe(true);
    });

    it('flags .reducer.ts', () => {
      expect(isExecutionCritical('src/store/counter.reducer.ts')).toBe(true);
    });

    it('flags .middleware.ts', () => {
      expect(isExecutionCritical('src/http/logging.middleware.ts')).toBe(true);
    });
  });

  describe('directory segment membership', () => {
    it('flags files in routes/', () => {
      expect(isExecutionCritical('src/routes/users.ts')).toBe(true);
    });

    it('flags files in api/', () => {
      expect(isExecutionCritical('src/api/payments.ts')).toBe(true);
    });

    it('flags files in services/', () => {
      expect(isExecutionCritical('src/services/email.ts')).toBe(true);
    });

    it('flags files in middleware/', () => {
      expect(isExecutionCritical('src/middleware/auth.ts')).toBe(true);
    });

    it('flags files in controllers/', () => {
      expect(isExecutionCritical('src/controllers/home.ts')).toBe(true);
    });

    it('flags files in hooks/', () => {
      expect(isExecutionCritical('src/hooks/useAuth.ts')).toBe(true);
    });

    it('flags files in store/', () => {
      expect(isExecutionCritical('src/store/index.ts')).toBe(true);
    });
  });

  describe('entry-point filenames at shallow depth', () => {
    it('flags index.ts at depth 1', () => {
      expect(isExecutionCritical('index.ts')).toBe(true);
    });

    it('flags server.ts at depth 1', () => {
      expect(isExecutionCritical('server.ts')).toBe(true);
    });

    it('flags main.ts at depth 2', () => {
      expect(isExecutionCritical('src/main.ts')).toBe(true);
    });
  });

  describe('non-critical files', () => {
    it('does not flag utility helpers', () => {
      // A plain utility file not matching any critical pattern
      expect(isExecutionCritical('src/utils/formatDate.ts')).toBe(false);
    });

    it('does not flag a test file', () => {
      expect(isExecutionCritical('src/auth/auth.test.ts')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — isFrameworkCritical
// ─────────────────────────────────────────────────────────────────────────────

describe('D — isFrameworkCritical', () => {
  describe('Next.js App Router', () => {
    const nextCtx: RepoContext = {
      repoRoot: TEST_ROOT,
      appContexts: [{ root: '', framework: 'next' }],
      tsconfigPathsByRoot: {},
      isMonorepo: false,
    };

    it('flags app/page.tsx', () => {
      expect(isFrameworkCritical('app/page.tsx', nextCtx)).toBe(true);
    });

    it('flags app/layout.tsx', () => {
      expect(isFrameworkCritical('app/layout.tsx', nextCtx)).toBe(true);
    });

    it('flags app/(group)/page.tsx', () => {
      expect(isFrameworkCritical('app/(group)/page.tsx', nextCtx)).toBe(true);
    });

    it('flags middleware.ts at root', () => {
      expect(isFrameworkCritical('middleware.ts', nextCtx)).toBe(true);
    });
  });

  describe('Monorepo — Next.js sub-package', () => {
    const monoCtx: RepoContext = {
      repoRoot: TEST_ROOT,
      appContexts: [
        { root: 'apps/web', framework: 'next' },
        { root: 'packages/ui', framework: 'node' },
      ],
      tsconfigPathsByRoot: {},
      isMonorepo: true,
    };

    it('flags apps/web/app/page.tsx as next-critical', () => {
      expect(isFrameworkCritical('apps/web/app/page.tsx', monoCtx)).toBe(true);
    });

    it('does not flag packages/ui/src/Button.tsx as next-critical', () => {
      expect(isFrameworkCritical('packages/ui/src/Button.tsx', monoCtx)).toBe(false);
    });
  });

  describe('non-framework file', () => {
    const unknownCtx: RepoContext = {
      repoRoot: TEST_ROOT,
      appContexts: [{ root: '', framework: 'unknown' }],
      tsconfigPathsByRoot: {},
      isMonorepo: false,
    };

    it('does not flag a plain utility file', () => {
      expect(isFrameworkCritical('src/utils/helpers.ts', unknownCtx)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — classifyFile — full decision pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('E — classifyFile', () => {
  const ctx = emptyCtx();
  let policy: ScopePolicy;

  beforeAll(() => {
    policy = defaultPolicy();
  });

  describe('Step 1 — hard screens', () => {
    it('EXCLUDES binary files by extension (.png)', () => {
      const d = classifyFile(candidate('assets/logo.png', { ext: '.png' }), ctx, policy);
      expect(d.tier).toBe('EXCLUDED');
      expect(d.reasonCode).toBe('HARD_SCREEN_BINARY');
    });

    it('EXCLUDES unsupported extensions (.js)', () => {
      const d = classifyFile(candidate('src/index.js', { ext: '.js' }), ctx, policy);
      expect(d.tier).toBe('EXCLUDED');
      expect(d.reasonCode).toBe('HARD_SCREEN_UNSUPPORTED_EXT');
    });

    it('EXCLUDES oversized files', () => {
      const d = classifyFile(
        candidate('src/big.ts', { size: 2 * 1024 * 1024 }),
        ctx,
        policy
      );
      expect(d.tier).toBe('EXCLUDED');
      expect(d.reasonCode).toBe('HARD_SCREEN_OVERSIZED');
    });

    it('EXCLUDES files marked isBinary=true regardless of extension', () => {
      const d = classifyFile(candidate('src/weird.ts', { isBinary: true }), ctx, policy);
      expect(d.tier).toBe('EXCLUDED');
      expect(d.reasonCode).toBe('HARD_SCREEN_BINARY');
    });
  });

  describe('Step 2 — force include', () => {
    it('FULL with FORCE_INCLUDE when path matches .nirnexinclude pattern', () => {
      const p = loadScopePolicy(TEST_ROOT, { include: 'vendor/special.ts' });
      const d = classifyFile(
        candidate('vendor/special.ts', { ext: '.ts' }),
        ctx,
        p
      );
      expect(d.tier).toBe('FULL');
      expect(d.reasonCode).toBe('FORCE_INCLUDE');
    });
  });

  describe('Step 3 — explicit ignore', () => {
    it('EXCLUDED with USER_IGNORE when path matches --ignore pattern', () => {
      const p = loadScopePolicy(TEST_ROOT, { ignore: 'src/legacy/**' });
      const d = classifyFile(
        candidate('src/legacy/old.ts'),
        ctx,
        p
      );
      expect(d.tier).toBe('EXCLUDED');
      expect(d.reasonCode).toBe('USER_IGNORE');
      expect(d.decisionSource).toBe('cli');
    });
  });

  describe('Step 6 — known noise', () => {
    it('EXCLUDES files in dist/', () => {
      const d = classifyFile(candidate('dist/index.ts'), ctx, policy);
      expect(d.tier).toBe('EXCLUDED');
      expect(d.reasonCode).toBe('KNOWN_NOISE');
    });

    it('EXCLUDES .d.ts files', () => {
      const d = classifyFile(candidate('src/types.d.ts'), ctx, policy);
      expect(d.tier).toBe('EXCLUDED');
      expect(d.reasonCode).toBe('KNOWN_NOISE');
    });
  });

  describe('Step 7 — default FULL', () => {
    it('FULL with DEFAULT_FULL for an ordinary source file', () => {
      const d = classifyFile(candidate('src/utils/formatDate.ts'), ctx, policy);
      expect(d.tier).toBe('FULL');
      expect(d.reasonCode).toBe('DEFAULT_FULL');
    });
  });

  describe('decision always has required fields', () => {
    it('every decision has path, tier, reasonCode, decisionSource', () => {
      const cases = [
        candidate('src/index.ts'),
        candidate('dist/out.ts'),
        candidate('assets/logo.png', { ext: '.png' }),
        candidate('src/legacy/old.ts'),
      ];
      const p = loadScopePolicy(TEST_ROOT, { ignore: 'src/legacy/**' });
      for (const c of cases) {
        const d = classifyFile(c, ctx, p);
        expect(d.path).toBe(c.path);
        expect(['FULL', 'EXCLUDED']).toContain(d.tier);
        expect(d.reasonCode).toBeTruthy();
        expect(d.decisionSource).toBeTruthy();
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F — loadScopePolicy
// ─────────────────────────────────────────────────────────────────────────────

describe('F — loadScopePolicy', () => {
  it('returns built-in ignore for node_modules/**', () => {
    const p = loadScopePolicy(TEST_ROOT);
    const matched = p.ignorePatterns.some(cp =>
      cp.regex.test('node_modules/react/index.js')
    );
    expect(matched).toBe(true);
  });

  it('returns built-in ignore for .git/**', () => {
    const p = loadScopePolicy(TEST_ROOT);
    const matched = p.ignorePatterns.some(cp =>
      cp.regex.test('.git/config')
    );
    expect(matched).toBe(true);
  });

  it('reads .nirnexignore from disk', () => {
    writeFixture('.nirnexignore', 'fixtures/**\n# comment\nsrc/legacy/**\n');
    const p = loadScopePolicy(TEST_ROOT);
    const matched = p.ignorePatterns.some(cp =>
      cp.regex.test('fixtures/data.ts') && cp.source === 'nirnexignore'
    );
    expect(matched).toBe(true);
  });

  it('reads .nirnexinclude from disk', () => {
    writeFixture('.nirnexinclude', 'vendor/special.ts\n');
    const p = loadScopePolicy(TEST_ROOT);
    const matched = p.includePatterns.some(cp =>
      cp.regex.test('vendor/special.ts') && cp.source === 'nirnexinclude'
    );
    expect(matched).toBe(true);
  });

  it('applies CLI --ignore with source=cli', () => {
    const p = loadScopePolicy(TEST_ROOT, { ignore: 'src/experiments/**' });
    const pattern = p.ignorePatterns.find(cp => cp.source === 'cli');
    expect(pattern).toBeDefined();
    expect(pattern!.regex.test('src/experiments/proto.ts')).toBe(true);
  });

  it('CLI --include has highest precedence', () => {
    const p = loadScopePolicy(TEST_ROOT, { include: 'vendor/important.ts' });
    expect(p.includePatterns[0].source).toBe('cli');
  });

  it('respects custom sizeLimitBytes', () => {
    const p = loadScopePolicy(TEST_ROOT, { sizeLimitBytes: 500 });
    expect(p.sizeLimitBytes).toBe(500);
  });

  it('defaults sizeLimitBytes to 1 MB', () => {
    const p = loadScopePolicy(TEST_ROOT);
    expect(p.sizeLimitBytes).toBe(1024 * 1024);
  });

  it('supportedExtensions includes .ts and .tsx', () => {
    const p = loadScopePolicy(TEST_ROOT);
    expect(p.supportedExtensions.has('.ts')).toBe(true);
    expect(p.supportedExtensions.has('.tsx')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G — detectRepoContext
// ─────────────────────────────────────────────────────────────────────────────

describe('G — detectRepoContext', () => {
  describe('single-app repo', () => {
    const singleRoot = join(TEST_ROOT, 'single-app');

    beforeAll(() => {
      mkdirSync(singleRoot, { recursive: true });
      writeFileSync(
        join(singleRoot, 'package.json'),
        JSON.stringify({ name: 'my-app', dependencies: { next: '^14' } }),
        'utf-8'
      );
      // Add a Next.js config so framework detection fires
      writeFileSync(join(singleRoot, 'next.config.js'), 'module.exports = {}', 'utf-8');
    });

    it('detects single-app as non-monorepo', () => {
      const ctx = detectRepoContext(singleRoot);
      expect(ctx.isMonorepo).toBe(false);
    });

    it('detects Next.js framework', () => {
      const ctx = detectRepoContext(singleRoot);
      const fw = ctx.appContexts.find(a => a.framework === 'next');
      expect(fw).toBeDefined();
    });

    it('returns one appContext with empty root', () => {
      const ctx = detectRepoContext(singleRoot);
      expect(ctx.appContexts).toHaveLength(1);
      expect(ctx.appContexts[0].root).toBe('');
    });
  });

  describe('monorepo via npm workspaces', () => {
    const monoRoot = join(TEST_ROOT, 'monorepo-npm');

    beforeAll(() => {
      mkdirSync(join(monoRoot, 'packages', 'web'), { recursive: true });
      mkdirSync(join(monoRoot, 'packages', 'api'), { recursive: true });

      writeFileSync(
        join(monoRoot, 'package.json'),
        JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }),
        'utf-8'
      );

      writeFileSync(
        join(monoRoot, 'packages', 'web', 'package.json'),
        JSON.stringify({ name: '@mono/web', dependencies: { next: '^14' } }),
        'utf-8'
      );
      writeFileSync(
        join(monoRoot, 'packages', 'web', 'next.config.js'),
        'module.exports = {}',
        'utf-8'
      );

      writeFileSync(
        join(monoRoot, 'packages', 'api', 'package.json'),
        JSON.stringify({ name: '@mono/api', dependencies: {} }),
        'utf-8'
      );
    });

    it('detects isMonorepo=true', () => {
      const ctx = detectRepoContext(monoRoot);
      expect(ctx.isMonorepo).toBe(true);
    });

    it('has one appContext per workspace package', () => {
      const ctx = detectRepoContext(monoRoot);
      expect(ctx.appContexts.length).toBeGreaterThanOrEqual(2);
    });

    it('detects Next.js for packages/web', () => {
      const ctx = detectRepoContext(monoRoot);
      const webCtx = ctx.appContexts.find(a => a.root === 'packages/web');
      expect(webCtx).toBeDefined();
      expect(webCtx!.framework).toBe('next');
    });

    it('detects node for packages/api (has package.json, no framework)', () => {
      const ctx = detectRepoContext(monoRoot);
      const apiCtx = ctx.appContexts.find(a => a.root === 'packages/api');
      expect(apiCtx).toBeDefined();
      expect(apiCtx!.framework).toBe('node');
    });
  });

  describe('monorepo via pnpm-workspace.yaml', () => {
    const pnpmRoot = join(TEST_ROOT, 'monorepo-pnpm');

    beforeAll(() => {
      mkdirSync(join(pnpmRoot, 'packages', 'core'), { recursive: true });

      writeFileSync(
        join(pnpmRoot, 'pnpm-workspace.yaml'),
        'packages:\n  - "packages/*"\n',
        'utf-8'
      );

      writeFileSync(
        join(pnpmRoot, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@mono/core' }),
        'utf-8'
      );
    });

    it('detects isMonorepo=true via pnpm-workspace.yaml', () => {
      const ctx = detectRepoContext(pnpmRoot);
      expect(ctx.isMonorepo).toBe(true);
    });

    it('has packages/core in appContexts', () => {
      const ctx = detectRepoContext(pnpmRoot);
      const coreCtx = ctx.appContexts.find(a => a.root === 'packages/core');
      expect(coreCtx).toBeDefined();
    });
  });

  describe('no package.json', () => {
    const bareRoot = join(TEST_ROOT, 'bare-repo');

    beforeAll(() => {
      mkdirSync(bareRoot, { recursive: true });
    });

    it('returns isMonorepo=false', () => {
      const ctx = detectRepoContext(bareRoot);
      expect(ctx.isMonorepo).toBe(false);
    });

    it('returns one appContext with framework=unknown', () => {
      const ctx = detectRepoContext(bareRoot);
      expect(ctx.appContexts).toHaveLength(1);
      expect(ctx.appContexts[0].framework).toBe('unknown');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H — explainScope
// ─────────────────────────────────────────────────────────────────────────────

describe('H — explainScope', () => {
  const ctx = emptyCtx();
  let policy: ScopePolicy;

  beforeAll(() => {
    policy = defaultPolicy();
  });

  it('returns correct tier for a .ts source file', () => {
    // Create the file so stat() can succeed
    writeFixture('src/components/Button.ts', 'export const x = 1;');
    const result = explainScope('src/components/Button.ts', TEST_ROOT, ctx, policy);
    expect(result.tier).toBe('FULL');
    expect(result.path).toBe('src/components/Button.ts');
    expect(result.categoryExplanation).toBeTruthy();
  });

  it('returns EXCLUDED for .js file (unsupported ext)', () => {
    writeFixture('src/legacy.js', 'var x = 1;');
    const result = explainScope('src/legacy.js', TEST_ROOT, ctx, policy);
    expect(result.tier).toBe('EXCLUDED');
    expect(result.reasonCode).toBe('HARD_SCREEN_UNSUPPORTED_EXT');
  });

  it('handles absolute input paths', () => {
    const absPath = join(TEST_ROOT, 'src/components/Button.ts');
    const result = explainScope(absPath, TEST_ROOT, ctx, policy);
    expect(result.path).toBe('src/components/Button.ts');
  });

  it('handles non-existent file gracefully (no throw)', () => {
    expect(() =>
      explainScope('does/not/exist.ts', TEST_ROOT, ctx, policy)
    ).not.toThrow();
  });

  it('returns a non-empty categoryExplanation for every reasonCode', () => {
    const paths = [
      'src/Button.ts',
      'dist/bundle.ts',
      'logo.png',
    ];
    for (const p of paths) {
      const result = explainScope(p, TEST_ROOT, ctx, policy);
      expect(result.categoryExplanation.length).toBeGreaterThan(0);
    }
  });

  it('matchedRule is present when a user pattern fires', () => {
    const p = loadScopePolicy(TEST_ROOT, { ignore: 'src/generated/**' });
    const result = explainScope('src/generated/types.ts', TEST_ROOT, ctx, p);
    expect(result.tier).toBe('EXCLUDED');
    expect(result.matchedRule).toBe('src/generated/**');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I — buildScopeSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('I — buildScopeSummary', () => {
  function makeDecision(
    path: string,
    tier: 'FULL' | 'EXCLUDED',
    reasonCode: ScopeDecision['reasonCode'],
    source: ScopeDecision['decisionSource'] = 'builtin',
    matchedRule?: string
  ): ScopeDecision {
    return { path, tier, reasonCode, decisionSource: source, matchedRule };
  }

  it('counts full and excluded correctly', () => {
    const decisions: ScopeDecision[] = [
      makeDecision('a.ts', 'FULL', 'DEFAULT_FULL'),
      makeDecision('b.ts', 'FULL', 'EXECUTION_CRITICAL'),
      makeDecision('c.ts', 'EXCLUDED', 'KNOWN_NOISE'),
      makeDecision('d.ts', 'EXCLUDED', 'HARD_SCREEN_BINARY'),
    ];
    const summary = buildScopeSummary(decisions, 42);
    expect(summary.fullCount).toBe(2);
    expect(summary.excludedCount).toBe(2);
    expect(summary.candidateCount).toBe(4);
  });

  it('reports durationMs', () => {
    const summary = buildScopeSummary([], 123.45);
    expect(summary.durationMs).toBe(123.45);
  });

  it('sorts topIgnoreRules by count descending', () => {
    const decisions: ScopeDecision[] = [
      makeDecision('a.ts', 'EXCLUDED', 'USER_IGNORE', 'cli', 'src/legacy/**'),
      makeDecision('b.ts', 'EXCLUDED', 'USER_IGNORE', 'cli', 'src/legacy/**'),
      makeDecision('c.ts', 'EXCLUDED', 'KNOWN_NOISE', 'builtin'),
    ];
    const summary = buildScopeSummary(decisions, 0);
    expect(summary.topIgnoreRules[0].count).toBeGreaterThanOrEqual(
      summary.topIgnoreRules[summary.topIgnoreRules.length - 1].count
    );
  });

  it('topFullReasons aggregates reason codes', () => {
    const decisions: ScopeDecision[] = [
      makeDecision('a.ts', 'FULL', 'DEFAULT_FULL'),
      makeDecision('b.ts', 'FULL', 'DEFAULT_FULL'),
      makeDecision('c.ts', 'FULL', 'EXECUTION_CRITICAL'),
    ];
    const summary = buildScopeSummary(decisions, 0);
    const defaultFull = summary.topFullReasons.find(r => r.reason === 'DEFAULT_FULL');
    expect(defaultFull?.count).toBe(2);
    const execCrit = summary.topFullReasons.find(r => r.reason === 'EXECUTION_CRITICAL');
    expect(execCrit?.count).toBe(1);
  });

  it('handles empty decisions list', () => {
    const summary = buildScopeSummary([], 0);
    expect(summary.fullCount).toBe(0);
    expect(summary.excludedCount).toBe(0);
    expect(summary.topIgnoreRules).toHaveLength(0);
    expect(summary.topFullReasons).toHaveLength(0);
  });

  it('limits topIgnoreRules to 8 entries', () => {
    const decisions: ScopeDecision[] = Array.from({ length: 20 }, (_, i) =>
      makeDecision(`f${i}.ts`, 'EXCLUDED', 'USER_IGNORE', 'cli', `pattern-${i}/**`)
    );
    const summary = buildScopeSummary(decisions, 0);
    expect(summary.topIgnoreRules.length).toBeLessThanOrEqual(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J — checkSchemaVersionOrRebuild
// ─────────────────────────────────────────────────────────────────────────────

describe('J — checkSchemaVersionOrRebuild', () => {
  const dbDir = join(TEST_ROOT, 'schema-check');

  beforeAll(() => {
    mkdirSync(dbDir, { recursive: true });
  });

  it('returns needsRebuild=false when DB does not exist', () => {
    const result = checkSchemaVersionOrRebuild(join(dbDir, 'nonexistent.db'), false);
    expect(result.needsRebuild).toBe(false);
  });

  it('returns needsRebuild=false for a fresh DB at current schema', async () => {
    const { openDb } = await import('../packages/core/src/db.js');
    const freshPath = join(dbDir, 'fresh.db');
    const db = openDb(freshPath);
    db.close();

    const result = checkSchemaVersionOrRebuild(freshPath, false);
    expect(result.needsRebuild).toBe(false);
  });

  it('returns needsRebuild=true when DB has older schema version', async () => {
    const Database = (await import('better-sqlite3')).default;
    const oldPath = join(dbDir, 'old.db');
    const db = new Database(oldPath);
    db.pragma('user_version = 1'); // Simulate old schema
    db.close();

    const result = checkSchemaVersionOrRebuild(oldPath, false);
    expect(result.needsRebuild).toBe(true);
    expect(result.currentVersion).toBe(1);
    expect(result.message).toContain('--rebuild');
  });

  it('deletes old DB and returns needsRebuild=false when isRebuild=true', async () => {
    const Database = (await import('better-sqlite3')).default;
    const oldPath = join(dbDir, 'old-rebuild.db');
    const db = new Database(oldPath);
    db.pragma('user_version = 1');
    db.close();

    const result = checkSchemaVersionOrRebuild(oldPath, true);
    expect(result.needsRebuild).toBe(false);
    expect(existsSync(oldPath)).toBe(false);
  });

  it('returns needsRebuild=false for a completely missing DB even with isRebuild=true', () => {
    const result = checkSchemaVersionOrRebuild(join(dbDir, 'never-existed.db'), true);
    expect(result.needsRebuild).toBe(false);
  });
});
