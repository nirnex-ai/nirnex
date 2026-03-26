import { execSync } from 'child_process';
import type Database from 'better-sqlite3';
import type { FreshnessSnapshot } from './types.js';

/**
 * Build a FreshnessSnapshot by comparing the index commit stored in the DB
 * against the current HEAD of the repository at `repoRoot`.
 *
 * All git interaction is isolated here — downstream functions receive only the
 * typed snapshot and never call git themselves.
 */
export function buildFreshnessSnapshot(
  repoRoot: string,
  db: InstanceType<typeof Database>,
): FreshnessSnapshot {
  const generatedAt = new Date().toISOString();

  // ── 1. Read the indexed commit from the database ──────────────────────────
  let indexedCommit = 'none';
  try {
    const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get('commit_hash') as
      | { value: string }
      | undefined;
    if (row?.value) indexedCommit = row.value;
  } catch {
    // DB read failure → treat as unindexed
  }

  // ── 2. Get current HEAD ───────────────────────────────────────────────────
  let headCommit = 'none';
  try {
    headCommit = execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Not a git repo or git unavailable — return a graceful unknown snapshot
    return {
      indexedCommit,
      headCommit: 'none',
      isStale: indexedCommit !== 'none', // if we have a commit but no HEAD, treat as stale
      changedFiles: [],
      changedFileStatuses: [],
      generatedAt,
    };
  }

  // ── 3. If commits match, the index is fresh ───────────────────────────────
  if (indexedCommit === headCommit) {
    return {
      indexedCommit,
      headCommit,
      isStale: false,
      changedFiles: [],
      changedFileStatuses: [],
      generatedAt,
    };
  }

  // ── 4. Stale: compute changed files between indexedCommit..HEAD ───────────
  const changedFiles: string[] = [];
  const changedFileStatuses: FreshnessSnapshot['changedFileStatuses'] = [];

  try {
    const baseRef = indexedCommit === 'none' ? 'HEAD~1' : indexedCommit;
    const diffOutput = execSync(
      `git diff --name-status ${baseRef}..HEAD`,
      { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (diffOutput) {
      for (const line of diffOutput.split('\n')) {
        if (!line.trim()) continue;

        const parts = line.split('\t');
        const statusChar = parts[0]?.[0] ?? 'M'; // first char is the status letter

        // Rename lines look like: R100\told-path\tnew-path
        const filePath = parts.length >= 3 ? parts[2] : parts[1];
        if (!filePath) continue;

        const changeType = parseGitStatus(statusChar);
        changedFiles.push(filePath);
        changedFileStatuses.push({ path: filePath, changeType });
      }
    }
  } catch {
    // git diff failed — treat all as unknown changed files
  }

  return {
    indexedCommit,
    headCommit,
    isStale: true,
    changedFiles,
    changedFileStatuses,
    generatedAt,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseGitStatus(
  letter: string,
): 'added' | 'modified' | 'deleted' | 'renamed' {
  switch (letter) {
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    default:  return 'modified'; // M, C, T, U, X, B → modified
  }
}
