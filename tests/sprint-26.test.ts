/**
 * Sprint 26 — nirnex report Command (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Core contract:
 *   generateReport() opens the ledger, assembles a RunEvidenceBundle, writes
 *   an HTML report and a JSON evidence bundle to .ai-index/reports/ (or a custom
 *   outDir), and returns a ReportResult describing what was written.
 *   listRuns() surfaces a summary table of all trace IDs available for reporting.
 *
 * Coverage:
 *
 * 1. generateReport basics
 *    1.1  generateReport with last:true returns success and writes HTML file
 *    1.2  HTML file is non-empty and contains <!DOCTYPE html>
 *    1.3  HTML file contains the trace_id
 *    1.4  JSON bundle is written alongside the HTML
 *    1.5  JSON bundle is valid JSON containing run_id matching trace_id
 *    1.6  generateReport writes files to .ai-index/reports/ by default
 *    1.7  generateReport returns the traceId that was reported
 *
 * 2. --id flag
 *    2.1  generateReport with specific traceId writes report for that trace
 *    2.2  generateReport with unknown traceId returns success:false
 *    2.3  Report file is named <traceId>.html
 *
 * 3. --compare flag
 *    3.1  generateReport with compareIds writes a comparison report
 *    3.2  Comparison HTML contains 'Comparison' section
 *    3.3  Comparison report file is named <b>-vs-<a>.html
 *
 * 4. --list behaviour
 *    4.1  listRuns returns an array of run summaries from the ledger
 *    4.2  Each run summary has trace_id and timestamp fields
 *    4.3  listRuns returns empty array when ledger has no entries
 *
 * 5. Edge cases
 *    5.1  generateReport with empty ledger returns success:false with error message
 *    5.2  Report for a run with no outcome record still generates but with integrity issues in the HTML
 *    5.3  generateReport with custom outDir writes to specified directory
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { initLedgerDb } from '../packages/core/src/runtime/ledger/writer.js';
import { appendLedgerEntry } from '../packages/core/src/runtime/ledger/writer.js';
import { getLedgerDbPath } from '../packages/core/src/runtime/ledger/schema.js';
import { generateReport, listRuns } from '../packages/cli/src/commands/report.js';
import type { LedgerEntry } from '../packages/core/src/runtime/ledger/types.js';

// ─── Factory helpers ───────────────────────────────────────────────────────────

function makeProject(): string {
  const dir = join(tmpdir(), `nirnex-report-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'nirnex.config.json'), JSON.stringify({ projectName: 'test' }), 'utf-8');
  return dir;
}

function makeDecisionEntry(traceId: string, requestId: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    schema_version: '1.0.0',
    ledger_id: randomUUID(),
    trace_id: traceId,
    request_id: requestId,
    timestamp: new Date().toISOString(),
    stage: 'knowledge',
    record_type: 'decision',
    actor: 'system',
    payload: {
      kind: 'decision',
      decision_name: 'intent_detected',
      decision_code: 'INTENT_DETECTED',
      input_refs: {},
      result: { status: 'pass' },
      rationale: { summary: 'Test intent', rule_refs: [] },
    },
    ...overrides,
  } as LedgerEntry;
}

function makeOutcomeEntry(traceId: string, requestId: string): LedgerEntry {
  return {
    schema_version: '1.0.0',
    ledger_id: randomUUID(),
    trace_id: traceId,
    request_id: requestId,
    timestamp: new Date().toISOString(),
    stage: 'outcome',
    record_type: 'outcome',
    actor: 'system',
    payload: {
      kind: 'outcome',
      completion_state: 'merged',
      final_lane: 'A',
      final_disposition_reason: 'All checks passed',
    },
  } as LedgerEntry;
}

// Seed a ledger DB with entries for a trace
function seedLedger(dir: string, traceId: string, requestId: string): void {
  const dbPath = getLedgerDbPath(dir);
  const db = initLedgerDb(dbPath);
  appendLedgerEntry(db, makeDecisionEntry(traceId, requestId));
  appendLedgerEntry(db, makeDecisionEntry(traceId, requestId, { stage: 'eco' }));
  appendLedgerEntry(db, makeOutcomeEntry(traceId, requestId));
  db.close();
}

const createdDirs: string[] = [];
afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ─── Section 1: generateReport basics ─────────────────────────────────────────

describe('1. generateReport basics', () => {
  it('1.1 generateReport with last:true returns success and writes HTML file', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, last: true });
    expect(result.success).toBe(true);
    expect(result.htmlPath).toBeDefined();
    expect(existsSync(result.htmlPath!)).toBe(true);
  });

  it('1.2 HTML file is non-empty and contains <!DOCTYPE html>', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, last: true });
    expect(result.success).toBe(true);
    const html = readFileSync(result.htmlPath!, 'utf-8');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('1.3 HTML file contains the trace_id', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, last: true });
    expect(result.success).toBe(true);
    const html = readFileSync(result.htmlPath!, 'utf-8');
    expect(html).toContain(traceId);
  });

  it('1.4 JSON bundle is written alongside the HTML', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, last: true });
    expect(result.success).toBe(true);
    expect(result.jsonPath).toBeDefined();
    expect(existsSync(result.jsonPath!)).toBe(true);
  });

  it('1.5 JSON bundle is valid JSON containing run_id matching trace_id', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, last: true });
    expect(result.success).toBe(true);
    const raw = readFileSync(result.jsonPath!, 'utf-8');
    const bundle = JSON.parse(raw);
    expect(bundle.run_id).toBe(traceId);
  });

  it('1.6 generateReport writes files to .ai-index/reports/ by default', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, last: true });
    expect(result.success).toBe(true);
    const defaultReportsDir = join(dir, '.ai-index', 'reports');
    expect(result.htmlPath!.startsWith(defaultReportsDir)).toBe(true);
  });

  it('1.7 generateReport returns the traceId that was reported', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, last: true });
    expect(result.success).toBe(true);
    expect(result.traceId).toBe(traceId);
  });
});

// ─── Section 2: --id flag ──────────────────────────────────────────────────────

describe('2. --id flag', () => {
  it('2.1 generateReport with specific traceId writes report for that trace', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, traceId });
    expect(result.success).toBe(true);
    expect(result.traceId).toBe(traceId);
    expect(existsSync(result.htmlPath!)).toBe(true);
  });

  it('2.2 generateReport with unknown traceId returns success:false', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, traceId: randomUUID() });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('2.3 Report file is named <traceId>.html', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const result = generateReport({ targetRoot: dir, traceId });
    expect(result.success).toBe(true);
    expect(result.htmlPath!).toMatch(new RegExp(`${traceId}\\.html$`));
  });
});

// ─── Section 3: --compare flag ────────────────────────────────────────────────

describe('3. --compare flag', () => {
  it('3.1 generateReport with compareIds writes a comparison report', () => {
    const dirA = makeProject();
    createdDirs.push(dirA);

    // Use the same project dir for both traces (both go into the same ledger)
    const traceA = randomUUID();
    const traceB = randomUUID();
    const requestId = randomUUID();
    seedLedger(dirA, traceA, requestId);
    seedLedger(dirA, traceB, requestId);

    const result = generateReport({ targetRoot: dirA, compareIds: [traceA, traceB] });
    expect(result.success).toBe(true);
    expect(result.htmlPath).toBeDefined();
    expect(existsSync(result.htmlPath!)).toBe(true);
  });

  it('3.2 Comparison HTML contains Comparison section', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceA = randomUUID();
    const traceB = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceA, requestId);
    seedLedger(dir, traceB, requestId);

    const result = generateReport({ targetRoot: dir, compareIds: [traceA, traceB] });
    expect(result.success).toBe(true);
    const html = readFileSync(result.htmlPath!, 'utf-8');
    expect(html.toLowerCase()).toContain('comparison');
  });

  it('3.3 Comparison report file is named <b>-vs-<a>.html', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceA = randomUUID();
    const traceB = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceA, requestId);
    seedLedger(dir, traceB, requestId);

    const result = generateReport({ targetRoot: dir, compareIds: [traceA, traceB] });
    expect(result.success).toBe(true);
    const expectedStem = `${traceB.slice(0, 12)}-vs-${traceA.slice(0, 12)}`;
    expect(result.htmlPath!).toContain(expectedStem);
    expect(result.htmlPath!).toMatch(/\.html$/);
  });
});

// ─── Section 4: --list behaviour ──────────────────────────────────────────────

describe('4. --list behaviour', () => {
  it('4.1 listRuns returns an array of run summaries from the ledger', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const runs = listRuns(dir);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThan(0);
  });

  it('4.2 Each run summary has trace_id and timestamp fields', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const runs = listRuns(dir);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run).toHaveProperty('trace_id');
      expect(run).toHaveProperty('timestamp');
      expect(typeof run.trace_id).toBe('string');
      expect(typeof run.timestamp).toBe('string');
    }
  });

  it('4.3 listRuns returns empty array when ledger has no entries', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    // Create an empty ledger (no entries)
    const dbPath = getLedgerDbPath(dir);
    const db = initLedgerDb(dbPath);
    db.close();

    const runs = listRuns(dir);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBe(0);
  });
});

// ─── Section 5: Edge cases ────────────────────────────────────────────────────

describe('5. Edge cases', () => {
  it('5.1 generateReport with empty ledger returns success:false with error message', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    // No ledger at all — no initLedgerDb call
    const result = generateReport({ targetRoot: dir, last: true });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('5.2 Report for a run with no outcome record still generates but with integrity issues in the HTML', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();

    // Seed only decision entries — no outcome record
    const dbPath = getLedgerDbPath(dir);
    const db = initLedgerDb(dbPath);
    appendLedgerEntry(db, makeDecisionEntry(traceId, requestId));
    appendLedgerEntry(db, makeDecisionEntry(traceId, requestId, { stage: 'eco' }));
    db.close();

    const result = generateReport({ targetRoot: dir, traceId });
    expect(result.success).toBe(true);
    expect(result.htmlPath).toBeDefined();
    expect(existsSync(result.htmlPath!)).toBe(true);
    const html = readFileSync(result.htmlPath!, 'utf-8');
    expect(html.toLowerCase()).toContain('integrity');
  });

  it('5.3 generateReport with custom outDir writes to specified directory', () => {
    const dir = makeProject();
    createdDirs.push(dir);
    const traceId = randomUUID();
    const requestId = randomUUID();
    seedLedger(dir, traceId, requestId);

    const customOut = join(dir, 'my-custom-reports');
    const result = generateReport({ targetRoot: dir, traceId, outDir: customOut });
    expect(result.success).toBe(true);
    expect(result.htmlPath!.startsWith(customOut)).toBe(true);
    expect(existsSync(result.htmlPath!)).toBe(true);
  });
});
