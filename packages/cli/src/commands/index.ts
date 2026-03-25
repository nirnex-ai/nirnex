import { openDb, insertParsedModule, setMetaCommitHash, computeGraphEdges } from '@nirnex/core/dist/db.js';
import { parseFileWithDiagnostics } from '@nirnex/parser/dist/index.js';
import { checkParserCompatibility } from '@nirnex/parser/dist/compatibility.js';
import { appendDebugLog, type CompatibilityContext } from '../utils/debug-log.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function walkDir(dir: string, callback: (path: string) => void) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (f === 'node_modules' || f === 'dist' || f === '.git') continue;
    if (fs.statSync(full).isDirectory()) {
      walkDir(full, callback);
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      callback(full);
    }
  }
}

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
  if (parts[0] === 'src' && parts.length > 2) return parts[0] + '/' + parts[1];
  return parts[0];
}

export interface IndexResult {
  succeeded: number;
  failed: number;
  failedFiles: string[];
  durationMs: number;
  debugLogPath?: string;
}

export function indexCommand(args: string[], commandLabel?: string): IndexResult {
  const isRebuild = args.includes('--rebuild');
  const targetDir = process.cwd();
  const label = commandLabel ?? (isRebuild ? 'index --rebuild' : 'index');

  // ── Pre-flight: parser compatibility check ─────────────────────────────────
  const compat = checkParserCompatibility();

  if (!compat.healthy) {
    const failedTests = compat.smokeTests.filter(t => t.status === 'fail');
    process.stderr.write('\n\x1b[31m[nirnex index] Parser health check FAILED — aborting index\x1b[0m\n');
    process.stderr.write(`  tree-sitter:            ${compat.treeSitterVersion ?? 'unknown'}\n`);
    process.stderr.write(`  tree-sitter-typescript: ${compat.treeSitterTypescriptVersion ?? 'unknown'}\n`);
    for (const t of failedTests) {
      process.stderr.write(`  ✖ smoke test "${t.name}" (${t.lang}): ${t.errorMessage}\n`);
    }
    process.stderr.write('\n  Fix: npm install -g @nirnex/cli\n\n');
    return { succeeded: 0, failed: 0, failedFiles: [], durationMs: 0 };
  }

  if (!compat.inSupportedMatrix) {
    process.stderr.write(
      `\x1b[33m[nirnex index] Warning:\x1b[0m Parser dependency versions are outside the tested compatibility matrix.\n` +
      `  tree-sitter:            ${compat.treeSitterVersion ?? 'unknown'} (supported: 0.21.x)\n` +
      `  tree-sitter-typescript: ${compat.treeSitterTypescriptVersion ?? 'unknown'} (supported: 0.23.x)\n` +
      `  Smoke tests passed, but parse failures may still occur on complex files.\n` +
      `  Run: npm install -g @nirnex/cli to restore tested versions.\n`
    );
  }

  const dbPath = path.join(targetDir, '.aidos.db');
  console.log('[nirnex index] Starting ' + (isRebuild ? 'full rebuild' : 'incremental update') + ' on ' + targetDir);
  const t0 = performance.now();

  const db = openDb(dbPath);

  let filesToProcess: string[] = [];

  if (isRebuild) {
    walkDir(targetDir, (p) => filesToProcess.push(p));
  } else {
    try {
      const diffStr = execSync('git diff --name-only HEAD~1..HEAD', { encoding: 'utf8', cwd: targetDir });
      filesToProcess = diffStr.split('\n').filter(Boolean)
        .map(f => path.join(targetDir, f))
        .filter(f => (f.endsWith('.ts') || f.endsWith('.tsx')) && fs.existsSync(f));
    } catch (_err) {
      console.warn('Could not get changed files from git, falling back to all.');
      walkDir(targetDir, (p) => filesToProcess.push(p));
    }
  }

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

  for (const file of filesToProcess) {
    const result = parseFileWithDiagnostics(file);

    if (!result.ok) {
      failed++;
      failedFiles.push(file);

      // Write structured debug record — first failure prints the log path
      const logPath = appendDebugLog(targetDir, result.diagnostics, label, compatCtx);
      if (failed === 1) {
        debugLogPath = logPath;
        process.stderr.write(
          `[nirnex index]   suspected cause: ${result.diagnostics.stage} stage failure` +
          ` (${result.diagnostics.extension} / ${result.diagnostics.selected_language ?? 'unknown grammar'})\n` +
          `[nirnex index]   debug details → ${path.relative(targetDir, logPath)}\n`
        );
      }
      continue;
    }

    const parsed = result.module;
    const myModule = detectModule(file, targetDir);

    const enrichedImports = parsed.imports.map((imp: any) => {
      const resolved = resolveImport(imp.source, file);
      let is_cross_module = false;
      if (resolved.is_local) {
        const theirModule = detectModule(resolved.resolved, targetDir);
        is_cross_module = myModule !== theirModule;
      }
      return {
        ...imp,
        resolved: resolved.resolved,
        is_local: resolved.is_local,
        is_cross_module,
      };
    });

    insertParsedModule(db, { ...parsed, imports: enrichedImports });
    succeeded++;
  }

  computeGraphEdges(db);
  db.exec('COMMIT');

  try {
    const commitHash = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: targetDir }).trim();
    setMetaCommitHash(db, commitHash);
  } catch (_err) {
    // Ignore if not a git repo
  }

  const t1 = performance.now();
  const durationMs = t1 - t0;

  if (failed === 0) {
    console.log(
      `[nirnex index] Finished: ${succeeded}/${filesToProcess.length} file(s) indexed in ${durationMs.toFixed(2)}ms`
    );
  } else {
    process.stderr.write(
      `[nirnex index] Finished with degraded coverage: ${succeeded}/${filesToProcess.length} indexed, ` +
      `${failed} failed in ${durationMs.toFixed(2)}ms\n`
    );
    for (const f of failedFiles) {
      process.stderr.write(`[nirnex index]   ✖ ${path.relative(targetDir, f)}\n`);
    }
    if (failed > 1 && debugLogPath) {
      process.stderr.write(
        `[nirnex index] ${failed} parser failures recorded → ${path.relative(targetDir, debugLogPath)}\n`
      );
    }
  }

  return { succeeded, failed, failedFiles, durationMs, debugLogPath };
}
