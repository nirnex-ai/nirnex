/**
 * File classifier — assigns FULL or EXCLUDED to each candidate.
 *
 * Decision order (first match wins):
 *   1. Hard screen       — binary, oversized, unsupported ext → EXCLUDED
 *   2. Force include     — user or CLI explicit include → FULL
 *   3. Explicit ignore   — user or CLI explicit ignore → EXCLUDED
 *   4. Known noise       — build output / log / asset → EXCLUDED (before name heuristics)
 *   5. Framework-critical — detected framework requires this file → FULL
 *   6. Execution-critical — heuristic: runtime-bearing file → FULL
 *   7. Default           — everything else → FULL (no LIGHT tier in batch 1)
 */

import path from 'node:path';
import type { CandidateFile, ScopeDecision, ReasonCode, RepoContext, ScopePolicy, AppContext } from './types.js';
import {
  NOISE_DIR_PREFIXES,
  NOISE_EXACT_FILENAMES,
  NOISE_EXTENSIONS,
  NOISE_FILENAME_SUFFIXES,
  NOISE_GLOB_PATTERNS,
  EXECUTION_CRITICAL_DIR_SEGMENTS,
  EXECUTION_CRITICAL_FILENAME_PATTERNS,
  EXECUTION_CRITICAL_CONFIG_FILENAMES,
  EXECUTION_CRITICAL_ENTRY_FILENAMES,
  NEXT_CRITICAL_FILENAME_PATTERNS,
  NEXT_CRITICAL_CONFIG_FILES,
  EXPO_CRITICAL_FILENAME_PATTERNS,
  EXPO_CRITICAL_CONFIG_FILES,
  NODE_CRITICAL_FILENAME_PATTERNS,
  BINARY_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
} from './rules.js';

// ─── Pattern utilities ────────────────────────────────────────────────────────

/**
 * Convert a glob pattern to a RegExp.
 * Handles: ** (any path), * (single segment), directory prefixes.
 * Input paths must use forward slashes.
 */
