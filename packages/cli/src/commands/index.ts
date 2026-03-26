import {
  openDb,
  writeFullIndexRecord,
  writeExcludedIndexRecord,
  setMetaCommitHash,
  computeGraphEdges,
  checkSchemaVersionOrRebuild,
} from '@nirnex/core/dist/db.js';
import {
  discoverCandidates,
  detectRepoContext,
  loadScopePolicy,
  classifyFile,
  buildScopeSummary,
  printScopeSummary,
  explainScope,
  printExplainScope,
} from '@nirnex/core/dist/scope/index.js';
import { parseFileWithDiagnostics } from '@nirnex/parser/dist/index.js';
import { checkParserCompatibility } from '@nirnex/parser/dist/compatibility.js';
import { appendDebugLog, type CompatibilityContext } from '../utils/debug-log.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ─── Arg parsing ─────────────────────────────────────────────────────────────

interface IndexArgs {
  isRebuild: boolean;
  explainPath: string | null;
  cliIgnore: string | undefined;
  cliInclude: string | undefined;
}

function parseIndexArgs(args: string[]): IndexArgs {
  let isRebuild = false;
  let explainPath: string | null = null;
  let cliIgnore: string | undefined;
  let cliInclude: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--rebuild') {
      isRebuild = true;
    } else if (a === '--explain-scope') {
      explainPath = args[i + 1] ?? null;
      i++;
    } else if (a.startsWith('--explain-scope=')) {
      explainPath = a.slice('--explain-scope='.length);
    } else if (a === '--ignore') {
      cliIgnore = args[i + 1];
      i++;
    } else if (a.startsWith('--ignore=')) {
      cliIgnore = a.slice('--ignore='.length);
    } else if (a === '--include') {
      cliInclude = args[i + 1];
      i++;
    } else if (a.startsWith('--include=')) {
      cliInclude = a.slice('--include='.length);
    }
  }

  return { isRebuild, explainPath, cliIgnore, cliInclude };
}

// ─── Import / module helpers ──────────────────────────────────────────────────

function resolveImport(source: string, activePath: string): { resolved: string; is_local: boolean } {
  if (source.startsWith('.')) {
    const dir = path.dirname(activePath);
    const resolved = path.resolve(dir, source);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (fs.existsSync(resolved + ext)) {
        return { resolved: resolved + ext, is_local: true };
      }
    }
    return { resolved, is_local: true };
  }
  return { resolved: source, is_local: false };
}

