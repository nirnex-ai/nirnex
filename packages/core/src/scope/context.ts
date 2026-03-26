/**
 * Repo context detection — discovers workspace structure and per-subtree
 * framework identity before classification runs.
 *
 * Design decisions:
 *   - Framework detection reads package.json deps + config file presence,
 *     NOT path patterns alone.
 *   - In a monorepo, each workspace package gets its own AppContext entry.
 *   - tsconfig paths are recorded per root for the future import resolver.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RepoContext, AppContext, Framework } from './types.js';

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readYaml(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// ─── Workspace glob expansion ─────────────────────────────────────────────────

/**
 * Expand workspace globs (e.g., "packages/*", "apps/*") into actual
 * directories that exist on disk.
 * Supports only single-level wildcards ("*") in the final segment.
 */
function expandWorkspaceGlobs(
  globs: string[],
  repoRoot: string
): string[] {
  const roots: string[] = [];

  for (const pattern of globs) {
    const normalized = pattern.replace(/\\/g, '/').replace(/\/$/, '');

    if (!normalized.includes('*')) {
      // Exact path
      const abs = path.join(repoRoot, normalized);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        roots.push(normalized);
      }
      continue;
    }

    // Single glob level: "packages/*" or "apps/*"
    const lastSlash = normalized.lastIndexOf('/');
    const parentRel = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '.';
    const segment = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

    if (segment !== '*') continue; // only handle simple * for now

    const parentAbs = path.join(repoRoot, parentRel);
    if (!fs.existsSync(parentAbs)) continue;

    try {
      const entries = fs.readdirSync(parentAbs, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const rel = parentRel === '.' ? entry.name : `${parentRel}/${entry.name}`;
        roots.push(rel);
      }
    } catch {
      // ignore unreadable
    }
  }

  return [...new Set(roots)];
}

// ─── pnpm workspace parser ───────────────────────────────────────────────────

function parsePnpmWorkspaceYaml(content: string): string[] {
  // Simple line-by-line YAML parse (no full YAML parser to avoid dependencies)
  const patterns: string[] = [];
  let inPackages = false;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'packages:') {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (trimmed.startsWith('-')) {
        const val = trimmed.slice(1).trim().replace(/^['"]|['"]$/g, '');
        if (val) patterns.push(val);
      } else if (trimmed && !trimmed.startsWith('#')) {
        inPackages = false; // new top-level key
      }
    }
  }

  return patterns;
}

// ─── Framework detection per app root ────────────────────────────────────────

const FRAMEWORK_PACKAGES: Array<[string, Framework]> = [
  ['next', 'next'],
  ['expo', 'expo'],
  ['expo-router', 'expo'],
  ['react-native', 'react-native'],
  ['@react-native-community/cli', 'react-native'],
  ['@angular/core', 'angular'],
  ['nuxt', 'nuxt'],
  ['@nuxtjs/composition-api', 'nuxt'],
];

const FRAMEWORK_CONFIG_FILES: Array<[string, Framework]> = [
  ['next.config.ts', 'next'],
  ['next.config.js', 'next'],
  ['next.config.mjs', 'next'],
  ['metro.config.ts', 'react-native'],
  ['metro.config.js', 'react-native'],
  ['app.config.ts', 'expo'],
  ['app.config.js', 'expo'],
  ['eas.json', 'expo'],
  ['nuxt.config.ts', 'nuxt'],
  ['nuxt.config.js', 'nuxt'],
  ['angular.json', 'angular'],
  ['nest-cli.json', 'node'],
];

function detectFramework(appRootAbs: string): Framework {
  // 1. Config file presence (fastest signal)
  for (const [configFile, fw] of FRAMEWORK_CONFIG_FILES) {
    if (fs.existsSync(path.join(appRootAbs, configFile))) return fw;
  }

  // 2. package.json dependencies
  const pkg = readJson(path.join(appRootAbs, 'package.json'));
  if (pkg) {
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
      ...((pkg.peerDependencies as Record<string, string>) ?? {}),
    };
    for (const [pkgName, fw] of FRAMEWORK_PACKAGES) {
      if (pkgName in deps) return fw;
    }
    // Has package.json but no framework detected → node
    if (pkg.name) return 'node';
  }

  return 'unknown';
}

// ─── tsconfig paths extraction ────────────────────────────────────────────────

function extractTsconfigPaths(rootAbs: string): Record<string, string[]> {
  const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
  const pkg = readJson(tsconfigPath);
  if (!pkg) return {};

  const co = pkg.compilerOptions as Record<string, unknown> | undefined;
  if (!co) return {};

  return (co.paths as Record<string, string[]> | undefined) ?? {};
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Detect workspace structure and per-subtree framework identity.
 *
 * Returns one AppContext per workspace package (in a monorepo) or
 * a single AppContext for the repo root (in a single-app repo).
 */
export function detectRepoContext(repoRoot: string): RepoContext {
  // Try to find workspace globs
  const workspaceGlobs: string[] = [];

  // 1. npm/yarn/bun workspaces in root package.json
  const rootPkg = readJson(path.join(repoRoot, 'package.json'));
  if (rootPkg) {
    const ws = rootPkg.workspaces;
    if (Array.isArray(ws)) {
      workspaceGlobs.push(...(ws as string[]));
    } else if (ws && typeof ws === 'object' && Array.isArray((ws as Record<string, unknown>).packages)) {
      workspaceGlobs.push(...((ws as Record<string, unknown>).packages as string[]));
    }
  }

  // 2. pnpm workspaces
  if (workspaceGlobs.length === 0) {
    const pnpmYaml = readYaml(path.join(repoRoot, 'pnpm-workspace.yaml'));
    if (pnpmYaml) {
      workspaceGlobs.push(...parsePnpmWorkspaceYaml(pnpmYaml));
    }
  }

  // 3. Nx workspaces (nx.json defines projects)
  if (workspaceGlobs.length === 0 && fs.existsSync(path.join(repoRoot, 'nx.json'))) {
    const nxJson = readJson(path.join(repoRoot, 'nx.json'));
    if (nxJson) {
      workspaceGlobs.push('apps/*', 'packages/*', 'libs/*');
    }
  }

  const isMonorepo = workspaceGlobs.length > 0;

  let packageRoots: string[] = [];

  if (isMonorepo) {
    packageRoots = expandWorkspaceGlobs(workspaceGlobs, repoRoot);
  }

  if (packageRoots.length === 0) {
    // Single-app repo — use the repo root itself
    packageRoots = ['.'];
  }

  const appContexts: AppContext[] = packageRoots.map(rel => {
    const absRoot = rel === '.' ? repoRoot : path.join(repoRoot, rel);
    const framework = detectFramework(absRoot);
    return { root: rel === '.' ? '' : rel, framework };
  });

  // Remove empty-string root for single-app (use '' root only if non-monorepo)
  // Normalize: single-app uses root = '' (empty string = repo root)

  const tsconfigPathsByRoot: Record<string, Record<string, string[]>> = {};
  for (const ctx of appContexts) {
    const absRoot = ctx.root ? path.join(repoRoot, ctx.root) : repoRoot;
    const tsPaths = extractTsconfigPaths(absRoot);
    if (Object.keys(tsPaths).length > 0) {
      tsconfigPathsByRoot[ctx.root] = tsPaths;
    }
  }

  return {
    repoRoot,
    appContexts,
    tsconfigPathsByRoot,
    isMonorepo,
  };
}