export function globToRegex(pattern: string): RegExp {
  // Normalize: strip leading ./
  pattern = pattern.replace(/^\.\//, '');

  // Directory prefix shorthand: "dist/" → matches "dist/" or "dist/..."
  if (pattern.endsWith('/') && !pattern.includes('*')) {
    const escaped = escapeRegex(pattern.slice(0, -1));
    return new RegExp(`^${escaped}(/|$)`);
  }

  let p = escapeRegex(pattern);
  // Replace ** first (use placeholder to avoid double-processing)
  const DSTAR = '\u0000';
  p = p.replace(/\\\*\\\*/g, DSTAR);
  // Replace single * (matches within one segment)
  p = p.replace(/\\\*/g, '[^/]*');
  // Expand ** placeholder
  p = p.replace(new RegExp(DSTAR + '/', 'g'), '(.+/)?');
  p = p.replace(new RegExp(DSTAR, 'g'), '.*');

  return new RegExp(`^${p}($|/.*$)`);
}

function escapeRegex(s: string): string {
  // Escape all regex special chars including *, so that ** and * can be
  // handled explicitly after this call using the \* placeholder convention.
  return s.replace(/[.+*^${}()|[\]\\]/g, '\\$&');
}

/**
 * Test a repo-root-relative path (forward slashes) against a pattern.
 */
export function matchesGlob(repoRelPath: string, pattern: string): boolean {
  return globToRegex(pattern).test(repoRelPath);
}

// ─── Hard screen helpers ──────────────────────────────────────────────────────

/**
 * Returns true if the file should be hard-screened out regardless of user policy.
 * Binary files are detected by extension only (no byte-scan) for speed.
 */
export function isBinaryByExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

// ─── isKnownNoise ─────────────────────────────────────────────────────────────

/**
 * Returns true when a file is almost certainly indexing noise.
 * Checks directory prefixes, exact filenames, extensions, suffix patterns,
 * and glob patterns — all from the explicit rule tables in rules.ts.
 */
export function isKnownNoise(repoRelPath: string): boolean {
  const basename = path.posix.basename(repoRelPath);
  const ext = path.posix.extname(repoRelPath).toLowerCase();
  const normalizedPath = repoRelPath.endsWith('/') ? repoRelPath : repoRelPath;

  // 1. Exact filename
  if (NOISE_EXACT_FILENAMES.has(basename)) return true;

  // 2. Extension
  if (NOISE_EXTENSIONS.has(ext)) return true;

  // 3. Directory prefix — check if any noise prefix appears at the start
  //    or as a full path segment anywhere in the path
  for (const prefix of NOISE_DIR_PREFIXES) {
    if (
      normalizedPath.startsWith(prefix) ||
      normalizedPath.includes('/' + prefix)
    ) {
      return true;
    }
  }

  // 4. Filename suffix patterns (e.g., .min.js, .bundle.js)
  for (const suffix of NOISE_FILENAME_SUFFIXES) {
    if (basename.endsWith(suffix)) return true;
  }

  // 5. Glob patterns
  for (const pattern of NOISE_GLOB_PATTERNS) {
    if (matchesGlob(normalizedPath, pattern)) return true;
  }

  return false;
}

// ─── isExecutionCritical ──────────────────────────────────────────────────────

/**
 * Returns true when a file is likely to participate in runtime execution.
 * Uses path segment analysis, filename suffix patterns, and known entry points.
 * Does NOT use import analysis (deferred to batch 3).
 */
export function isExecutionCritical(repoRelPath: string): boolean {
  const basename = path.posix.basename(repoRelPath);
  const ext = path.posix.extname(basename);
  const baseStem = basename.slice(0, -ext.length);

  // 1. Known entry-point filenames (only at app root level — shallow depth)
  //    A file like "index.ts" at depth > 3 is less likely to be an entry point
  const depth = repoRelPath.split('/').length;
  if (EXECUTION_CRITICAL_ENTRY_FILENAMES.has(basename) && depth <= 4) {
    return true;
  }

  // 2. Root-level config files
  if (EXECUTION_CRITICAL_CONFIG_FILENAMES.has(basename) && depth <= 3) {
    return true;
  }

  // 3. Filename suffix patterns (e.g., .service.ts, .reducer.ts)
  for (const pattern of EXECUTION_CRITICAL_FILENAME_PATTERNS) {
    if (basename.endsWith(pattern)) return true;
  }

  // 4. Directory segment membership
  //    Check every segment of the path (not just the immediate parent)
  const segments = repoRelPath.split('/');
  for (const segment of segments.slice(0, -1)) { // exclude filename
    if (EXECUTION_CRITICAL_DIR_SEGMENTS.has(segment)) return true;
  }

  return false;
}

// ─── isFrameworkCritical ─────────────────────────────────────────────────────

/**
 * Returns true when a file is required by the detected framework conventions.
 * Depends on detectRepoContext() — uses per-subtree framework mapping.
 */
export function isFrameworkCritical(repoRelPath: string, ctx: RepoContext): boolean {
  // Find the owning app context by longest matching prefix
  const owningCtx = findOwningContext(repoRelPath, ctx.appContexts);
  if (!owningCtx) return false;

  const basename = path.posix.basename(repoRelPath);

  switch (owningCtx.framework) {
    case 'next':
      return isNextCritical(repoRelPath, basename, owningCtx);
    case 'expo':
    case 'react-native':
      return isExpoCritical(repoRelPath, basename, owningCtx);
    case 'node':
      return isNodeCritical(basename, owningCtx);
    default:
      return false;
  }
}

function findOwningContext(
  repoRelPath: string,
  appContexts: AppContext[]
): AppContext | undefined {
  let best: AppContext | undefined;
  let bestLen = -1;

  for (const ctx of appContexts) {
    // Empty root means this context owns the entire repo root
    if (ctx.root === '') {
      if (bestLen < 0) {
        best = ctx;
        bestLen = 0;
      }
      continue;
    }
    const prefix = ctx.root.endsWith('/') ? ctx.root : ctx.root + '/';
    if (repoRelPath.startsWith(prefix) || repoRelPath === ctx.root) {
      if (ctx.root.length > bestLen) {
        best = ctx;
        bestLen = ctx.root.length;
      }
    }
  }

  return best;
}

function isNextCritical(repoRelPath: string, basename: string, owningCtx: AppContext): boolean {
  // Config files at the app root
  if (NEXT_CRITICAL_CONFIG_FILES.has(basename)) {
    const depth = repoRelPath.split('/').length - owningCtx.root.split('/').length;
    if (depth <= 1) return true;
  }

  // middleware.ts at app root or src/
  if (basename === 'middleware.ts' || basename === 'middleware.tsx') {
    const depth = repoRelPath.split('/').length - owningCtx.root.split('/').length;
    if (depth <= 2) return true;
  }

  // App Router: any file matching Next's special filenames under app/
  const segments = repoRelPath.split('/');
  const appIdx = segments.indexOf('app');
  const srcIdx = segments.indexOf('src');
  const isUnderApp = appIdx !== -1 && appIdx > segments.indexOf(owningCtx.root.split('/').pop() ?? '');
  const isUnderPages = segments.includes('pages');

  if (isUnderApp || isUnderPages) {
    for (const pattern of NEXT_CRITICAL_FILENAME_PATTERNS) {
      if (basename === pattern) return true;
    }
  }

  return false;
}

function isExpoCritical(repoRelPath: string, basename: string, owningCtx: AppContext): boolean {
  // Config files
  if (EXPO_CRITICAL_CONFIG_FILES.has(basename)) {
    const depth = repoRelPath.split('/').length - owningCtx.root.split('/').length;
    if (depth <= 1) return true;
  }

  // Expo Router: _layout files and special files under app/
  const isUnderApp = repoRelPath.includes('/app/') || repoRelPath.endsWith('/app');
  if (isUnderApp) {
    for (const pattern of EXPO_CRITICAL_FILENAME_PATTERNS) {
      if (basename === pattern) return true;
    }
  }

  return false;
}

function isNodeCritical(basename: string, owningCtx: AppContext): boolean {
  for (const pattern of NODE_CRITICAL_FILENAME_PATTERNS) {
    if (basename === pattern) return true;
  }
  return false;
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify a candidate file into FULL or EXCLUDED, with a reason code
 * and the source of that decision.
 */
export function classifyFile(
  file: CandidateFile,
  ctx: RepoContext,
  policy: ScopePolicy
): ScopeDecision {
  const p = file.path; // repo-root-relative, forward slashes

  // ── Step 1: Hard screens ────────────────────────────────────────────────────

  if (file.isBinary || isBinaryByExtension(file.ext)) {
    return {
      path: p, tier: 'EXCLUDED',
      reasonCode: 'HARD_SCREEN_BINARY',
      decisionSource: 'builtin',
      matchedRule: 'binary file',
    };
  }

  if (!policy.supportedExtensions.has(file.ext)) {
    return {
      path: p, tier: 'EXCLUDED',
      reasonCode: 'HARD_SCREEN_UNSUPPORTED_EXT',
      decisionSource: 'builtin',
      matchedRule: `unsupported extension: ${file.ext}`,
    };
  }

  if (file.size > policy.sizeLimitBytes) {
    return {
      path: p, tier: 'EXCLUDED',
      reasonCode: 'HARD_SCREEN_OVERSIZED',
      decisionSource: 'builtin',
      matchedRule: `file size ${file.size} exceeds limit ${policy.sizeLimitBytes}`,
    };
  }

  // ── Step 2: Force include ───────────────────────────────────────────────────

  for (const cp of policy.includePatterns) {
    if (cp.regex.test(p)) {
      return {
        path: p, tier: 'FULL',
        reasonCode: 'FORCE_INCLUDE',
        decisionSource: cp.source === 'cli' ? 'cli' : 'user-file',
        matchedRule: cp.raw,
      };
    }
  }

  // ── Step 3: Explicit ignore ─────────────────────────────────────────────────

  for (const cp of policy.ignorePatterns) {
    if (cp.regex.test(p)) {
      return {
        path: p, tier: 'EXCLUDED',
        reasonCode: 'USER_IGNORE',
        decisionSource: cp.source === 'cli' ? 'cli' : 'user-file',
        matchedRule: cp.raw,
      };
    }
  }

  // ── Step 4: Known noise ──────────────────────────────────────────────────────
  // Checked BEFORE framework/execution-critical so that build output directories
  // (dist/, .next/, etc.) are never promoted by name-based heuristics.

  if (isKnownNoise(p)) {
    return {
      path: p, tier: 'EXCLUDED',
      reasonCode: 'KNOWN_NOISE',
      decisionSource: 'builtin',
    };
  }

  // ── Step 5: Framework-critical ──────────────────────────────────────────────

  if (isFrameworkCritical(p, ctx)) {
    return {
      path: p, tier: 'FULL',
      reasonCode: 'FRAMEWORK_CRITICAL',
      decisionSource: 'builtin',
    };
  }

  // ── Step 6: Execution-critical ──────────────────────────────────────────────

  if (isExecutionCritical(p)) {
    return {
      path: p, tier: 'FULL',
      reasonCode: 'EXECUTION_CRITICAL',
      decisionSource: 'builtin',
    };
  }

  // ── Step 7: Default — FULL (no LIGHT tier in batch 1) ──────────────────────

  return {
    path: p, tier: 'FULL',
    reasonCode: 'DEFAULT_FULL',
    decisionSource: 'builtin',
  };
}
