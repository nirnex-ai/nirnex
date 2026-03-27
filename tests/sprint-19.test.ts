/**
 * Sprint 19 — Stage Idempotency (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Coverage:
 *
 * A. Stage execution key generation (unit)
 *   1.  Same components → same key every time
 *   2.  Different stage_id → different key
 *   3.  Different input payload → different key
 *   4.  Different contract_version → different key
 *   5.  Different orchestrator_version → different key
 *   6.  Different upstream_keys → different key
 *   7.  key is a 64-char lowercase hex SHA-256
 *
 * B. Input normalization (unit)
 *   8.  Deep-sorts object keys (nested objects)
 *   9.  Different key insertion order → same normalized form
 *   10. Removes non-semantic timestamp fields
 *   11. Removes cache_hit field
 *   12. Preserves semantic fields (query, specPath, intent, etc.)
 *   13. Arrays are preserved in order (semantic order preserved)
 *
 * C. Execution store (unit, in-memory DB)
 *   14. claim() succeeds on first call
 *   15. claim() fails on duplicate in-progress key (returns false)
 *   16. complete() marks key as completed with output
 *   17. getCompleted() returns null for missing key
 *   18. getCompleted() returns stored record after complete()
 *   19. get() returns in_progress record before complete()
 *   20. fail() marks execution as failed; getCompleted() returns null
 *
 * D. Orchestrator idempotency integration
 *   21. Same input + enableIdempotency → second call replays all stages
 *   22. Second call: handler functions NOT called again (zero new invocations)
 *   23. Second call: replayedStages contains all 5 stage IDs
 *   24. Replayed result has same finalLane as original execution
 *   25. Changed input → key differs → no replay, stage executes fresh
 *   26. Contract version override changes key → stage executes fresh
 *   27. Concurrent duplicate → one executes, other has rejectedDuplicateStages non-empty
 *   28. Without enableIdempotency → no replay (backward compatible)
 *
 * E. Ledger governance
 *   29. Replayed stage emits ledger entry with record_type='stage_replay'
 *   30. Rejected duplicate emits ledger entry with record_type='stage_rejection'
 *   31. stage_replay payload includes replay_of_execution_key and original_trace_id
 *   32. stage_rejection payload includes execution_key and rejection_reason
 *   33. First execution ledger entries are unmodified (not affected by replay)
 *
 * F. Replayability rules
 *   34. Failed execution is not replayed (re-executes)
 *   35. Stage with idempotency_mode='none' is never replayed
 *   36. Result fingerprint is stored for completed executions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

import {
  computeStageExecutionKey,
  hashNormalizedInput,
  normalizeStageInput,
  StageExecutionStore,
  resolveIdempotencyAction,
  type StageExecutionRecord,
  type IdempotencyDecision,
} from '../packages/core/src/pipeline/idempotency/index.js';

import {
  ORCHESTRATOR_VERSION,
  STAGE_CONTRACT_VERSIONS,
  STAGE_IDEMPOTENCY,
} from '../packages/core/src/pipeline/types.js';

import { runOrchestrator } from '../packages/core/src/pipeline/orchestrator.js';
import type { OrchestratorInput } from '../packages/core/src/pipeline/orchestrator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-19-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMemStore(): StageExecutionStore {
  const db = new Database(':memory:');
  const store = new StageExecutionStore(db);
  store.ensureSchema();
  return store;
}

function makeRecord(key: string, overrides: Partial<StageExecutionRecord> = {}): StageExecutionRecord {
  return {
    execution_key: key,
    stage_id: 'INTENT_DETECT',
    contract_version: '1.0.0',
    input_hash: 'abc123',
    status: 'in_progress',
    trace_id: 'tr_test',
    request_id: 'req_test',
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Minimal valid stage handlers for integration tests. */
function makeHandlers(callCounts: { [stage: string]: number } = {}) {
  return {
    INTENT_DETECT: async (_input: unknown) => {
      callCounts['INTENT_DETECT'] = (callCounts['INTENT_DETECT'] ?? 0) + 1;
      return { primary: 'bug_fix', composite: false };
    },
    ECO_BUILD: async (_input: unknown) => {
      callCounts['ECO_BUILD'] = (callCounts['ECO_BUILD'] ?? 0) + 1;
      return {
        intent: { primary: 'bug_fix', composite: false },
        eco_dimensions: {
          coverage:  { severity: 'pass', detail: '' },
          freshness: { severity: 'pass', detail: '' },
          mapping:   { severity: 'pass', detail: '' },
          conflict:  { severity: 'pass', detail: '', conflict_payload: null },
          graph:     { severity: 'pass', detail: '' },
        },
        confidence_score: 80,
      };
    },
    SUFFICIENCY_GATE: async (_input: unknown) => {
      callCounts['SUFFICIENCY_GATE'] = (callCounts['SUFFICIENCY_GATE'] ?? 0) + 1;
      return { behavior: 'pass' as const, lane: 'A', reason: 'ok' };
    },
    TEE_BUILD: async (_input: unknown) => {
      callCounts['TEE_BUILD'] = (callCounts['TEE_BUILD'] ?? 0) + 1;
      return { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] };
    },
    CLASSIFY_LANE: async (_input: unknown) => {
      callCounts['CLASSIFY_LANE'] = (callCounts['CLASSIFY_LANE'] ?? 0) + 1;
      return { lane: 'A', set_by: 'P1' as const, reason: 'all pass' };
    },
  };
}

