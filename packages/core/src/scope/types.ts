/**
 * Shared types for the Nirnex scope-control system.
 *
 * Batch 1: FULL / EXCLUDED only. LIGHT is deferred until parseFileLight() exists.
 */

// ─── Core tier model ──────────────────────────────────────────────────────────

export type Tier = 'FULL' | 'EXCLUDED';

export type ReasonCode =
  // Hard screens — no override possible
  | 'HARD_SCREEN_BINARY'
  | 'HARD_SCREEN_OVERSIZED'
  | 'HARD_SCREEN_UNSUPPORTED_EXT'
  // User policy — explicit decisions
  | 'FORCE_INCLUDE'
  | 'USER_IGNORE'
  // Built-in classifier
  | 'FRAMEWORK_CRITICAL'
  | 'EXECUTION_CRITICAL'
  | 'KNOWN_NOISE'
  // Default
  | 'DEFAULT_FULL';

export type DecisionSource = 'cli' | 'user-file' | 'builtin';

// ─── Candidate discovery ──────────────────────────────────────────────────────

export interface CandidateFile {
  /** Repo-root-relative path, forward slashes, no leading ./ */
  path: string;
  /** Absolute path */
  absPath: string;
  ext: string;
  size: number;
  isBinary: boolean;
}

// ─── Classification output ────────────────────────────────────────────────────

export interface ScopeDecision {
  /** Repo-root-relative path */
  path: string;
  tier: Tier;
  reasonCode: ReasonCode;
  decisionSource: DecisionSource;
  /** The exact pattern or rule that triggered this decision */
  matchedRule?: string;
}

// ─── Repo context ─────────────────────────────────────────────────────────────

export type Framework =
  | 'next'
  | 'expo'
  | 'react-native'
  | 'node'
  | 'angular'
  | 'nuxt'
  | 'unknown';

export interface AppContext {
  /** Repo-root-relative path to this app/package root */
  root: string;
  framework: Framework;
}

export interface RepoContext {
  repoRoot: string;
  /** One entry per detected workspace package or app */
  appContexts: AppContext[];
  /** tsconfig.json paths per package root (for future resolver) */
  tsconfigPathsByRoot: Record<string, Record<string, string[]>>;
  isMonorepo: boolean;
}

// ─── Scope policy ─────────────────────────────────────────────────────────────

export interface CompiledPattern {
  /** Original pattern string for display */
  raw: string;
  /** Compiled regex for fast matching */
  regex: RegExp;
  /** Where this pattern came from */
  source: 'cli' | 'nirnexinclude' | 'nirnexignore' | 'builtin';
}

export interface ScopePolicy {
  includePatterns: CompiledPattern[];
  ignorePatterns: CompiledPattern[];
  sizeLimitBytes: number;
  supportedExtensions: Set<string>;
}

// ─── Explain / summary output ─────────────────────────────────────────────────

export interface ExplainScopeResult {
  path: string;
  tier: Tier;
  reasonCode: ReasonCode;
  decisionSource: DecisionSource;
  matchedRule?: string;
  categoryExplanation: string;
}

export interface ScopeSummary {
  candidateCount: number;
  fullCount: number;
  excludedCount: number;
  /** Top N rules by hit count */
  topIgnoreRules: Array<{ rule: string; source: string; count: number }>;
  topFullReasons: Array<{ reason: ReasonCode; count: number }>;
  durationMs: number;
}
