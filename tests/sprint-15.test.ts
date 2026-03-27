/**
 * Sprint 15 — Stage Timeout Handling (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete only when every test passes.
 *
 * Coverage:
 *   1.  Types/Contracts          — StageTimeoutEvent, StageExecutionResult shapes
 *   2.  runStageWithTimeout      — fast handler (no timeout) → success
 *   3.  runStageWithTimeout      — slow handler → timed_out
 *   4.  runStageWithTimeout      — handler error (not timeout) → failed
 *   5.  TimeoutEvent fields       — correct on success, timeout, error
 *   6.  AbortSignal               — signal is aborted when timeout fires
 *   7.  onTimeout policies        — 'fail' maps to 'failed', 'degrade' maps to 'timed_out'
 *   8.  DEFAULT_STAGE_TIMEOUTS   — all 5 stages have explicit positive budgets
 *   9.  STAGE_TIMEOUT_POLICY     — SUFFICIENCY_GATE=fail, others=degrade
 *   10. STAGE_IS_CRITICAL        — SUFFICIENCY_GATE=true, others=false
 *   11. getStageTimeoutConfig    — returns correct config per stage + override support
 *   12. BoundTrace timeout fields — timedOut, timeoutMs, failureClass on timed-out traces
 *   13. Orchestrator result shape — stageTimeouts, degradedStages, executionWarnings present
 *   14. Orchestrator — critical timeout (SUFFICIENCY_GATE) → pipeline blocked
 *   15. Orchestrator — non-critical timeout → degraded, pipeline continues
 *   16. Orchestrator — stageTimeouts populated on timeout events
 *   17. Orchestrator — executionWarnings contain timeout description
 *   18. Backward compat           — existing fast pipeline still produces correct result
 *   19. Determinism               — same fast input → same timeout event structure
 *   20. No inline timeout hacks   — no timeout logic in stage validators/handlers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Imports under test ───────────────────────────────────────────────────────

import {
  runStageWithTimeout,
  type StageTimeoutConfig,
  type StageTimeoutEvent,
  type StageExecutionResult,
} from '../packages/core/src/pipeline/timeout.js';

import {
  DEFAULT_STAGE_TIMEOUTS,
  STAGE_TIMEOUT_POLICY,
  STAGE_IS_CRITICAL,
  getStageTimeoutConfig,
} from '../packages/core/src/config/stageTimeouts.js';

import {
  runOrchestrator,
  type OrchestratorResult,
} from '../packages/core/src/pipeline/orchestrator.js';

import type { BoundTrace } from '../packages/core/src/pipeline/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fastOk = async (_signal: AbortSignal) => ({ value: 42 });
const fastError = async (_signal: AbortSignal): Promise<never> => {
  throw new Error('handler error');
};
function slowHandler(sleepMs: number) {
  return async (signal: AbortSignal): Promise<{ value: number }> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ value: 1 }), sleepMs);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
}

const DEFAULT_CONFIG: StageTimeoutConfig = {
  stageId:    'INTENT_DETECT',
  timeoutMs:  100,
  onTimeout:  'degrade',
  isCritical: false,
};

// Minimal valid orchestrator output shapes
function makeIntentOutput() {
  return { primary: 'bug_fix', composite: false };
}
function makeEcoOutput() {
  return {
    intent:          { primary: 'bug_fix', composite: false },
    eco_dimensions:  {
      coverage:  { severity: 'pass', detail: '' },
      freshness: { severity: 'pass', detail: '' },
      mapping:   { severity: 'pass', detail: '' },
      conflict:  { severity: 'pass', detail: '', conflict_payload: null },
      graph:     { severity: 'pass', detail: '' },
    },
    confidence_score: 85,
  };
}
function makeGateOutput() {
  return { behavior: 'pass' as const, lane: 'A', reason: 'sufficient' };
}
function makeTeeOutput() {
  return { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] };
}
function makeLaneOutput() {
  return { lane: 'A', set_by: 'P4' as const, reason: 'pass' };
}

/** Handlers that all resolve immediately (happy-path pipeline). */
function makeFastHandlers() {
  return {
    INTENT_DETECT:    async () => makeIntentOutput(),
    ECO_BUILD:        async () => makeEcoOutput(),
    SUFFICIENCY_GATE: async () => makeGateOutput(),
    TEE_BUILD:        async () => makeTeeOutput(),
    CLASSIFY_LANE:    async () => makeLaneOutput(),
  };
}

