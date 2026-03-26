/**
 * Scope summary and explainability output.
 *
 * buildScopeSummary() — aggregates classification decisions for terminal output.
 * explainScope()      — re-classifies a single file and returns a human-readable
 *                       explanation of the decision. This is the trust surface.
 */

import type {
  ScopeDecision,
  ScopeSummary,
  ExplainScopeResult,
  RepoContext,
  ScopePolicy,
  ReasonCode,
  CandidateFile,
} from './types.js';
import { classifyFile } from './classifier.js';
import { SUPPORTED_EXTENSIONS } from './rules.js';
import fs from 'node:fs';
import path from 'node:path';

// ─── Reason explanations ──────────────────────────────────────────────────────

const REASON_EXPLANATIONS: Record<ReasonCode, string> = {
  HARD_SCREEN_BINARY: 'binary file — not parseable as TypeScript',
  HARD_SCREEN_OVERSIZED: 'file exceeds the configured size limit',
  HARD_SCREEN_UNSUPPORTED_EXT: 'extension is not in the supported list (.ts, .tsx)',
  FORCE_INCLUDE: 'explicitly included via .nirnexinclude or --include',
  USER_IGNORE: 'explicitly excluded via .nirnexignore or --ignore',
  FRAMEWORK_CRITICAL: 'required by the detected framework (Next.js/Expo/Node)',
  EXECUTION_CRITICAL: 'heuristic: path pattern matches runtime-bearing file',
  KNOWN_NOISE: 'heuristic: path matches a known build output, log, or asset pattern',
  DEFAULT_FULL: 'no specific rule matched — default is full indexing',
};

// ─── buildScopeSummary ────────────────────────────────────────────────────────

export function buildScopeSummary(
  decisions: ScopeDecision[],
  durationMs: number
): ScopeSummary {
  let fullCount = 0;
  let excludedCount = 0;
  const ignoreRuleCounts = new Map<string, { rule: string; source: string; count: number }>();
  const fullReasonCounts = new Map<ReasonCode, number>();

  for (const d of decisions) {
    if (d.tier === 'FULL') {
      fullCount++;
      fullReasonCounts.set(d.reasonCode, (fullReasonCounts.get(d.reasonCode) ?? 0) + 1);
    } else {
      excludedCount++;
      if (d.matchedRule) {
        const key = `${d.decisionSource}:${d.matchedRule}`;
        const existing = ignoreRuleCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          ignoreRuleCounts.set(key, { rule: d.matchedRule, source: d.decisionSource, count: 1 });
        }
      } else {
        const key = `${d.decisionSource}:${d.reasonCode}`;
        const existing = ignoreRuleCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          ignoreRuleCounts.set(key, { rule: d.reasonCode, source: d.decisionSource, count: 1 });
        }
      }
    }
  }

  const topIgnoreRules = [...ignoreRuleCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topFullReasons = [...fullReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  return {
    candidateCount: decisions.length,
    fullCount,
    excludedCount,
    topIgnoreRules,
    topFullReasons,
    durationMs,
  };
}

// ─── printScopeSummary ────────────────────────────────────────────────────────

export function printScopeSummary(summary: ScopeSummary): void {
  const bar = '─'.repeat(48);
  console.log(`\n${bar}`);
  console.log('  Nirnex Index — Scope Summary');
  console.log(bar);
  console.log(`  Candidates scanned : ${summary.candidateCount}`);
  console.log(`  FULL indexed       : ${summary.fullCount}`);
  console.log(`  EXCLUDED           : ${summary.excludedCount}`);

  if (summary.topIgnoreRules.length > 0) {
    console.log('\n  Top exclusion sources:');
    for (const r of summary.topIgnoreRules) {
      const src = r.source.padEnd(12);
      console.log(`    ${src}  ${r.rule.padEnd(32)}  ${r.count} files`);
    }
  }

  if (summary.topFullReasons.length > 0) {
    console.log('\n  FULL — reasons:');
    for (const r of summary.topFullReasons) {
      const label = r.reason.replace(/_/g, ' ').toLowerCase().padEnd(28);
      console.log(`    ${label}  ${r.count} files`);
    }
  }

  console.log(`\n  Duration: ${summary.durationMs.toFixed(0)}ms`);
  console.log(`${bar}\n`);
}

// ─── explainScope ─────────────────────────────────────────────────────────────

/**
 * Re-classify a single file path and return a human-readable explanation.
 * This is the primary debugging surface for scope decisions.
 *
 * The path can be absolute or repo-root-relative.
 */
export function explainScope(
  inputPath: string,
  repoRoot: string,
  ctx: RepoContext,
  policy: ScopePolicy
): ExplainScopeResult {
  // Normalize to repo-root-relative, forward slashes
  let repoRelPath: string;
  if (path.isAbsolute(inputPath)) {
    repoRelPath = path.relative(repoRoot, inputPath).split(path.sep).join('/');
  } else {
    repoRelPath = inputPath.replace(/^\.\//, '').split(path.sep).join('/');
  }

  const ext = path.posix.extname(repoRelPath).toLowerCase();
  const absPath = path.join(repoRoot, repoRelPath);

  // Build a CandidateFile (best-effort — file may not exist)
  let size = 0;
  try {
    size = fs.statSync(absPath).size;
  } catch {
    // File may not exist or be accessible
  }

  const file: CandidateFile = {
    path: repoRelPath,
    absPath,
    ext,
    size,
    isBinary: false, // extension check done inside classifier
  };

  const decision = classifyFile(file, ctx, policy);
  const categoryExplanation = REASON_EXPLANATIONS[decision.reasonCode] ??
    'unknown classification reason';

  return {
    path: repoRelPath,
    tier: decision.tier,
    reasonCode: decision.reasonCode,
    decisionSource: decision.decisionSource,
    matchedRule: decision.matchedRule,
    categoryExplanation,
  };
}

// ─── printExplainScope ────────────────────────────────────────────────────────

export function printExplainScope(result: ExplainScopeResult): void {
  const tierColor = result.tier === 'FULL'
    ? '\x1b[32m' // green
    : '\x1b[90m'; // gray
  const reset = '\x1b[0m';

  console.log('');
  console.log(`  Path          : ${result.path}`);
  console.log(`  Tier          : ${tierColor}${result.tier}${reset}`);
  console.log(`  Reason code   : ${result.reasonCode}`);
  console.log(`  Decision from : ${result.decisionSource}`);
  if (result.matchedRule) {
    console.log(`  Matched rule  : ${result.matchedRule}`);
  }
  console.log(`  Explanation   : ${result.categoryExplanation}`);
  console.log('');
}