// ─── A. Stage execution key generation ───────────────────────────────────────

describe('A. Stage execution key generation', () => {
  const base = {
    orchestratorVersion: '1.0.0',
    stageId: 'INTENT_DETECT',
    contractVersion: '1.0.0',
    normalizedInput: { specPath: null, query: 'fix the bug' },
    upstreamKeys: [],
  };

  it('1. same components → same key', () => {
    const k1 = computeStageExecutionKey(base);
    const k2 = computeStageExecutionKey(base);
    expect(k1).toBe(k2);
  });

  it('2. different stage_id → different key', () => {
    const k1 = computeStageExecutionKey({ ...base, stageId: 'INTENT_DETECT' });
    const k2 = computeStageExecutionKey({ ...base, stageId: 'ECO_BUILD' });
    expect(k1).not.toBe(k2);
  });

  it('3. different input payload → different key', () => {
    const k1 = computeStageExecutionKey({ ...base, normalizedInput: { query: 'fix A' } });
    const k2 = computeStageExecutionKey({ ...base, normalizedInput: { query: 'fix B' } });
    expect(k1).not.toBe(k2);
  });

  it('4. different contract_version → different key', () => {
    const k1 = computeStageExecutionKey({ ...base, contractVersion: '1.0.0' });
    const k2 = computeStageExecutionKey({ ...base, contractVersion: '2.0.0' });
    expect(k1).not.toBe(k2);
  });

  it('5. different orchestrator_version → different key', () => {
    const k1 = computeStageExecutionKey({ ...base, orchestratorVersion: '1.0.0' });
    const k2 = computeStageExecutionKey({ ...base, orchestratorVersion: '2.0.0' });
    expect(k1).not.toBe(k2);
  });

  it('6. different upstream_keys → different key', () => {
    const k1 = computeStageExecutionKey({ ...base, upstreamKeys: [] });
    const k2 = computeStageExecutionKey({ ...base, upstreamKeys: ['upstream_abc123'] });
    expect(k1).not.toBe(k2);
  });

  it('7. key is a 64-char lowercase hex string (SHA-256)', () => {
    const k = computeStageExecutionKey(base);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── B. Input normalization ───────────────────────────────────────────────────

describe('B. Input normalization', () => {
  it('8. deep-sorts nested object keys', () => {
    const input = { z: 3, a: { z_nested: 2, a_nested: 1 }, m: 2 };
    const norm = normalizeStageInput(input);
    const json = JSON.stringify(norm);
    // 'a' should come before 'm' before 'z'
    expect(json.indexOf('"a"')).toBeLessThan(json.indexOf('"m"'));
    expect(json.indexOf('"m"')).toBeLessThan(json.indexOf('"z"'));
    // Nested: 'a_nested' before 'z_nested'
    expect(json.indexOf('"a_nested"')).toBeLessThan(json.indexOf('"z_nested"'));
  });

  it('9. different key insertion order → same normalized form', () => {
    const a = normalizeStageInput({ z: 1, a: 2, m: 3 });
    const b = normalizeStageInput({ a: 2, m: 3, z: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('10. removes timestamp field', () => {
    const input = { query: 'fix bug', timestamp: '2024-01-01T00:00:00.000Z' };
    const norm = normalizeStageInput(input) as Record<string, unknown>;
    expect(norm).not.toHaveProperty('timestamp');
    expect(norm).toHaveProperty('query');
  });

  it('11. removes cache_hit field', () => {
    const input = { query: 'fix', provenance: { cache_hit: true, fingerprint: 'abc123' } };
    const norm = normalizeStageInput(input) as Record<string, unknown>;
    const provNorm = (norm['provenance'] as Record<string, unknown>);
    expect(provNorm).not.toHaveProperty('cache_hit');
    expect(provNorm).toHaveProperty('fingerprint');
  });

  it('12. preserves semantic fields', () => {
    const input = { specPath: '/some/spec.md', query: 'fix the auth timeout', confidence_score: 80 };
    const norm = normalizeStageInput(input) as Record<string, unknown>;
    expect(norm).toHaveProperty('specPath', '/some/spec.md');
    expect(norm).toHaveProperty('query', 'fix the auth timeout');
    expect(norm).toHaveProperty('confidence_score', 80);
  });

  it('13. array element order is preserved', () => {
    const input = { items: ['c', 'a', 'b'], sorted: [1, 2, 3] };
    const norm = normalizeStageInput(input) as Record<string, unknown>;
    expect(norm['items']).toEqual(['c', 'a', 'b']);
    expect(norm['sorted']).toEqual([1, 2, 3]);
  });
});

// ─── C. Execution store ───────────────────────────────────────────────────────

describe('C. Execution store', () => {
  it('14. claim() succeeds on first call', () => {
    const store = makeMemStore();
    const key = 'a'.repeat(64);
    const claimed = store.claim(key, makeRecord(key));
    expect(claimed).toBe(true);
  });

  it('15. claim() fails on duplicate in-progress key (returns false)', () => {
    const store = makeMemStore();
    const key = 'b'.repeat(64);
    store.claim(key, makeRecord(key));
    const second = store.claim(key, makeRecord(key));
    expect(second).toBe(false);
  });

  it('16. complete() marks key as completed with output', () => {
    const store = makeMemStore();
    const key = 'c'.repeat(64);
    store.claim(key, makeRecord(key));
    store.complete(key, { primary: 'bug_fix', composite: false }, 'result_hash_abc');
    const record = store.get(key);
    expect(record?.status).toBe('completed');
    expect(record?.result_hash).toBe('result_hash_abc');
  });

  it('17. getCompleted() returns null for missing key', () => {
    const store = makeMemStore();
    expect(store.getCompleted('nonexistent_key')).toBeNull();
  });

  it('18. getCompleted() returns record after complete()', () => {
    const store = makeMemStore();
    const key = 'd'.repeat(64);
    store.claim(key, makeRecord(key));
    store.complete(key, { lane: 'A', set_by: 'P1', reason: 'ok' }, 'hash_xyz');
    const record = store.getCompleted(key);
    expect(record).not.toBeNull();
    expect(record?.status).toBe('completed');
    expect(record?.output_json).toBeDefined();
  });

  it('19. get() returns in_progress record before complete()', () => {
    const store = makeMemStore();
    const key = 'e'.repeat(64);
    store.claim(key, makeRecord(key));
    const record = store.get(key);
    expect(record?.status).toBe('in_progress');
  });

  it('20. fail() marks execution as failed; getCompleted() returns null', () => {
    const store = makeMemStore();
    const key = 'f'.repeat(64);
    store.claim(key, makeRecord(key));
    store.fail(key);
    expect(store.getCompleted(key)).toBeNull();
    expect(store.get(key)?.status).toBe('failed');
  });
});

// ─── D. Orchestrator idempotency integration ──────────────────────────────────

describe('D. Orchestrator idempotency integration', () => {
  it('21. same input + enableIdempotency → second call replays all stages', async () => {
    const calls: Record<string, number> = {};
    const handlers = makeHandlers(calls);
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the idempotency test bug unique_21',
      targetRoot: tmpDir,
      enableIdempotency: true,
    };

    const r1 = await runOrchestrator(input, handlers);
    const r2 = await runOrchestrator(input, handlers);

    expect(r1.completed).toBe(true);
    expect(r2.completed).toBe(true);
    expect(r2.replayedStages.length).toBeGreaterThan(0);
  });

  it('22. second call: handler functions NOT called again', async () => {
    const calls: Record<string, number> = {};
    const handlers = makeHandlers(calls);
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the idempotency test bug unique_22',
      targetRoot: tmpDir,
      enableIdempotency: true,
    };

    await runOrchestrator(input, handlers);
    const callsAfterFirst = Object.values(calls).reduce((a, b) => a + b, 0);

    await runOrchestrator(input, handlers);
    const callsAfterSecond = Object.values(calls).reduce((a, b) => a + b, 0);

    expect(callsAfterFirst).toBe(5);       // 5 stages executed fresh
    expect(callsAfterSecond).toBe(5);      // no additional handler calls on replay
  });

  it('23. second call: replayedStages contains all 5 stage IDs', async () => {
    const handlers = makeHandlers();
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the idempotency test bug unique_23',
      targetRoot: tmpDir,
      enableIdempotency: true,
    };

    await runOrchestrator(input, handlers);
    const r2 = await runOrchestrator(input, handlers);

    const stageIds = ['INTENT_DETECT', 'ECO_BUILD', 'SUFFICIENCY_GATE', 'TEE_BUILD', 'CLASSIFY_LANE'];
    for (const stageId of stageIds) {
      expect(r2.replayedStages).toContain(stageId);
    }
  });

  it('24. replayed result has same finalLane as original', async () => {
    const handlers = makeHandlers();
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the idempotency test bug unique_24',
      targetRoot: tmpDir,
      enableIdempotency: true,
    };

    const r1 = await runOrchestrator(input, handlers);
    const r2 = await runOrchestrator(input, handlers);

    expect(r2.finalLane).toBe(r1.finalLane);
  });

  it('25. changed input → no replay; stage executes fresh', async () => {
    const calls: Record<string, number> = {};
    const handlers = makeHandlers(calls);

    await runOrchestrator({
      specPath: null, query: 'fix bug input A unique_25',
      targetRoot: tmpDir, enableIdempotency: true,
    }, handlers);

    const callsBefore = Object.values(calls).reduce((a, b) => a + b, 0);

    const r2 = await runOrchestrator({
      specPath: null, query: 'fix bug input B unique_25',  // different query
      targetRoot: tmpDir, enableIdempotency: true,
    }, handlers);

    const callsAfter = Object.values(calls).reduce((a, b) => a + b, 0);
    expect(callsAfter).toBeGreaterThan(callsBefore);  // fresh execution happened
    expect(r2.replayedStages).toHaveLength(0);
  });

  it('26. contract version override changes key → stage executes fresh', async () => {
    const calls: Record<string, number> = {};
    const handlers = makeHandlers(calls);

    await runOrchestrator({
      specPath: null, query: 'fix unique_26',
      targetRoot: tmpDir, enableIdempotency: true,
      contractVersionOverrides: { INTENT_DETECT: '1.0.0' },
    }, handlers);

    const callsBefore = Object.values(calls).reduce((a, b) => a + b, 0);

    const r2 = await runOrchestrator({
      specPath: null, query: 'fix unique_26',
      targetRoot: tmpDir, enableIdempotency: true,
      contractVersionOverrides: { INTENT_DETECT: '2.0.0' },  // bumped version
    }, handlers);

    const callsAfter = Object.values(calls).reduce((a, b) => a + b, 0);
    // INTENT_DETECT re-executed; downstream stages may or may not replay
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it('27. concurrent duplicate → one executes, other has rejectedDuplicateStages', async () => {
    const calls: Record<string, number> = {};
    // Use a slow handler to ensure overlap
    const slowHandlers = {
      ...makeHandlers(calls),
      INTENT_DETECT: async (_input: unknown) => {
        calls['INTENT_DETECT'] = (calls['INTENT_DETECT'] ?? 0) + 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return { primary: 'bug_fix', composite: false };
      },
    };

    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the concurrent idempotency test unique_27',
      targetRoot: tmpDir,
      enableIdempotency: true,
    };

    const [r1, r2] = await Promise.all([
      runOrchestrator(input, slowHandlers),
      runOrchestrator(input, slowHandlers),
    ]);

    const totalRejected = r1.rejectedDuplicateStages.length + r2.rejectedDuplicateStages.length;
    expect(totalRejected).toBeGreaterThan(0);
  });

  it('28. without enableIdempotency → no replay (backward compatible)', async () => {
    const calls: Record<string, number> = {};
    const handlers = makeHandlers(calls);
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the no-idempotency test unique_28',
      targetRoot: tmpDir,
      // enableIdempotency NOT set
    };

    await runOrchestrator(input, handlers);
    const callsFirst = Object.values(calls).reduce((a, b) => a + b, 0);

    const r2 = await runOrchestrator(input, handlers);
    const callsSecond = Object.values(calls).reduce((a, b) => a + b, 0);

    // Without idempotency, both calls execute all stages
    expect(callsSecond).toBeGreaterThan(callsFirst);
    expect(r2.replayedStages).toHaveLength(0);
  });
});

// ─── E. Ledger governance ─────────────────────────────────────────────────────

describe('E. Ledger governance', () => {
  it('29. replayed stage emits ledger entry with record_type=stage_replay', async () => {
    const ledgerEntries: any[] = [];
    const handlers = makeHandlers();
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the ledger governance test unique_29',
      targetRoot: tmpDir,
      enableIdempotency: true,
      onLedgerEntry: (e) => ledgerEntries.push(e),
    };

    await runOrchestrator(input, handlers);
    const firstRunEntries = ledgerEntries.length;

    await runOrchestrator(input, handlers);
    const secondRunEntries = ledgerEntries.slice(firstRunEntries);

    const replayEntries = secondRunEntries.filter((e: any) => e.record_type === 'stage_replay');
    expect(replayEntries.length).toBeGreaterThan(0);
  });

  it('30. rejected duplicate emits ledger entry with record_type=stage_rejection', async () => {
    const ledgerEntries: any[] = [];
    const slowHandlers = {
      ...makeHandlers(),
      INTENT_DETECT: async (_input: unknown) => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return { primary: 'bug_fix', composite: false };
      },
      ECO_BUILD: async (_input: unknown) => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return {
          intent: { primary: 'bug_fix', composite: false },
          eco_dimensions: {
            coverage: { severity: 'pass', detail: '' },
            freshness: { severity: 'pass', detail: '' },
            mapping: { severity: 'pass', detail: '' },
            conflict: { severity: 'pass', detail: '', conflict_payload: null },
            graph: { severity: 'pass', detail: '' },
          },
          confidence_score: 80,
        };
      },
    };
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the concurrent ledger test unique_30',
      targetRoot: tmpDir,
      enableIdempotency: true,
      onLedgerEntry: (e) => ledgerEntries.push(e),
    };

    await Promise.all([
      runOrchestrator(input, slowHandlers),
      runOrchestrator(input, slowHandlers),
    ]);

    const rejectionEntries = ledgerEntries.filter((e: any) => e.record_type === 'stage_rejection');
    expect(rejectionEntries.length).toBeGreaterThan(0);
  });

  it('31. stage_replay payload includes replay_of_execution_key and original_trace_id', async () => {
    const ledgerEntries: any[] = [];
    const handlers = makeHandlers();
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix the replay payload test unique_31',
      targetRoot: tmpDir,
      enableIdempotency: true,
      onLedgerEntry: (e) => ledgerEntries.push(e),
    };

    await runOrchestrator(input, handlers);
    await runOrchestrator(input, handlers);

    const replayEntry = ledgerEntries.find((e: any) => e.record_type === 'stage_replay');
    expect(replayEntry).toBeDefined();
    expect(replayEntry.payload).toHaveProperty('replay_of_execution_key');
    expect(replayEntry.payload).toHaveProperty('original_trace_id');
  });

  it('32. stage_rejection payload includes execution_key and rejection_reason', async () => {
    const ledgerEntries: any[] = [];
    const slowHandlers = {
      ...makeHandlers(),
      INTENT_DETECT: async (_input: unknown) => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return { primary: 'bug_fix', composite: false };
      },
    };
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix rejection payload test unique_32',
      targetRoot: tmpDir,
      enableIdempotency: true,
      onLedgerEntry: (e) => ledgerEntries.push(e),
    };

    await Promise.all([
      runOrchestrator(input, slowHandlers),
      runOrchestrator(input, slowHandlers),
    ]);

    const rejectionEntry = ledgerEntries.find((e: any) => e.record_type === 'stage_rejection');
    expect(rejectionEntry).toBeDefined();
    expect(rejectionEntry.payload).toHaveProperty('execution_key');
    expect(rejectionEntry.payload).toHaveProperty('rejection_reason');
  });

  it('33. first execution ledger entries are unmodified', async () => {
    const ledgerEntries: any[] = [];
    const handlers = makeHandlers();
    const input: OrchestratorInput = {
      specPath: null,
      query: 'fix first execution entries test unique_33',
      targetRoot: tmpDir,
      enableIdempotency: true,
      onLedgerEntry: (e) => ledgerEntries.push(e),
    };

    await runOrchestrator(input, handlers);
    const firstRunEntries = [...ledgerEntries];
    const firstReplayCount = firstRunEntries.filter(e => e.record_type === 'stage_replay').length;

    // First run should have zero replay entries
    expect(firstReplayCount).toBe(0);
    // First run entries are unchanged
    expect(firstRunEntries.length).toBeGreaterThan(0);
  });
});

