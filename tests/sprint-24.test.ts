/**
 * Sprint 24 — Mid-Execution Steering Layer (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Core contract:
 *   Steering is bounded checkpoint control — not arbitrary mid-execution interruption.
 *   Checkpoints: before_stage_transition, after_stage_result.
 *   Actions are typed and validated against stage contracts.
 *   Every steering decision is ledgered as a first-class governance event.
 *   Steering is deterministic and policy-driven (no freeform LLM steering).
 *
 * Key distinctions:
 *   Guard  = "may this happen?" (block or allow)
 *   Steer  = "should this be shaped differently?" (modify, redirect, skip, reclassify)
 *
 * Coverage:
 *
 * A. Steering context construction (unit)
 *   1.  buildSteeringContext returns context with correct checkpoint and stage
 *   2.  SteeringContext.run_trace_id matches provided trace ID
 *   3.  SteeringContext.current_confidence populated when ECO confidence provided
 *   4.  SteeringContext.current_lane populated when lane provided
 *   5.  SteeringContext.steering_count reflects current intervention count
 *
 * B. Policy evaluation (unit)
 *   6.  evaluateWithPolicy with no matching rules → action='continue', reason='no_trigger'
 *   7.  evaluateWithPolicy with confidence-drop rule → reclassify_lane decision
 *   8.  evaluateWithPolicy is deterministic (same inputs → same output every call)
 *   9.  evaluateWithPolicy returns first-match decision (priority order)
 *
 * C. Action validation (unit)
 *   10. validateSteeringAction: 'continue' on any stage → always valid
 *   11. validateSteeringAction: modify_parameters with allowed param → valid
 *   12. validateSteeringAction: modify_parameters with disallowed param → rejected
 *   13. validateSteeringAction: redirect_action to allowed alternate → valid
 *   14. validateSteeringAction: action not in stage steering_modes → rejected
 *   15. validateSteeringAction: non-steerable stage rejects modify_parameters
 *
 * D. Execution queue (unit)
 *   16. ExecutionQueue initialized from STAGES has correct initial length
 *   17. ExecutionQueue.peek returns first stage without consuming it
 *   18. ExecutionQueue.next consumes and returns next stage (length decreases)
 *   19. ExecutionQueue.insertNext adds step before the next one
 *   20. ExecutionQueue.skipNext removes and marks stage as skipped in history
 *   21. ExecutionQueue.replaceNext replaces next step with new spec
 *   22. ExecutionQueue.insertNext returns false when maxInsertions reached (loop protection)
 *   23. ExecutionQueue.isExhausted returns true when all steps consumed
 *
 * E. Ledger integration (unit)
 *   24. 'steering' is a valid LedgerStage
 *   25. 'steering_evaluated' is a valid LedgerRecordType
 *   26. 'steering_applied' and 'steering_rejected' are valid LedgerRecordTypes
 *   27. validateSteeringEvaluatedRecord with required fields → valid
 *   28. Missing stage_name in steering_evaluated → validation error
 *   29. Invalid action in steering_applied → validation error
 *
 * F. Orchestrator integration
 *   30. enableSteering=true → steeringEvaluator called at before_stage_transition
 *   31. enableSteering=true → steeringEvaluator called at after_stage_result
 *   32. Steering is opt-in — evaluator not called when enableSteering absent
 *   33. skip_step at before_stage_transition → stage absent from stageResults
 *   34. abort_execution at before_stage_transition → pipeline halts (blocked=true)
 *   35. maxSteeringInterventions respected — evaluator not called beyond limit
 *   36. steering_applied entry written to ledger when action != 'continue'
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  buildSteeringContext,
  evaluateWithPolicy,
  validateSteeringAction,
  ExecutionQueue,
  MAX_STEERING_INTERVENTIONS,
  STAGE_STEERING_CONTRACTS,
  DEFAULT_STEERING_CONTRACT,
  type SteeringContext,
  type SteeringDecision,
  type SteeringAction,
  type StepSpec,
  type PolicyRule,
  type SteeringEvaluatedRecord,
  type SteeringAppliedRecord,
  type SteeringRejectedRecord,
} from '../packages/core/src/runtime/steering/index.js';

import {
  validateLedgerEntry,
  validatePayload,
} from '../packages/core/src/runtime/ledger/validators.js';

import {
  fromSteeringEvaluated,
  fromSteeringApplied,
} from '../packages/core/src/runtime/ledger/mappers.js';

import { LEDGER_TABLE_SQL } from '../packages/core/src/runtime/ledger/schema.js';

import { runOrchestrator } from '../packages/core/src/pipeline/orchestrator.js';

import { STAGES } from '../packages/core/src/pipeline/types.js';

import type { LedgerEntry } from '../packages/core/src/runtime/ledger/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(LEDGER_TABLE_SQL);
  return db;
}

function makeHandlers() {
  return {
    INTENT_DETECT: async () => ({ primary: 'test-intent', composite: false }),
    ECO_BUILD: async () => ({
      intent: { primary: 'test-intent', composite: false },
      eco_dimensions: {
        coverage:  { severity: 'pass',     detail: '' },
        freshness: { severity: 'pass',     detail: '' },
        mapping:   { severity: 'warn',     detail: '' },
        conflict:  { severity: 'pass',     detail: '', conflict_payload: null },
        graph:     { severity: 'escalate', detail: '' },
      },
      confidence_score: 72,
    }),
    SUFFICIENCY_GATE: async () => ({ behavior: 'pass' as const, lane: 'A', reason: 'sufficient' }),
    TEE_BUILD: async () => ({
      blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [],
    }),
    CLASSIFY_LANE: async () => ({ lane: 'A', set_by: 'P1' as const, reason: 'low risk' }),
  };
}

const CONTINUE_DECISION: SteeringDecision = {
  action: 'continue',
  reason_code: 'no_trigger',
  rationale: 'No steering needed',
  policy_refs: [],
};

function makeTrackingEvaluator(getDecision: (ctx: SteeringContext) => SteeringDecision = () => CONTINUE_DECISION) {
  const calls: SteeringContext[] = [];
  const evaluator = (ctx: SteeringContext): SteeringDecision => {
    calls.push(ctx);
    return getDecision(ctx);
  };
  return { evaluator, calls };
}

// ─── A. Steering context construction ─────────────────────────────────────────

describe('A. Steering context construction', () => {
  it('1. buildSteeringContext returns context with correct checkpoint and stage', () => {
    const ctx = buildSteeringContext({
      checkpoint: 'before_stage_transition',
      stage: 'ECO_BUILD',
      run_trace_id: 'tr_test',
    });
    expect(ctx.checkpoint).toBe('before_stage_transition');
    expect(ctx.stage).toBe('ECO_BUILD');
  });

  it('2. SteeringContext.run_trace_id matches provided trace ID', () => {
    const ctx = buildSteeringContext({
      checkpoint: 'before_stage_transition',
      stage: 'ECO_BUILD',
      run_trace_id: 'tr_my_specific_trace',
    });
    expect(ctx.run_trace_id).toBe('tr_my_specific_trace');
  });

  it('3. SteeringContext.current_confidence populated when ECO confidence provided', () => {
    const ctx = buildSteeringContext({
      checkpoint: 'after_stage_result',
      stage: 'ECO_BUILD',
      run_trace_id: 'tr_test',
      current_confidence: 65,
    });
    expect(ctx.current_confidence).toBe(65);
  });

  it('4. SteeringContext.current_lane populated when lane provided', () => {
    const ctx = buildSteeringContext({
      checkpoint: 'after_stage_result',
      stage: 'CLASSIFY_LANE',
      run_trace_id: 'tr_test',
      current_lane: 'C',
    });
    expect(ctx.current_lane).toBe('C');
  });

  it('5. SteeringContext.steering_count reflects current intervention count', () => {
    const ctx = buildSteeringContext({
      checkpoint: 'before_stage_transition',
      stage: 'TEE_BUILD',
      run_trace_id: 'tr_test',
      steering_count: 3,
    });
    expect(ctx.steering_count).toBe(3);
  });
});

// ─── B. Policy evaluation ──────────────────────────────────────────────────────

describe('B. Policy evaluation', () => {
  function makeCtx(overrides: Partial<SteeringContext> = {}): SteeringContext {
    return buildSteeringContext({
      checkpoint: 'before_stage_transition',
      stage: 'ECO_BUILD',
      run_trace_id: 'tr_test',
      ...overrides,
    });
  }

  it('6. evaluateWithPolicy with no matching rules → action=continue, reason=no_trigger', () => {
    const ctx = makeCtx();
    const decision = evaluateWithPolicy(ctx, []);
    expect(decision.action).toBe('continue');
    expect(decision.reason_code).toBe('no_trigger');
  });

  it('7. evaluateWithPolicy with confidence-drop rule → reclassify_lane decision', () => {
    const rule: PolicyRule = {
      id: 'low-confidence-reclassify',
      description: 'Reclassify when confidence drops below 50',
      condition: (ctx) => (ctx.current_confidence ?? 100) < 50,
      decision: () => ({
        action: 'reclassify_lane',
        reason_code: 'confidence_drop',
        rationale: 'Confidence too low — escalating to lane C',
        new_lane: 'C',
        policy_refs: ['rule:low-confidence-reclassify'],
        affects_lane: true,
      }),
    };
    const ctx = makeCtx({ current_confidence: 40 });
    const decision = evaluateWithPolicy(ctx, [rule]);
    expect(decision.action).toBe('reclassify_lane');
    expect(decision.reason_code).toBe('confidence_drop');
  });

  it('8. evaluateWithPolicy is deterministic (same inputs → same output every call)', () => {
    const rule: PolicyRule = {
      id: 'deterministic-rule',
      description: 'Fires when stage is SUFFICIENCY_GATE',
      condition: (ctx) => ctx.stage === 'SUFFICIENCY_GATE',
      decision: () => ({
        action: 'skip_step' as SteeringAction,
        reason_code: 'policy_rule_triggered',
        rationale: 'Skipping gate for test',
        policy_refs: ['rule:deterministic-rule'],
      }),
    };
    const ctx = makeCtx({ stage: 'SUFFICIENCY_GATE' });
    const d1 = evaluateWithPolicy(ctx, [rule]);
    const d2 = evaluateWithPolicy(ctx, [rule]);
    expect(d1.action).toBe(d2.action);
    expect(d1.reason_code).toBe(d2.reason_code);
  });

  it('9. evaluateWithPolicy returns first-match decision (priority order)', () => {
    const rule1: PolicyRule = {
      id: 'rule-1',
      description: 'Always fires',
      condition: () => true,
      decision: () => ({ ...CONTINUE_DECISION, rationale: 'rule-1 fired' }),
    };
    const rule2: PolicyRule = {
      id: 'rule-2',
      description: 'Also always fires',
      condition: () => true,
      decision: () => ({
        action: 'skip_step' as SteeringAction,
        reason_code: 'policy_rule_triggered',
        rationale: 'rule-2 fired',
        policy_refs: ['rule:2'],
      }),
    };
    const ctx = makeCtx();
    const decision = evaluateWithPolicy(ctx, [rule1, rule2]);
    // rule1 fires first
    expect(decision.rationale).toBe('rule-1 fired');
  });
});

// ─── C. Action validation ──────────────────────────────────────────────────────

describe('C. Action validation', () => {
  it('10. validateSteeringAction: continue on any stage → always valid', () => {
    const result = validateSteeringAction(CONTINUE_DECISION, 'ECO_BUILD', STAGE_STEERING_CONTRACTS['ECO_BUILD']!);
    expect(result.valid).toBe(true);
  });

  it('11. validateSteeringAction: modify_parameters with allowed param → valid', () => {
    // TEE_BUILD allows 'scope' mutation
    const decision: SteeringDecision = {
      action: 'modify_parameters',
      reason_code: 'parameter_out_of_bounds',
      rationale: 'Narrowing scope',
      modified_parameters: { scope: 'narrow' },
      policy_refs: [],
    };
    const result = validateSteeringAction(decision, 'TEE_BUILD', STAGE_STEERING_CONTRACTS['TEE_BUILD']!);
    expect(result.valid).toBe(true);
  });

  it('12. validateSteeringAction: modify_parameters with disallowed param → rejected', () => {
    const decision: SteeringDecision = {
      action: 'modify_parameters',
      reason_code: 'parameter_out_of_bounds',
      rationale: 'Mutating disallowed param',
      modified_parameters: { secret_override: 'x' }, // not in allowed mutations
      policy_refs: [],
    };
    const result = validateSteeringAction(decision, 'TEE_BUILD', STAGE_STEERING_CONTRACTS['TEE_BUILD']!);
    expect(result.valid).toBe(false);
    expect(result.rejection_reason).toBeDefined();
    expect(result.rejection_reason).toContain('secret_override');
  });

  it('13. validateSteeringAction: redirect_action to allowed alternate → valid', () => {
    // SUFFICIENCY_GATE allows redirect to TEE_BUILD in its alternate actions (if configured)
    // We test with a contract that explicitly allows it
    const contract = {
      ...STAGE_STEERING_CONTRACTS['SUFFICIENCY_GATE']!,
      steering_modes: ['continue', 'redirect_action'] as SteeringAction[],
      allowed_alternate_actions: ['TEE_BUILD'],
    };
    const decision: SteeringDecision = {
      action: 'redirect_action',
      reason_code: 'better_alternate_available',
      rationale: 'Redirect to TEE_BUILD',
      alternate_step: { stage_id: 'TEE_BUILD', type: 'stage' },
      policy_refs: [],
    };
    const result = validateSteeringAction(decision, 'SUFFICIENCY_GATE', contract);
    expect(result.valid).toBe(true);
  });

  it('14. validateSteeringAction: action not in stage steering_modes → rejected', () => {
    // INTENT_DETECT only allows continue, pause_for_clarification, abort_execution
    // trying skip_step should be rejected
    const decision: SteeringDecision = {
      action: 'skip_step',
      reason_code: 'policy_rule_triggered',
      rationale: 'Trying to skip intent',
      policy_refs: [],
    };
    const result = validateSteeringAction(decision, 'INTENT_DETECT', STAGE_STEERING_CONTRACTS['INTENT_DETECT']!);
    expect(result.valid).toBe(false);
    expect(result.rejection_reason).toBeDefined();
  });

  it('15. validateSteeringAction: non-steerable stage rejects modify_parameters', () => {
    const decision: SteeringDecision = {
      action: 'modify_parameters',
      reason_code: 'parameter_out_of_bounds',
      rationale: 'Trying to mutate non-steerable stage',
      modified_parameters: { x: 1 },
      policy_refs: [],
    };
    const result = validateSteeringAction(decision, 'UNKNOWN_STAGE', DEFAULT_STEERING_CONTRACT);
    expect(result.valid).toBe(false);
    expect(result.rejection_reason).toContain('not steerable');
  });
});

// ─── D. Execution queue ────────────────────────────────────────────────────────

describe('D. Execution queue', () => {
  it('16. ExecutionQueue initialized from STAGES has correct initial length', () => {
    const queue = new ExecutionQueue([...STAGES]);
    expect(queue.getRemaining()).toHaveLength(STAGES.length);
  });

  it('17. ExecutionQueue.peek returns first stage without consuming it', () => {
    const queue = new ExecutionQueue([...STAGES]);
    const peeked = queue.peek();
    expect(peeked?.stage_id).toBe(STAGES[0]);
    // peek does not consume
    expect(queue.getRemaining()).toHaveLength(STAGES.length);
  });

  it('18. ExecutionQueue.next consumes and returns next stage (length decreases)', () => {
    const queue = new ExecutionQueue([...STAGES]);
    const consumed = queue.next();
    expect(consumed?.stage_id).toBe(STAGES[0]);
    expect(queue.getRemaining()).toHaveLength(STAGES.length - 1);
  });

  it('19. ExecutionQueue.insertNext adds step before the next one', () => {
    const queue = new ExecutionQueue(['A', 'B', 'C'], 5);
    const inserted: StepSpec = { stage_id: 'X', type: 'stage', is_inserted: true };
    const success = queue.insertNext(inserted);
    expect(success).toBe(true);
    expect(queue.peek()?.stage_id).toBe('X');
    expect(queue.getRemaining()[1]?.stage_id).toBe('A');
  });

  it('20. ExecutionQueue.skipNext removes and marks stage as skipped in history', () => {
    const queue = new ExecutionQueue([...STAGES], 5);
    const skipped = queue.skipNext();
    expect(skipped?.stage_id).toBe(STAGES[0]);
    expect(queue.getRemaining()).toHaveLength(STAGES.length - 1);
    const history = queue.getHistory();
    expect(history.some(h => h.stage_id === STAGES[0] && h.status === 'skipped')).toBe(true);
  });

  it('21. ExecutionQueue.replaceNext replaces next step with new spec', () => {
    const queue = new ExecutionQueue([...STAGES]);
    const replacement: StepSpec = { stage_id: 'ECO_BUILD', type: 'stage', parameters: { scoped: true } };
    const replaced = queue.replaceNext(replacement);
    expect(replaced?.stage_id).toBe(STAGES[0]);
    expect(queue.peek()?.stage_id).toBe('ECO_BUILD');
    expect(queue.peek()?.parameters).toEqual({ scoped: true });
  });

  it('22. ExecutionQueue.insertNext returns false when maxInsertions reached (loop protection)', () => {
    const queue = new ExecutionQueue(['A', 'B'], 2);
    const step: StepSpec = { stage_id: 'X', type: 'stage' };
    expect(queue.insertNext(step)).toBe(true);
    expect(queue.insertNext(step)).toBe(true);
    // Third insertion exceeds max
    expect(queue.insertNext(step)).toBe(false);
    expect(queue.insertionCount).toBe(2);
  });

  it('23. ExecutionQueue.isExhausted returns true when all steps consumed', () => {
    const queue = new ExecutionQueue(['A', 'B'], 5);
    expect(queue.isExhausted()).toBe(false);
    queue.next();
    queue.next();
    expect(queue.isExhausted()).toBe(true);
  });
});

// ─── E. Ledger integration ─────────────────────────────────────────────────────

describe('E. Ledger integration', () => {
  it('24. steering is a valid LedgerStage', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'steering' as LedgerEntry['stage'],
      record_type: 'steering_evaluated' as LedgerEntry['record_type'],
      actor: 'system',
      payload: {
        kind: 'steering_evaluated',
        run_trace_id: 'tr_test',
        stage_name: 'ECO_BUILD',
        checkpoint: 'before_stage_transition',
        action_selected: 'continue',
        reason_code: 'no_trigger',
        rationale: 'test',
        policy_refs: [],
        steering_count: 0,
      } as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.errors.some(e => e.includes('unknown stage'))).toBe(false);
  });

  it('25. steering_evaluated is a valid LedgerRecordType', () => {
    const entry: LedgerEntry = {
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: 'tr_test',
      request_id: 'req_test',
      timestamp: new Date().toISOString(),
      stage: 'steering' as LedgerEntry['stage'],
      record_type: 'steering_evaluated' as LedgerEntry['record_type'],
      actor: 'system',
      payload: {
        kind: 'steering_evaluated',
        run_trace_id: 'tr_test',
        stage_name: 'ECO_BUILD',
        checkpoint: 'before_stage_transition',
        action_selected: 'continue',
        reason_code: 'no_trigger',
        rationale: 'test',
        policy_refs: [],
        steering_count: 0,
      } as unknown as LedgerEntry['payload'],
    };
    const result = validateLedgerEntry(entry);
    expect(result.errors.some(e => e.includes('unknown record_type'))).toBe(false);
  });

  it('26. steering_applied and steering_rejected are valid LedgerRecordTypes', () => {
    for (const rt of ['steering_applied', 'steering_rejected'] as const) {
      const entry: LedgerEntry = {
        schema_version: '1.0.0',
        ledger_id: randomUUID(),
        trace_id: 'tr_test',
        request_id: 'req_test',
        timestamp: new Date().toISOString(),
        stage: 'steering' as LedgerEntry['stage'],
        record_type: rt as LedgerEntry['record_type'],
        actor: 'system',
        payload: { kind: rt, run_trace_id: 'tr_test', stage_name: 'ECO_BUILD', checkpoint: 'before_stage_transition', action: 'continue', reason_code: 'no_trigger' } as unknown as LedgerEntry['payload'],
      };
      const result = validateLedgerEntry(entry);
      expect(result.errors.some(e => e.includes('unknown record_type')), `${rt} should be valid`).toBe(false);
    }
  });

  it('27. validateSteeringEvaluatedRecord with required fields → valid', () => {
    const record: SteeringEvaluatedRecord = {
      kind: 'steering_evaluated',
      run_trace_id: 'tr_test',
      stage_name: 'ECO_BUILD',
      checkpoint: 'before_stage_transition',
      action_selected: 'continue',
      reason_code: 'no_trigger',
      rationale: 'test rationale',
      policy_refs: [],
      steering_count: 0,
    };
    const result = validatePayload('steering_evaluated', record);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('28. Missing stage_name in steering_evaluated → validation error', () => {
    const { stage_name: _removed, ...partial } = {
      kind: 'steering_evaluated',
      run_trace_id: 'tr_test',
      stage_name: 'ECO_BUILD',
      checkpoint: 'before_stage_transition',
      action_selected: 'continue',
      reason_code: 'no_trigger',
      rationale: 'test',
      policy_refs: [],
      steering_count: 0,
    };
    const result = validatePayload('steering_evaluated', partial);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('stage_name'))).toBe(true);
  });

  it('29. Invalid action in steering_applied → validation error', () => {
    const record = {
      kind: 'steering_applied',
      run_trace_id: 'tr_test',
      stage_name: 'ECO_BUILD',
      checkpoint: 'before_stage_transition',
      action: 'definitely_not_a_valid_action',
      reason_code: 'no_trigger',
    };
    const result = validatePayload('steering_applied', record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('action'))).toBe(true);
  });
});

// ─── F. Orchestrator integration ──────────────────────────────────────────────

describe('F. Orchestrator integration', () => {
  it('30. enableSteering=true → steeringEvaluator called at before_stage_transition', async () => {
    const { evaluator, calls } = makeTrackingEvaluator();
    await runOrchestrator(
      { specPath: null, query: 'test', enableSteering: true, steeringEvaluator: evaluator },
      makeHandlers(),
    );
    const beforeCalls = calls.filter(c => c.checkpoint === 'before_stage_transition');
    expect(beforeCalls.length).toBeGreaterThan(0);
    // First before_stage_transition should be for INTENT_DETECT
    expect(beforeCalls[0].stage).toBe('INTENT_DETECT');
  });

  it('31. enableSteering=true → steeringEvaluator called at after_stage_result', async () => {
    const { evaluator, calls } = makeTrackingEvaluator();
    await runOrchestrator(
      { specPath: null, query: 'test', enableSteering: true, steeringEvaluator: evaluator },
      makeHandlers(),
    );
    const afterCalls = calls.filter(c => c.checkpoint === 'after_stage_result');
    expect(afterCalls.length).toBeGreaterThan(0);
  });

  it('32. Steering is opt-in — evaluator not called when enableSteering absent', async () => {
    const { evaluator, calls } = makeTrackingEvaluator();
    await runOrchestrator(
      { specPath: null, query: 'test', steeringEvaluator: evaluator }, // no enableSteering
      makeHandlers(),
    );
    expect(calls).toHaveLength(0);
  });

  it('33. skip_step at before_stage_transition → stage absent from stageResults', async () => {
    const entries: LedgerEntry[] = [];
    // Skip CLASSIFY_LANE (last stage — no downstream dependency)
    const evaluator = (ctx: SteeringContext): SteeringDecision => {
      if (ctx.stage === 'CLASSIFY_LANE' && ctx.checkpoint === 'before_stage_transition') {
        return {
          action: 'skip_step',
          reason_code: 'policy_rule_triggered',
          rationale: 'Skip lane classification for test',
          policy_refs: ['test:skip-classify-lane'],
        };
      }
      return CONTINUE_DECISION;
    };
    const result = await runOrchestrator(
      { specPath: null, query: 'test', enableSteering: true, steeringEvaluator: evaluator, onLedgerEntry: e => entries.push(e) },
      makeHandlers(),
    );
    const classifyLaneResult = result.stageResults.find(r => r.stage === 'CLASSIFY_LANE');
    expect(classifyLaneResult).toBeUndefined();
  });

  it('34. abort_execution at before_stage_transition → pipeline halts (blocked=true)', async () => {
    // Abort at ECO_BUILD
    const evaluator = (ctx: SteeringContext): SteeringDecision => {
      if (ctx.stage === 'ECO_BUILD' && ctx.checkpoint === 'before_stage_transition') {
        return {
          action: 'abort_execution',
          reason_code: 'insufficient_evidence_for_step',
          rationale: 'Aborting for test',
          policy_refs: ['test:abort'],
        };
      }
      return CONTINUE_DECISION;
    };
    const result = await runOrchestrator(
      { specPath: null, query: 'test', enableSteering: true, steeringEvaluator: evaluator },
      makeHandlers(),
    );
    expect(result.blocked).toBe(true);
    // ECO_BUILD and beyond should not be in stageResults
    expect(result.stageResults.some(r => r.stage === 'ECO_BUILD')).toBe(false);
  });

  it('35. maxSteeringInterventions respected — evaluator not called beyond limit', async () => {
    const { evaluator, calls } = makeTrackingEvaluator();
    const maxInterventions = 3;
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableSteering: true,
        steeringEvaluator: evaluator,
        maxSteeringInterventions: maxInterventions,
      },
      makeHandlers(),
    );
    expect(calls.length).toBeLessThanOrEqual(maxInterventions);
  });

  it('36. steering_applied entry written to ledger when action != continue', async () => {
    const entries: LedgerEntry[] = [];
    const evaluator = (ctx: SteeringContext): SteeringDecision => {
      // Reclassify lane at CLASSIFY_LANE after_stage_result
      if (ctx.stage === 'CLASSIFY_LANE' && ctx.checkpoint === 'after_stage_result') {
        return {
          action: 'reclassify_lane',
          reason_code: 'lane_escalation_required',
          rationale: 'Escalating to lane C',
          new_lane: 'C',
          policy_refs: ['test:reclassify'],
          affects_lane: true,
        };
      }
      return CONTINUE_DECISION;
    };
    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        enableSteering: true,
        steeringEvaluator: evaluator,
        onLedgerEntry: e => entries.push(e),
      },
      makeHandlers(),
    );
    const appliedEntries = entries.filter(e => e.record_type === 'steering_applied');
    expect(appliedEntries.length).toBeGreaterThan(0);
    const appliedPayload = appliedEntries[0].payload as SteeringAppliedRecord;
    expect(appliedPayload.action).toBe('reclassify_lane');
  });
});
