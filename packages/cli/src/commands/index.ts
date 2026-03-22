import { openDb, insertParsedModule, setMetaCommitHash, computeGraphEdges } from '@ai-delivery-os/core/dist/db.js';
import { parseFile } from '@ai-delivery-os/parser/dist/index.js';
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

export function indexCommand(args: string[]): void {
  const isRebuild = args.includes('--rebuild');
  const targetDir = process.cwd();

  const dbPath = path.join(targetDir, '.aidos.db');
  console.log('[dev index] Starting ' + (isRebuild ? 'full rebuild' : 'incremental update') + ' on ' + targetDir);
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

  for (const file of filesToProcess) {
    const parsed = parseFile(file);
    if (!parsed) continue;

    const myModule = detectModule(file, targetDir);

    const enrichedImports = parsed.imports.map((imp: any) => {
      const resolved = resolveImport(imp.source, file);
      let is_cross_module = false;
      if (resolved.is_local) {
        const theirModule = detectModule(resolved.resolved, targetDir);
        is_cross_module = myModule !== theirModule; // Simple cross-module heuristic
      }
      return {
        ...imp,
        resolved: resolved.resolved,
        is_local: resolved.is_local,
        is_cross_module
      };
    });

    insertParsedModule(db, {
      ...parsed,
      imports: enrichedImports
    });
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
  console.log('[dev index] Finished processing ' + filesToProcess.length + ' file(s) in ' + (t1 - t0).toFixed(2) + 'ms');
}
