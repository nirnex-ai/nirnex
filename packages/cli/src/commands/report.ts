// Command: nirnex report
// Generate static HTML reports from Nirnex run data.

import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { initLedgerDb, LedgerReader, getLedgerDbPath } from '@nirnex/core/dist/ledger.js';
import {
  assembleReport,
  generateOptimisationHints,
  renderHtml,
  compareRuns,
} from '@nirnex/core/dist/reporting.js';

// ─── Output helpers ───────────────────────────────────────────────────────────

function tick(msg: string): void { process.stdout.write(`  \x1b[32m✔\x1b[0m ${msg}\n`); }
function info(msg: string): void { process.stdout.write(`  \x1b[90m·\x1b[0m ${msg}\n`); }
function warn(msg: string): void { process.stdout.write(`  \x1b[33m!\x1b[0m ${msg}\n`); }
function cross(msg: string): void { process.stdout.write(`  \x1b[31m✘\x1b[0m ${msg}\n`); }
function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function dim(s: string): string { return `\x1b[90m${s}\x1b[0m`; }

// ─── USAGE ────────────────────────────────────────────────────────────────────

const USAGE = `
nirnex report [options]

Generate a static HTML report from a Nirnex run.
Reports are written to .ai-index/reports/ alongside a JSON evidence bundle.

Options:
  --last              Report for the most recent run
  --list              List recent runs available for reporting
  --id <trace_id>     Report for a specific run
  --compare <a> <b>   Comparison report (b relative to baseline a)
  --out <dir>         Custom output directory (default: .ai-index/reports)
  --help, -h          Show this help

Examples:
  nirnex report --last
  nirnex report --id tr_abc123
  nirnex report --compare tr_old tr_new
  nirnex report --list
`;

// ─── Exported types ───────────────────────────────────────────────────────────

export interface ReportOptions {
  targetRoot: string;
  traceId?: string;
  last?: boolean;
  compareIds?: [string, string];  // [baseline, current]
  outDir?: string;
}

export interface ReportResult {
  success: boolean;
  htmlPath?: string;
  jsonPath?: string;
  traceId?: string;
  error?: string;
}

export interface RunSummaryRow {
  trace_id: string;
  timestamp: string;
  record_count: number;
}

// ─── listRuns ─────────────────────────────────────────────────────────────────

/**
 * Opens the ledger and returns distinct trace_ids with their earliest timestamp
 * and record count, ordered by most recent first.
 *
 * Returns [] if the ledger doesn't exist or is empty.
 */
export function listRuns(targetRoot: string, limit = 20): RunSummaryRow[] {
  const dbPath = getLedgerDbPath(targetRoot);
  if (!existsSync(dbPath)) return [];
  try {
    const db = initLedgerDb(dbPath);
    const rows = db.prepare(`
      SELECT trace_id,
             MIN(timestamp) as timestamp,
             COUNT(*) as record_count
      FROM ledger_entries
      GROUP BY trace_id
      ORDER BY MIN(timestamp) DESC
      LIMIT ?
    `).all(limit) as RunSummaryRow[];
    db.close();
    return rows;
  } catch {
    return [];
  }
}

// ─── fetchLatestTraceId ───────────────────────────────────────────────────────

/**
 * Returns the trace_id of the most recently written ledger entry.
 * Returns null if the ledger is missing or empty.
 */
export function fetchLatestTraceId(targetRoot: string): string | null {
  const dbPath = getLedgerDbPath(targetRoot);
  if (!existsSync(dbPath)) return null;
  try {
    const db = initLedgerDb(dbPath);
    const row = db.prepare(`
      SELECT trace_id FROM ledger_entries ORDER BY written_at DESC, timestamp DESC LIMIT 1
    `).get() as { trace_id: string } | undefined;
    db.close();
    return row?.trace_id ?? null;
  } catch {
    return null;
  }
}

// ─── generateReport ───────────────────────────────────────────────────────────

/**
 * Core report generation function.
 *
 * Resolves the trace(s) to report, assembles a RunEvidenceBundle, renders HTML,
 * writes both the JSON bundle and HTML file to outDir, and returns a ReportResult.
 */