// ─── 1. Types / Contracts ─────────────────────────────────────────────────────

describe('StageTimeoutEvent — contract', () => {
  it('has required fields: stage_id, started_at, ended_at, elapsed_ms, timeout_ms, timed_out, outcome, fallback_applied, failure_class, recoverable', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    const ev = result.timeoutEvent;
    expect(typeof ev.stage_id).toBe('string');
    expect(typeof ev.started_at).toBe('string');
    expect(typeof ev.ended_at).toBe('string');
    expect(typeof ev.elapsed_ms).toBe('number');
    expect(typeof ev.timeout_ms).toBe('number');
    expect(typeof ev.timed_out).toBe('boolean');
    expect(['success', 'timeout', 'failed']).toContain(ev.outcome);
    expect(typeof ev.fallback_applied).toBe('boolean');
    // failure_class is null on success, 'timeout' or 'error' on failure
    expect(ev.failure_class === null || typeof ev.failure_class === 'string').toBe(true);
    expect(typeof ev.recoverable).toBe('boolean');
  });

  it('StageExecutionResult has status, timedOut, timeoutEvent — always', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(['success', 'failed', 'timed_out']).toContain(result.status);
    expect(typeof result.timedOut).toBe('boolean');
    expect(result.timeoutEvent).toBeDefined();
  });

  it('StageTimeoutConfig has all required fields', () => {
    const cfg: StageTimeoutConfig = {
      stageId:    'ECO_BUILD',
      timeoutMs:  30_000,
      onTimeout:  'degrade',
      isCritical: false,
    };
    expect(cfg.stageId).toBe('ECO_BUILD');
    expect(cfg.timeoutMs).toBe(30_000);
    expect(cfg.onTimeout).toBe('degrade');
    expect(cfg.isCritical).toBe(false);
  });
});

// ─── 2. Fast handler — no timeout ────────────────────────────────────────────

describe('runStageWithTimeout — fast handler (no timeout)', () => {
  it('returns status=success when handler completes before timeout', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(result.status).toBe('success');
    expect(result.timedOut).toBe(false);
  });

  it('output is the resolved value of the handler', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(result.output).toEqual({ value: 42 });
  });

  it('timeoutEvent.timed_out is false', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(result.timeoutEvent.timed_out).toBe(false);
  });

  it('timeoutEvent.outcome is success', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(result.timeoutEvent.outcome).toBe('success');
  });

  it('timeoutEvent.failure_class is null on success', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(result.timeoutEvent.failure_class).toBeNull();
  });

  it('timeoutEvent.timeout_ms matches config', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(result.timeoutEvent.timeout_ms).toBe(DEFAULT_CONFIG.timeoutMs);
  });

  it('timeoutEvent.stage_id matches stageId', async () => {
    const result = await runStageWithTimeout('ECO_BUILD', fastOk, { ...DEFAULT_CONFIG, stageId: 'ECO_BUILD' });
    expect(result.timeoutEvent.stage_id).toBe('ECO_BUILD');
  });

  it('timeoutEvent timestamps are ISO 8601', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(() => new Date(result.timeoutEvent.started_at)).not.toThrow();
    expect(() => new Date(result.timeoutEvent.ended_at)).not.toThrow();
    expect(new Date(result.timeoutEvent.started_at).toISOString()).toBe(result.timeoutEvent.started_at);
  });

  it('elapsed_ms is non-negative', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(result.timeoutEvent.elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});

// ─── 3. Slow handler — timeout fires ─────────────────────────────────────────

