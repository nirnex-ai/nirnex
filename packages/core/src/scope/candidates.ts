/**
 * Candidate discovery — builds the file universe before classification.
 *
 * Source preference:
 *   1. git ls-files (tracked files — excludes .gitignored content)
 *   2. Filesystem walk (fallback for non-git repos)
 *
 * Hard filters applied here (before classification):
 *   - Unsupported extension (fast path — no binary check needed)
 *   - Binary by extension (fast, no I/O)
 *   - Oversized files
 *   - Obvious temp/cache paths
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { CandidateFile, ScopePolicy } from './types.js';
import { BINARY_EXTENSIONS } from './rules.js';

// ─── Hard-filter fast-paths ───────────────────────────────────────────────────

const HARDCODED_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
  'tmp',
  '.temp',
  '.turbo',
  '.vercel',
  '.netlify',
  'out',
  'storybook-static',
]);

function isBinaryExt(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

function toRepoRelative(absPath: string, repoRoot: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

// ─── Git-backed discovery ─────────────────────────────────────────────────────

function discoverViaGit(repoRoot: string, policy: ScopePolicy): CandidateFile[] | null {
  try {
    const output = execSync('git ls-files --cached --others --exclude-standard', {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    return output
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .flatMap((relPath): CandidateFile[] => {
        const ext = path.posix.extname(relPath).toLowerCase();
        if (!policy.supportedExtensions.has(ext)) return [];
        if (isBinaryExt(ext)) return [];

        const absPath = path.join(repoRoot, relPath);
        try {
          const stat = fs.statSync(absPath);
          if (!stat.isFile()) return [];
          return [{
            path: relPath,
            absPath,
            ext,
            size: stat.size,
            isBinary: false,
          }];
        } catch {
          return [];
        }
      });
  } catch {
    return null; // not a git repo or git not available
  }
}

// ─── Filesystem walk fallback ─────────────────────────────────────────────────

function walkFs(
  dir: string,
  repoRoot: string,
  policy: ScopePolicy,
  results: CandidateFile[]
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (HARDCODED_SKIP_DIRS.has(entry.name)) continue;
      walkFs(fullPath, repoRoot, policy, results);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!policy.supportedExtensions.has(ext)) continue;
    if (isBinaryExt(ext)) continue;

    let size = 0;
    try {
      size = fs.statSync(fullPath).size;
    } catch {
      continue;
    }

    const relPath = toRepoRelative(fullPath, repoRoot);
    results.push({ path: relPath, absPath: fullPath, ext, size, isBinary: false });
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the candidate file list from the repo.
 *
 * Returns repo-root-relative paths with forward slashes.
 * Does NOT apply classification — that is the classifier's job.
 * Only applies hard filters: extension allowlist, binary extension, size.
 */
export function discoverCandidates(
  repoRoot: string,
  policy: ScopePolicy
): CandidateFile[] {
  // Try git first
  const gitFiles = discoverViaGit(repoRoot, policy);

  const raw: CandidateFile[] = gitFiles ?? (() => {
    const acc: CandidateFile[] = [];
    walkFs(repoRoot, repoRoot, policy, acc);
    return acc;
  })();

  // Apply size limit (extension + binary already filtered above)
  return raw.filter(f => f.size <= policy.sizeLimitBytes);
}