export function generateReport(options: ReportOptions): ReportResult {
  try {
    const dbPath = getLedgerDbPath(options.targetRoot);
    if (!existsSync(dbPath)) {
      return { success: false, error: 'No ledger found. Run nirnex plan or a runtime hook first.' };
    }

    const db = initLedgerDb(dbPath);
    const reader = new LedgerReader(db);

    let activeBundle: ReturnType<typeof assembleReport>;
    let outFileStem: string;

    if (options.compareIds) {
      // ── Compare mode ──
      const [idA, idB] = options.compareIds;
      const entriesA = reader.buildTimeline(idA);
      const entriesB = reader.buildTimeline(idB);

      if (entriesA.length === 0 || entriesB.length === 0) {
        db.close();
        return { success: false, error: 'One or both trace IDs not found in ledger' };
      }

      const bundleA = assembleReport(entriesA);
      const bundleB = assembleReport(entriesB);

      bundleA.optimisation_hints = generateOptimisationHints(bundleA);
      bundleB.optimisation_hints = generateOptimisationHints(bundleB);
      bundleB.comparison = compareRuns(bundleA, bundleB);

      activeBundle = bundleB;
      outFileStem = `${idB.slice(0, 12)}-vs-${idA.slice(0, 12)}`;
    } else {
      // ── Single run mode ──
      let traceId: string | null | undefined = options.traceId;

      if (!traceId) {
        if (options.last) {
          traceId = fetchLatestTraceId(options.targetRoot);
        } else {
          db.close();
          return { success: false, error: 'Specify --last, --id <trace_id>, or --compare <a> <b>' };
        }
      }

      if (!traceId) {
        db.close();
        return { success: false, error: 'No runs found in ledger' };
      }

      const entries = reader.buildTimeline(traceId);
      if (entries.length === 0) {
        db.close();
        return { success: false, error: `No ledger entries found for trace: ${traceId}` };
      }

      activeBundle = assembleReport(entries);
      activeBundle.optimisation_hints = generateOptimisationHints(activeBundle);
      outFileStem = activeBundle.run_id;
    }

    // ── Determine output directory ──
    const outDir = options.outDir ?? path.join(options.targetRoot, '.ai-index', 'reports');
    mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, `${outFileStem}.json`);
    const htmlPath = path.join(outDir, `${outFileStem}.html`);

    writeFileSync(jsonPath, JSON.stringify(activeBundle, null, 2), 'utf-8');
    writeFileSync(htmlPath, renderHtml(activeBundle), 'utf-8');

    db.close();

    return {
      success: true,
      htmlPath,
      jsonPath,
      traceId: activeBundle.run_id,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── reportCommand ────────────────────────────────────────────────────────────

/**
 * CLI entry point for `nirnex report`.
 *
 * Parses CLI args and delegates to generateReport / listRuns.
 */
export function reportCommand(args: string[]): void {
  // ── Parse flags ──
  const help      = args.includes('--help') || args.includes('-h');
  const last      = args.includes('--last');
  const listFlag  = args.includes('--list') || (!last && args.indexOf('--id') === -1 && args.indexOf('--compare') === -1 && args.length === 0);

  const idIdx     = args.indexOf('--id');
  const traceId   = idIdx !== -1 ? args[idIdx + 1] : undefined;

  const compareIdx = args.indexOf('--compare');
  const compareA   = compareIdx !== -1 ? args[compareIdx + 1] : undefined;
  const compareB   = compareIdx !== -1 ? args[compareIdx + 2] : undefined;

  const outIdx  = args.indexOf('--out');
  const outDir  = outIdx !== -1 ? args[outIdx + 1] : undefined;

  // ── Require nirnex project ──
  const cwd = process.cwd();
  if (!existsSync(path.join(cwd, 'nirnex.config.json'))) {
    warn('Not a Nirnex project. Run nirnex setup first.');
    process.exit(1);
  }

  // ── Help ──
  if (help) {
    process.stdout.write(USAGE + '\n');
    return;
  }

  // ── List ──
  if (listFlag) {
    const runs = listRuns(cwd);
    if (runs.length === 0) {
      info('No runs found in ledger.');
      info('Runs are recorded by nirnex plan and runtime hooks.');
      return;
    }

    process.stdout.write(`\n${bold('Nirnex Runs')}\n\n`);

    const colW = { trace: 38, ts: 28, records: 8 };
    process.stdout.write(
      `  ${'Trace ID'.padEnd(colW.trace)}${'Timestamp'.padEnd(colW.ts)}${'Records'.padEnd(colW.records)}\n`
    );
    process.stdout.write(
      `  ${'-'.repeat(colW.trace)}${'-'.repeat(colW.ts)}${'-'.repeat(colW.records)}\n`
    );
    for (const run of runs) {
      process.stdout.write(
        `  ${run.trace_id.padEnd(colW.trace)}${run.timestamp.padEnd(colW.ts)}${String(run.record_count).padEnd(colW.records)}\n`
      );
    }

    process.stdout.write(
      `\n  Run ${dim('nirnex report --last')} or ${dim('nirnex report --id <trace_id>')} to generate a report.\n\n`
    );
    return;
  }

  // ── Compare ──
  if (compareIdx !== -1) {
    if (!compareA || !compareB) {
      cross('--compare requires two trace IDs');
      process.exit(1);
    }

    const result = generateReport({
      targetRoot: cwd,
      compareIds: [compareA, compareB],
      outDir,
    });

    if (!result.success) {
      cross(result.error ?? 'Report generation failed');
      process.exit(1);
    }

    tick(`Comparison report written`);
    info(`HTML  ${path.relative(cwd, result.htmlPath!)}`);
    info(`JSON  ${path.relative(cwd, result.jsonPath!)}`);
    process.stdout.write(`\n  Open: file://${path.resolve(result.htmlPath!)}\n\n`);
    return;
  }

  // ── Single run (--last or --id) ──
  const result = generateReport({ targetRoot: cwd, last, traceId, outDir });

  if (!result.success) {
    cross(result.error ?? 'Report generation failed');
    process.exit(1);
  }

  tick(`Report generated for ${result.traceId}`);
  process.stdout.write('\n');
  info(`HTML  ${path.relative(cwd, result.htmlPath!)}`);
  info(`JSON  ${path.relative(cwd, result.jsonPath!)}`);
  process.stdout.write(`\n  Open: file://${path.resolve(result.htmlPath!)}\n\n`);
}