describe('runStageWithTimeout — timeout fires', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns timedOut=true when handler exceeds timeoutMs', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timedOut).toBe(true);
  });

  it('status is timed_out when onTimeout=degrade', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.status).toBe('timed_out');
  });

  it('status is failed when onTimeout=fail (critical)', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'SUFFICIENCY_GATE', timeoutMs: 50, onTimeout: 'fail', isCritical: true };
    const p = runStageWithTimeout('SUFFICIENCY_GATE', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.status).toBe('failed');
  });

  it('timeoutEvent.timed_out is true', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timeoutEvent.timed_out).toBe(true);
  });

  it('timeoutEvent.outcome is timeout', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timeoutEvent.outcome).toBe('timeout');
  });

  it('timeoutEvent.failure_class is timeout', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timeoutEvent.failure_class).toBe('timeout');
  });

  it('timeoutEvent.fallback_applied is true when onTimeout=degrade', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timeoutEvent.fallback_applied).toBe(true);
  });

  it('timeoutEvent.fallback_applied is false when onTimeout=fail', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'SUFFICIENCY_GATE', timeoutMs: 50, onTimeout: 'fail', isCritical: true };
    const p = runStageWithTimeout('SUFFICIENCY_GATE', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timeoutEvent.fallback_applied).toBe(false);
  });

  it('timeoutEvent.recoverable is true when onTimeout=degrade and not critical', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timeoutEvent.recoverable).toBe(true);
  });

  it('timeoutEvent.recoverable is false when isCritical=true', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'SUFFICIENCY_GATE', timeoutMs: 50, onTimeout: 'fail', isCritical: true };
    const p = runStageWithTimeout('SUFFICIENCY_GATE', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timeoutEvent.recoverable).toBe(false);
  });

  it('output is undefined on timeout', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.output).toBeUndefined();
  });

  it('elapsed_ms is approximately ≥ timeoutMs', async () => {
    const slow = slowHandler(500);
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', slow, cfg);
    await vi.advanceTimersByTimeAsync(60);
    const result = await p;
    expect(result.timeoutEvent.elapsed_ms).toBeGreaterThanOrEqual(50);
  });
});

// ─── 4. Handler error (not timeout) ──────────────────────────────────────────

describe('runStageWithTimeout — handler error', () => {
  it('returns status=failed when handler throws', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastError, DEFAULT_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.timedOut).toBe(false);
  });

  it('error field is populated', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastError, DEFAULT_CONFIG);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('handler error');
  });

  it('timeoutEvent.outcome is failed', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastError, DEFAULT_CONFIG);
    expect(result.timeoutEvent.outcome).toBe('failed');
  });

  it('timeoutEvent.failure_class is error', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastError, DEFAULT_CONFIG);
    expect(result.timeoutEvent.failure_class).toBe('error');
  });

  it('timeoutEvent.timed_out is false on handler error', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastError, DEFAULT_CONFIG);
    expect(result.timeoutEvent.timed_out).toBe(false);
  });

  it('timeoutEvent.recoverable is false on handler error', async () => {
    const result = await runStageWithTimeout('INTENT_DETECT', fastError, DEFAULT_CONFIG);
    expect(result.timeoutEvent.recoverable).toBe(false);
  });
});

// ─── 5. AbortSignal ──────────────────────────────────────────────────────────

describe('runStageWithTimeout — AbortSignal', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('signal is aborted after timeout fires', async () => {
    let capturedSignal: AbortSignal | undefined;
    const handler = async (signal: AbortSignal) => {
      capturedSignal = signal;
      await new Promise((_res, rej) => {
        const t = setTimeout(() => _res({}), 1000);
        signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); });
      });
    };
    const cfg: StageTimeoutConfig = { stageId: 'ECO_BUILD', timeoutMs: 50, onTimeout: 'degrade', isCritical: false };
    const p = runStageWithTimeout('ECO_BUILD', handler as any, cfg);
    await vi.advanceTimersByTimeAsync(60);
    await p;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('signal is NOT aborted when handler completes before timeout', async () => {
    let capturedSignal: AbortSignal | undefined;
    const handler = async (signal: AbortSignal) => {
      capturedSignal = signal;
      return { value: 1 };
    };
    const result = await runStageWithTimeout('INTENT_DETECT', handler, DEFAULT_CONFIG);
    expect(result.timedOut).toBe(false);
    expect(capturedSignal?.aborted).toBe(false);
  });
});

