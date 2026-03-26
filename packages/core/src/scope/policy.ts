/**
 * Scope policy loader — reads and merges all scope inputs.
 *
 * Precedence (highest first):
 *   1. CLI --include
 *   2. CLI --ignore
 *   3. .nirnexinclude
 *   4. .nirnexignore
 *   5. Built-in defaults
 *
 * Policy outputs compiled RegExp matchers so classification
 * does not re-parse patterns on every file.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ScopePolicy, CompiledPattern } from './types.js';
import { SUPPORTED_EXTENSIONS } from './rules.js';
import { globToRegex } from './classifier.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SIZE_LIMIT_BYTES = 1024 * 1024; // 1 MB

// Built-in ignore patterns (applied after user policy, before noise classifier)
// These are patterns so broad that they should always be ignored even without
// a .nirnexignore file.
const BUILTIN_IGNORE_PATTERNS: ReadonlyArray<string> = [
  'node_modules/**',
  '.git/**',
];

const NIRNEXIGNORE_FILENAME = '.nirnexignore';
const NIRNEXINCLUDE_FILENAME = '.nirnexinclude';

// ─── File reader ──────────────────────────────────────────────────────────────

function readPolicyFile(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));
  } catch {
    return [];
  }
}

// ─── Pattern compiler ─────────────────────────────────────────────────────────

function compilePattern(
  raw: string,
  source: CompiledPattern['source']
): CompiledPattern {
  return { raw, regex: globToRegex(raw), source };
}

function compilePatterns(
  raws: string[],
  source: CompiledPattern['source']
): CompiledPattern[] {
  return raws.map(r => compilePattern(r, source));
}

// ─── CLI option parsing ───────────────────────────────────────────────────────

export interface CliScopeOpts {
  /** Comma-separated ignore patterns from --ignore */
  ignore?: string;
  /** Comma-separated include paths from --include */
  include?: string;
  sizeLimitBytes?: number;
}

function splitCliPatterns(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Load and merge all scope inputs into a compiled ScopePolicy.
 *
 * Accepts repo root and optional CLI overrides.
 */
export function loadScopePolicy(repoRoot: string, cliOpts: CliScopeOpts = {}): ScopePolicy {
  // Read user files
  const userIgnorePatterns = readPolicyFile(path.join(repoRoot, NIRNEXIGNORE_FILENAME));
  const userIncludePatterns = readPolicyFile(path.join(repoRoot, NIRNEXINCLUDE_FILENAME));

  // Parse CLI patterns
  const cliIgnorePatterns = splitCliPatterns(cliOpts.ignore);
  const cliIncludePatterns = splitCliPatterns(cliOpts.include);

  // Build include matchers (CLI first for highest precedence)
  const includePatterns: CompiledPattern[] = [
    ...compilePatterns(cliIncludePatterns, 'cli'),
    ...compilePatterns(userIncludePatterns, 'nirnexinclude'),
  ];

  // Build ignore matchers (CLI first, then user file, then built-in)
  const ignorePatterns: CompiledPattern[] = [
    ...compilePatterns(cliIgnorePatterns, 'cli'),
    ...compilePatterns(userIgnorePatterns, 'nirnexignore'),
    ...compilePatterns([...BUILTIN_IGNORE_PATTERNS], 'builtin'),
  ];

  return {
    includePatterns,
    ignorePatterns,
    sizeLimitBytes: cliOpts.sizeLimitBytes ?? DEFAULT_SIZE_LIMIT_BYTES,
    supportedExtensions: SUPPORTED_EXTENSIONS,
  };
}

// ─── Policy summary for output ────────────────────────────────────────────────

export interface PolicySummary {
  hasNirnexIgnore: boolean;
  hasNirnexInclude: boolean;
  userIgnoreCount: number;
  userIncludeCount: number;
  cliIgnoreCount: number;
  cliIncludeCount: number;
}

export function describeScopePolicy(repoRoot: string, cliOpts: CliScopeOpts = {}): PolicySummary {
  const userIgnore = readPolicyFile(path.join(repoRoot, NIRNEXIGNORE_FILENAME));
  const userInclude = readPolicyFile(path.join(repoRoot, NIRNEXINCLUDE_FILENAME));
  return {
    hasNirnexIgnore: userIgnore.length > 0,
    hasNirnexInclude: userInclude.length > 0,
    userIgnoreCount: userIgnore.length,
    userIncludeCount: userInclude.length,
    cliIgnoreCount: splitCliPatterns(cliOpts.ignore).length,
    cliIncludeCount: splitCliPatterns(cliOpts.include).length,
  };
}