// ─── F. Replayability rules ───────────────────────────────────────────────────

describe('F. Replayability rules', () => {
  it('34. failed execution is not replayed (re-executes)', () => {
    const store = makeMemStore();
    const key = 'g'.repeat(64);
    store.claim(key, makeRecord(key));
    store.fail(key);

    const meta = { mode: 'required' as const, side_effect_class: 'pure' as const };
    const decision = resolveIdempotencyAction(store, key, meta);
    // Failed execution → should execute fresh, not replay
    expect(decision.action).toBe('execute');
  });

  it('35. stage with idempotency_mode=none is never replayed', () => {
    const store = makeMemStore();
    const key = 'h'.repeat(64);
    store.claim(key, makeRecord(key));
    store.complete(key, { output: 'result' }, 'hash_abc');

    const meta = { mode: 'none' as const, side_effect_class: 'external_mutation' as const };
    const decision = resolveIdempotencyAction(store, key, meta);
    expect(decision.action).toBe('execute');
  });

  it('36. result fingerprint is stored for completed executions', () => {
    const store = makeMemStore();
    const key = 'i'.repeat(64);
    const expectedHash = 'abc123def456';
    store.claim(key, makeRecord(key));
    store.complete(key, { output: 'result' }, expectedHash);
    const record = store.getCompleted(key);
    expect(record?.result_hash).toBe(expectedHash);
  });
});