// ─── 6. DEFAULT_STAGE_TIMEOUTS ────────────────────────────────────────────────

describe('DEFAULT_STAGE_TIMEOUTS', () => {
  it('all 5 stages have explicit timeout budgets', () => {
    const stages = ['INTENT_DETECT', 'ECO_BUILD', 'SUFFICIENCY_GATE', 'TEE_BUILD', 'CLASSIFY_LANE'];
    for (const stage of stages) {
      expect(DEFAULT_STAGE_TIMEOUTS[stage as keyof typeof DEFAULT_STAGE_TIMEOUTS]).toBeDefined();
    }
  });

  it('all timeout values are positive numbers', () => {
    for (const [, ms] of Object.entries(DEFAULT_STAGE_TIMEOUTS)) {
      expect(typeof ms).toBe('number');
      expect(ms).toBeGreaterThan(0);
    }
  });

  it('ECO_BUILD has a longer budget than CLASSIFY_LANE (knowledge build > policy eval)', () => {
    expect(DEFAULT_STAGE_TIMEOUTS['ECO_BUILD']).toBeGreaterThan(DEFAULT_STAGE_TIMEOUTS['CLASSIFY_LANE']);
  });

  it('SUFFICIENCY_GATE budget is shorter than ECO_BUILD (pure policy, no I/O)', () => {
    expect(DEFAULT_STAGE_TIMEOUTS['SUFFICIENCY_GATE']).toBeLessThan(DEFAULT_STAGE_TIMEOUTS['ECO_BUILD']);
  });
});

// ─── 7. STAGE_TIMEOUT_POLICY ─────────────────────────────────────────────────

describe('STAGE_TIMEOUT_POLICY', () => {
  it('SUFFICIENCY_GATE policy is fail (cannot degrade a gate verdict)', () => {
    expect(STAGE_TIMEOUT_POLICY['SUFFICIENCY_GATE']).toBe('fail');
  });

  it('INTENT_DETECT policy is degrade (recoverable with fallback)', () => {
    expect(STAGE_TIMEOUT_POLICY['INTENT_DETECT']).toBe('degrade');
  });

  it('ECO_BUILD policy is degrade', () => {
    expect(STAGE_TIMEOUT_POLICY['ECO_BUILD']).toBe('degrade');
  });

  it('TEE_BUILD policy is degrade', () => {
    expect(STAGE_TIMEOUT_POLICY['TEE_BUILD']).toBe('degrade');
  });

  it('CLASSIFY_LANE policy is degrade', () => {
    expect(STAGE_TIMEOUT_POLICY['CLASSIFY_LANE']).toBe('degrade');
  });
});

// ─── 8. STAGE_IS_CRITICAL ────────────────────────────────────────────────────

describe('STAGE_IS_CRITICAL', () => {
  it('SUFFICIENCY_GATE is critical (gate verdict is non-negotiable)', () => {
    expect(STAGE_IS_CRITICAL['SUFFICIENCY_GATE']).toBe(true);
  });

  it('INTENT_DETECT is not critical (fallback to unknown is safe)', () => {
    expect(STAGE_IS_CRITICAL['INTENT_DETECT']).toBe(false);
  });

  it('ECO_BUILD is not critical', () => {
    expect(STAGE_IS_CRITICAL['ECO_BUILD']).toBe(false);
  });

  it('TEE_BUILD is not critical', () => {
    expect(STAGE_IS_CRITICAL['TEE_BUILD']).toBe(false);
  });

  it('CLASSIFY_LANE is not critical', () => {
    expect(STAGE_IS_CRITICAL['CLASSIFY_LANE']).toBe(false);
  });
});

// ─── 9. getStageTimeoutConfig ─────────────────────────────────────────────────