function detectModule(fullPath: string, rootDir: string): string {
  const rel = path.relative(rootDir, fullPath);
  const parts = rel.split(path.sep);
  if (parts[0] === 'packages' && parts.length > 2) return parts[0] + '/' + parts[1];
  if (parts[0] === 'apps' && parts.length > 2) return parts[0] + '/' + parts[1];
  if (parts[0] === 'src' && parts.length > 2) return parts[0] + '/' + parts[1];
  return parts[0];
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface IndexResult {
  succeeded: number;
  failed: number;
  failedFiles: string[];
  durationMs: number;
  fullCount: number;
  excludedCount: number;
  debugLogPath?: string;
}

// ─── Main command ─────────────────────────────────────────────────────────────

export function indexCommand(args: string[], commandLabel?: string): IndexResult {
  const { isRebuild, explainPath, cliIgnore, cliInclude } = parseIndexArgs(args);
  const targetDir = process.cwd();
  const label = commandLabel ?? (isRebuild ? 'index --rebuild' : 'index');

  // ── --explain-scope mode ────────────────────────────────────────────────────
  if (explainPath !== null) {
    return runExplainScope(explainPath, targetDir);
  }

  // ── Schema version check ────────────────────────────────────────────────────
  const dbPath = path.join(targetDir, '.aidos.db');
  const schemaCheck = checkSchemaVersionOrRebuild(dbPath, isRebuild);

  if (schemaCheck.needsRebuild) {
    process.stderr.write(
      `\x1b[33m[nirnex index]\x1b[0m ${schemaCheck.message}\n`
    );
    process.exitCode = 1;
    return { succeeded: 0, failed: 0, failedFiles: [], durationMs: 0, fullCount: 0, excludedCount: 0 };
  }

  // ── Parser health check ─────────────────────────────────────────────────────
  const compat = checkParserCompatibility();

  if (!compat.healthy) {
    const failedTests = compat.smokeTests.filter(t => t.status === 'fail');
    process.stderr.write('\n\x1b[31m[nirnex index] Parser health check FAILED — aborting\x1b[0m\n');
    process.stderr.write(`  tree-sitter:            ${compat.treeSitterVersion ?? 'unknown'}\n`);
    process.stderr.write(`  tree-sitter-typescript: ${compat.treeSitterTypescriptVersion ?? 'unknown'}\n`);
    for (const t of failedTests) {
      process.stderr.write(`  ✖ smoke test "${t.name}" (${t.lang}): ${t.errorMessage}\n`);
    }
    process.stderr.write('\n  Fix: npm install -g @nirnex/cli\n\n');
    return { succeeded: 0, failed: 0, failedFiles: [], durationMs: 0, fullCount: 0, excludedCount: 0 };
  }

  if (!compat.inSupportedMatrix) {
    process.stderr.write(
      `\x1b[33m[nirnex index] Warning:\x1b[0m Parser versions outside the tested matrix.\n` +
      `  tree-sitter: ${compat.treeSitterVersion ?? 'unknown'} (supported: 0.21.x)\n` +
      `  tree-sitter-typescript: ${compat.treeSitterTypescriptVersion ?? 'unknown'} (supported: 0.23.x)\n` +
      `  Run: npm install -g @nirnex/cli to restore tested versions.\n`
    );
  }

  const t0 = performance.now();

  console.log(
    `[nirnex index] Starting ${isRebuild ? 'full rebuild' : 'incremental update'} on ${targetDir}`
  );

  // ── Stage 1: Load scope policy ──────────────────────────────────────────────
  const policy = loadScopePolicy(targetDir, { ignore: cliIgnore, include: cliInclude });

  // ── Stage 2: Detect repo context ────────────────────────────────────────────
  const ctx = detectRepoContext(targetDir);

  if (ctx.isMonorepo) {
    console.log(
      `[nirnex index] Monorepo detected — ${ctx.appContexts.length} package(s): ` +
      ctx.appContexts.map(a => `${a.root || '.'} (${a.framework})`).join(', ')
    );
  }

  // ── Stage 3: Discover candidates ────────────────────────────────────────────
  const candidates = discoverCandidates(targetDir, policy);

  // ── Stage 4: Classify files ──────────────────────────────────────────────────
  const decisions = candidates.map(file => classifyFile(file, ctx, policy));

  const fullFiles = decisions.filter(d => d.tier === 'FULL');
  const excludedFiles = decisions.filter(d => d.tier === 'EXCLUDED');

  // ── Stage 5: Incremental filter (for non-rebuild) ───────────────────────────
  let filesToIndex = fullFiles;

  if (!isRebuild) {
    try {
      const diffStr = execSync('git diff --name-only HEAD~1..HEAD', {
        encoding: 'utf8',
        cwd: targetDir,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const changedSet = new Set(
        diffStr.split('\n')
          .map(l => l.trim())
          .filter(Boolean)
          .map(f => f.split(path.sep).join('/'))
      );
      if (changedSet.size > 0) {
        filesToIndex = fullFiles.filter(d => changedSet.has(d.path));
        if (filesToIndex.length === 0) {
          // No FULL files changed — still open DB to write scope decisions
          filesToIndex = [];
        }
      }
    } catch {
      // Not a git repo or no previous commit — index all FULL files
    }
  }

  // ── Stage 6: Open DB ────────────────────────────────────────────────────────
  const db = openDb(dbPath);
  db.exec('BEGIN TRANSACTION');

  const compatCtx: CompatibilityContext = {
    treeSitterVersion: compat.treeSitterVersion,
    treeSitterTypescriptVersion: compat.treeSitterTypescriptVersion,
    inSupportedMatrix: compat.inSupportedMatrix,
  };

  let succeeded = 0;
  let failed = 0;
  const failedFiles: string[] = [];
  let debugLogPath: string | undefined;

  // ── Stage 7a: Index FULL files ───────────────────────────────────────────────
  for (const decision of filesToIndex) {
    const absPath = path.join(targetDir, decision.path);
    const result = parseFileWithDiagnostics(absPath);

    if (!result.ok) {
      failed++;
      failedFiles.push(decision.path);
      const logPath = appendDebugLog(targetDir, result.diagnostics, label, compatCtx);
      if (failed === 1) {
        debugLogPath = logPath;
        process.stderr.write(
          `[nirnex index]   parse failure at stage: ${result.diagnostics.stage}` +
          ` (${result.diagnostics.extension})\n` +
          `[nirnex index]   debug → ${path.relative(targetDir, logPath)}\n`
        );
      }
      // Still write an excluded record so --explain-scope can show what happened
      writeExcludedIndexRecord(db, decision.path, {
        ...decision,
        tier: 'EXCLUDED',
        reasonCode: 'HARD_SCREEN_BINARY',
        matchedRule: `parse failure: ${result.diagnostics.error_message}`,
      });
      continue;
    }

    const parsed = result.module;
    const myModule = detectModule(absPath, targetDir);

    const enrichedImports = parsed.imports.map((imp: any) => {
      const resolved = resolveImport(imp.source, absPath);
      let is_cross_module = false;
      if (resolved.is_local) {
        const theirModule = detectModule(resolved.resolved, targetDir);
        is_cross_module = myModule !== theirModule;
      }
      return { ...imp, resolved: resolved.resolved, is_local: resolved.is_local, is_cross_module };
    });

    writeFullIndexRecord(db, { ...parsed, imports: enrichedImports }, decision);
    succeeded++;
  }

  // ── Stage 7b: Write EXCLUDED presence records ────────────────────────────────
  // Only write records for files that are in scope of this run
  // (skip if incremental — excluded files don't change based on code diffs)
  if (isRebuild) {
    for (const decision of excludedFiles) {
      writeExcludedIndexRecord(db, decision.path, decision);
    }
  }

  computeGraphEdges(db);
  db.exec('COMMIT');

  try {
    const commitHash = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      cwd: targetDir,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    setMetaCommitHash(db, commitHash);
  } catch {
    // Not a git repo
  }

  const durationMs = performance.now() - t0;

  // ── Stage 8: Output ─────────────────────────────────────────────────────────
  if (failed === 0) {
    console.log(
      `[nirnex index] Indexed ${succeeded} file(s) in ${durationMs.toFixed(0)}ms`
    );
  } else {
    process.stderr.write(
      `[nirnex index] Degraded: ${succeeded} indexed, ${failed} failed in ${durationMs.toFixed(0)}ms\n`
    );
    for (const f of failedFiles) {
      process.stderr.write(`[nirnex index]   ✖ ${f}\n`);
    }
    if (failed > 1 && debugLogPath) {
      process.stderr.write(
        `[nirnex index] ${failed} parser failures → ${path.relative(targetDir, debugLogPath)}\n`
      );
    }
  }

  const summary = buildScopeSummary(decisions, durationMs);
  printScopeSummary(summary);

  return {
    succeeded,
    failed,
    failedFiles,
    durationMs,
    fullCount: fullFiles.length,
    excludedCount: excludedFiles.length,
    debugLogPath,
  };
}

// ─── --explain-scope handler ──────────────────────────────────────────────────

function runExplainScope(inputPath: string, targetDir: string): IndexResult {
  const policy = loadScopePolicy(targetDir);
  const ctx = detectRepoContext(targetDir);
  const result = explainScope(inputPath, targetDir, ctx, policy);
  printExplainScope(result);
  return { succeeded: 0, failed: 0, failedFiles: [], durationMs: 0, fullCount: 0, excludedCount: 0 };
}