describe('getStageTimeoutConfig', () => {
  it('returns config with stageId, timeoutMs, onTimeout, isCritical', () => {
    const cfg = getStageTimeoutConfig('ECO_BUILD');
    expect(cfg.stageId).toBe('ECO_BUILD');
    expect(typeof cfg.timeoutMs).toBe('number');
    expect(cfg.timeoutMs).toBeGreaterThan(0);
    expect(['fail', 'degrade']).toContain(cfg.onTimeout);
    expect(typeof cfg.isCritical).toBe('boolean');
  });

  it('timeoutMs matches DEFAULT_STAGE_TIMEOUTS when no override', () => {
    const cfg = getStageTimeoutConfig('ECO_BUILD');
    expect(cfg.timeoutMs).toBe(DEFAULT_STAGE_TIMEOUTS['ECO_BUILD']);
  });

  it('stageTimeoutOverrides overrides timeoutMs', () => {
    const cfg = getStageTimeoutConfig('ECO_BUILD', { ECO_BUILD: 999 });
    expect(cfg.timeoutMs).toBe(999);
  });

  it('override only applies to the specified stage', () => {
    const cfg = getStageTimeoutConfig('INTENT_DETECT', { ECO_BUILD: 999 });
    expect(cfg.timeoutMs).toBe(DEFAULT_STAGE_TIMEOUTS['INTENT_DETECT']);
  });

  it('SUFFICIENCY_GATE config is critical + fail', () => {
    const cfg = getStageTimeoutConfig('SUFFICIENCY_GATE');
    expect(cfg.isCritical).toBe(true);
    expect(cfg.onTimeout).toBe('fail');
  });
});

// ─── 10. BoundTrace timeout fields ───────────────────────────────────────────

describe('BoundTrace — timeout fields on timed-out stage', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('timed-out stage trace has timedOut=true', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}), // never resolves
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    const ecoResult = result.stageResults.find(r => r.stage === 'ECO_BUILD');
    expect(ecoResult).toBeDefined();
    expect((ecoResult?.trace as any).timedOut).toBe(true);
  });

  it('timed-out stage trace has timeoutMs set', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    const ecoResult = result.stageResults.find(r => r.stage === 'ECO_BUILD');
    expect((ecoResult?.trace as any).timeoutMs).toBe(50);
  });

  it('timed-out stage trace has failureClass=timeout', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    const ecoResult = result.stageResults.find(r => r.stage === 'ECO_BUILD');
    expect((ecoResult?.trace as any).failureClass).toBe('timeout');
  });
});

// ─── 11. OrchestratorResult shape ────────────────────────────────────────────

describe('OrchestratorResult — new timeout fields', () => {
  it('result has stageTimeouts field (array)', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    expect(Array.isArray(result.stageTimeouts)).toBe(true);
  });

  it('result has degradedStages field (array)', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    expect(Array.isArray(result.degradedStages)).toBe(true);
  });

  it('result has executionWarnings field (array)', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    expect(Array.isArray(result.executionWarnings)).toBe(true);
  });

  it('happy-path pipeline: stageTimeouts is empty', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    expect(result.stageTimeouts).toHaveLength(0);
  });

  it('happy-path pipeline: executionWarnings is empty', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    expect(result.executionWarnings).toHaveLength(0);
  });
});

// ─── 12. Orchestrator — critical timeout → pipeline blocked ──────────────────

describe('runOrchestrator — critical stage timeout (SUFFICIENCY_GATE)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('pipeline is blocked when SUFFICIENCY_GATE times out', async () => {
    const handlers = {
      ...makeFastHandlers(),
      SUFFICIENCY_GATE: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { SUFFICIENCY_GATE: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result.blocked).toBe(true);
  });

  it('blockedAt is SUFFICIENCY_GATE on timeout', async () => {
    const handlers = {
      ...makeFastHandlers(),
      SUFFICIENCY_GATE: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { SUFFICIENCY_GATE: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result.blockedAt).toBe('SUFFICIENCY_GATE');
  });

  it('completed is false when critical stage times out', async () => {
    const handlers = {
      ...makeFastHandlers(),
      SUFFICIENCY_GATE: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { SUFFICIENCY_GATE: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result.completed).toBe(false);
  });

  it('stageTimeouts contains SUFFICIENCY_GATE timeout event', async () => {
    const handlers = {
      ...makeFastHandlers(),
      SUFFICIENCY_GATE: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { SUFFICIENCY_GATE: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    const ev = result.stageTimeouts.find(e => e.stage_id === 'SUFFICIENCY_GATE');
    expect(ev).toBeDefined();
    expect(ev?.timed_out).toBe(true);
  });

  it('executionWarnings mentions SUFFICIENCY_GATE timeout', async () => {
    const handlers = {
      ...makeFastHandlers(),
      SUFFICIENCY_GATE: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { SUFFICIENCY_GATE: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    const warning = result.executionWarnings.find(w => w.includes('SUFFICIENCY_GATE'));
    expect(warning).toBeDefined();
  });
});

// ─── 13. Orchestrator — non-critical timeout → degrade, continue ──────────────

describe('runOrchestrator — non-critical stage timeout (ECO_BUILD)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('pipeline continues (not blocked) when ECO_BUILD times out', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result.blocked).toBe(false);
  });

  it('result is degraded when ECO_BUILD times out', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result.degraded).toBe(true);
  });

  it('stageTimeouts contains ECO_BUILD timeout event', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    const ev = result.stageTimeouts.find(e => e.stage_id === 'ECO_BUILD');
    expect(ev).toBeDefined();
    expect(ev?.timed_out).toBe(true);
  });

  it('executionWarnings contains ECO_BUILD warning', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    const warning = result.executionWarnings.find(w => w.includes('ECO_BUILD'));
    expect(warning).toBeDefined();
  });

  it('degradedStages contains ECO_BUILD', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result.degradedStages).toContain('ECO_BUILD');
  });

  it('finalLane is still defined after non-critical timeout', async () => {
    const handlers = {
      ...makeFastHandlers(),
      ECO_BUILD: (_: unknown) => new Promise<never>(() => {}),
    };
    const resultPromise = runOrchestrator({
      specPath: null,
      query: 'fix bug',
      stageTimeoutOverrides: { ECO_BUILD: 50 },
    }, handlers);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    // Pipeline completed (not blocked), so finalLane should be defined
    expect(result.finalLane).toBeDefined();
  });
});

// ─── 14. Backward compatibility ──────────────────────────────────────────────

describe('backward compat — existing fast pipeline', () => {
  it('happy-path pipeline still completes successfully', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    expect(result.completed).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('finalLane is A on happy path', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    expect(result.finalLane).toBe('A');
  });

  it('all 5 stages appear in stageResults on happy path', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    const stages = result.stageResults.map(r => r.stage);
    expect(stages).toContain('INTENT_DETECT');
    expect(stages).toContain('ECO_BUILD');
    expect(stages).toContain('SUFFICIENCY_GATE');
    expect(stages).toContain('TEE_BUILD');
    expect(stages).toContain('CLASSIFY_LANE');
  });

  it('stageResults all have status=ok on happy path', async () => {
    const result = await runOrchestrator({ specPath: null, query: 'test' }, makeFastHandlers());
    for (const r of result.stageResults) {
      expect(r.status).toBe('ok');
    }
  });
});

// ─── 15. Determinism ─────────────────────────────────────────────────────────

describe('runStageWithTimeout — determinism', () => {
  it('same fast handler produces identical timedOut=false result on repeat calls', async () => {
    const r1 = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    const r2 = await runStageWithTimeout('INTENT_DETECT', fastOk, DEFAULT_CONFIG);
    expect(r1.timedOut).toBe(r2.timedOut);
    expect(r1.status).toBe(r2.status);
    expect(r1.output).toEqual(r2.output);
    expect(r1.timeoutEvent.timed_out).toBe(r2.timeoutEvent.timed_out);
    expect(r1.timeoutEvent.outcome).toBe(r2.timeoutEvent.outcome);
  });
});
