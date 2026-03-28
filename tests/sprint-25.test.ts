/**
 * Sprint 25 — Report System (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Core contract:
 *   The Report System assembles a RunEvidenceBundle from LedgerEntry streams.
 *   All rendering derives from the bundle — never the reverse.
 *   Failures are classified via FAILURE_TAXONOMY, causal chains are explicit,
 *   and the bundle integrity result is always visible, never silently suppressed.
 *
 * Coverage:
 *
 * 1. Failure Taxonomy
 *    1.1  FAILURE_TAXONOMY contains all required failure classes
 *    1.2  All required failure codes exist in FAILURE_TAXONOMY
 *    1.3  Each taxonomy entry has all required fields
 *    1.4  lookupFailureCode returns the correct entry for a known code
 *    1.5  lookupFailureCode('UNKNOWN_CODE') returns UNCLASSIFIED_FAILURE entry
 *
 * 2. Causality
 *    2.1  buildCausalGraph returns a graph from ReportEvent list
 *    2.2  Edge exists from A to B when B.causes contains A's event_id
 *    2.3  Chain A → B → C is identified with length 3
 *    2.4  findPrimaryChains returns chains ending at outcome/failure nodes
 *    2.5  Empty events array returns empty graph
 *
 * 3. Validators
 *    3.1  validateBundle returns { valid: true, issues: [] } for a complete valid bundle
 *    3.2  Missing outcome in stages returns issue of kind 'missing_outcome'
 *    3.3  Broken causal reference returns issue of kind 'broken_causal_ref'
 *    3.4  Bundle with no stages returns issues for the 5 expected stages
 *    3.5  Duplicate failure codes do not cause issues
 *    3.6  Confidence checkpoints out of order get flagged
 *
 * 4. Assembler
 *    4.1  assembleReport returns a RunEvidenceBundle
 *    4.2  Bundle run_id matches trace_id from entries
 *    4.3  Bundle.stages contains at least one stage per decision record
 *    4.4  Bundle.confidence.overall_confidence matches latest confidence snapshot
 *    4.5  Bundle.failures contains an entry when a refusal record exists
 *    4.6  Bundle.integrity.valid is false when entries are missing terminal outcome
 *    4.7  assembleReport([]) returns bundle with DATA_SNAPSHOT_INCOMPLETE integrity issue
 *    4.8  Bundle.raw_events contains all entries as ReportEvents
 *
 * 5. Optimisation Rules
 *    5.1  generateOptimisationHints returns an array of OptimisationHint
 *    5.2  EVIDENCE_ABSENT failures produce evidence retrieval suggestion
 *    5.3  POLICY_CONFIDENCE_BLOCK failures produce confidence improvement suggestion
 *    5.4  Override records in raw_events produce governance smell hint
 *    5.5  No failures returns empty or minimal hints
 *    5.6  Each hint has all required fields
 *
 * 6. HTML Renderer
 *    6.1  renderHtml returns a string
 *    6.2  Returned string contains <!DOCTYPE html>
 *    6.3  Returned string contains the run_id
 *    6.4  Returned string contains a section for Stage Timeline
 *    6.5  Returned string contains Failure Matrix section when failures exist
 *    6.6  Returned string contains a section for Causal Chains
 *    6.7  Returned string contains a section for Confidence & Evidence
 *    6.8  Returned string contains a section for Optimisation Hints
 *    6.9  Returned string contains a section for Report Integrity
 *    6.10 Returned string contains the embedded JSON bundle as a script tag
 *    6.11 When bundle.integrity.valid is false, HTML shows integrity warning prominently
 *    6.12 When bundle.comparison exists, HTML shows a comparison section
 *
 * 7. Integration
 *    7.1  Full pipeline LedgerEntry[] → assembleReport → renderHtml produces valid HTML
 *    7.2  compareRuns(bundleA, bundleB) returns a RunComparison
 *    7.3  compareRuns detects lane change between two runs
 *    7.4  compareRuns detects confidence delta
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

import { FAILURE_TAXONOMY, lookupFailureCode } from '../packages/core/src/runtime/reporting/failure-taxonomy.js';
import { buildCausalGraph, findPrimaryChains } from '../packages/core/src/runtime/reporting/causality.js';
import { validateBundle } from '../packages/core/src/runtime/reporting/validators.js';
import { assembleReport } from '../packages/core/src/runtime/reporting/assembler.js';
import { generateOptimisationHints } from '../packages/core/src/runtime/reporting/optimization-rules.js';
import { renderHtml } from '../packages/core/src/runtime/reporting/renderer/html.js';
import { compareRuns } from '../packages/core/src/runtime/reporting/index.js';

import type {
  RunEvidenceBundle,
  ReportEvent,
  StageRecord,
  FailureRecord,
} from '../packages/core/src/runtime/reporting/types.js';

import type { LedgerEntry } from '../packages/core/src/runtime/ledger/types.js';

// ─── Factory functions ────────────────────────────────────────────────────────

function makeReportEvent(overrides: Partial<ReportEvent> = {}): ReportEvent {
  return {
    event_id: randomUUID(),
    run_id: 'tr_test_run',
    stage: 'knowledge',
    timestamp: new Date().toISOString(),
    kind: 'decision',
    payload: {},
    causes: [],
    ...overrides,
  };
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    schema_version: '1.0.0',
    ledger_id: randomUUID(),
    trace_id: 'tr_test_run',
    request_id: 'req_test',
    timestamp: new Date().toISOString(),
    stage: 'knowledge',
    record_type: 'decision',
    actor: 'system',
    payload: {
      kind: 'decision',
      decision_name: 'test_decision',
      decision_code: 'DEC_001',
      input_refs: {},
      result: { status: 'pass' },
      rationale: { summary: 'test', rule_refs: [] },
    } as LedgerEntry['payload'],
    ...overrides,
  };
}

function makeStageRecord(
  stageId: string,
  status: StageRecord['status'] = 'ok',
  overrides: Partial<StageRecord> = {},
): StageRecord {
  return {
    stage_id: stageId,
    display_name: stageId.charAt(0).toUpperCase() + stageId.slice(1),
    status,
    failure_count: 0,
    warning_count: 0,
    failures: [],
    warnings: [],
    ...overrides,
  };
}

function makeFailureRecord(
  code: string,
  overrides: Partial<FailureRecord> = {},
): FailureRecord {
  const entry = FAILURE_TAXONOMY[code] ?? FAILURE_TAXONOMY['UNCLASSIFIED_FAILURE'];
  return {
    failure_id: randomUUID(),
    code: entry.code,
    class: entry.class,
    label: entry.label,
    severity: entry.default_severity,
    blocking: entry.default_blocking,
    recoverability: entry.recoverability,
    determinism: entry.determinism,
    message: `Test failure: ${code}`,
    cause_event_ids: [],
    source_event_id: randomUUID(),
    ...overrides,
  };
}

function makeMinimalBundle(overrides: Partial<RunEvidenceBundle> = {}): RunEvidenceBundle {
  const runId = 'tr_bundle_test';
  return {
    bundle_id: randomUUID(),
    schema_version: '1.0.0',
    run_id: runId,
    request_id: 'req_bundle_test',
    generated_at: new Date().toISOString(),
    summary: {
      run_id: runId,
      request_id: 'req_bundle_test',
      final_status: 'success',
      report_integrity_status: 'valid',
    },
    stages: [
      makeStageRecord('knowledge', 'ok'),
      makeStageRecord('eco', 'ok'),
      makeStageRecord('classification', 'ok'),
      makeStageRecord('strategy', 'ok'),
      makeStageRecord('implementation', 'ok'),
    ],
    failures: [],
    causal_graph: {
      nodes: [],
      edges: [],
      primary_chains: [],
      secondary_chains: [],
    },
    confidence: {
      overall_confidence: 75,
      effective_confidence: 75,
      band: 'medium',
      dimensions: {},
      penalties: [],
      checkpoints: [
        {
          trigger: 'eco_complete',
          snapshot_index: 0,
          computed_confidence: 75,
          effective_confidence: 75,
          band: 'medium',
          stage_name: 'eco',
        },
      ],
    },
    knowledge_health: {
      absent_evidence: [],
      conflicting_evidence: [],
      stale_evidence: [],
      weak_evidence: [],
      dimension_scores: {},
      dimension_statuses: {},
    },
    optimisation_hints: [],
    raw_events: [
      makeReportEvent({ run_id: runId, kind: 'outcome', stage: 'outcome' }),
    ],
    integrity: {
      valid: true,
      issues: [],
      missing_stages: [],
      broken_causal_refs: [],
      unclassified_failure_codes: [],
    },
    ...overrides,
  };
}

// ─── 1. Failure Taxonomy ──────────────────────────────────────────────────────

describe('1. Failure Taxonomy', () => {
  const REQUIRED_CLASSES = [
    'input',
    'intent_scope',
    'evidence',
    'policy',
    'orchestration',
    'tooling',
    'data_integrity',
    'performance',
    'outcome_quality',
  ] as const;

  const REQUIRED_CODES = [
    'INPUT_INVALID',
    'INPUT_INCOMPLETE',
    'INPUT_AMBIGUOUS',
    'INPUT_UNSUPPORTED',
    'INTENT_OVERBOUND',
    'INTENT_CONFLICT',
    'SCOPE_UNBOUND',
    'SCOPE_EXPANSION_UNSAFE',
    'EVIDENCE_ABSENT',
    'EVIDENCE_CONFLICT',
    'EVIDENCE_STALE_RELEVANT',
    'EVIDENCE_GRAPH_INCOMPLETE',
    'EVIDENCE_MAPPING_WEAK',
    'POLICY_CONFIDENCE_BLOCK',
    'POLICY_EVIDENCE_BLOCK',
    'POLICY_PATH_BLOCK',
    'POLICY_OVERRIDE_REQUIRED',
    'ORCH_STAGE_TIMEOUT',
    'ORCH_INVALID_OUTPUT',
    'ORCH_INVALID_TRANSITION',
    'ORCH_DEPENDENCY_MISSING',
    'TOOL_PARSER_FAIL',
    'TOOL_LSP_UNAVAILABLE',
    'TOOL_DB_UNAVAILABLE',
    'TOOL_FS_ERROR',
    'TOOL_HOOK_FAIL',
    'DATA_TRACE_LEDGER_MISMATCH',
    'DATA_STAGE_GAP',
    'DATA_CONFIDENCE_INCONSISTENT',
    'DATA_SNAPSHOT_INCOMPLETE',
    'PERF_STAGE_SLOW',
    'PERF_RETRY_EXCESS',
    'PERF_EVENT_LAG',
    'PERF_REPORT_SLOW',
    'PERF_PARSE_HEAVY',
    'QUALITY_LOW_CONFIDENCE_SUCCESS',
    'QUALITY_CRITICAL_WARNING_SUCCESS',
    'QUALITY_OVERRIDE_DEPENDENT',
    'QUALITY_PARTIAL_SUCCESS',
    'UNCLASSIFIED_FAILURE',
  ] as const;

  it('1.1 FAILURE_TAXONOMY contains all required failure classes', () => {
    const presentClasses = new Set(
      Object.values(FAILURE_TAXONOMY).map(e => e.class),
    );
    for (const cls of REQUIRED_CLASSES) {
      expect(presentClasses.has(cls), `Missing class: ${cls}`).toBe(true);
    }
  });

  it('1.2 All required failure codes exist in FAILURE_TAXONOMY', () => {
    for (const code of REQUIRED_CODES) {
      expect(FAILURE_TAXONOMY[code], `Missing code: ${code}`).toBeDefined();
    }
  });

  it('1.3 Each taxonomy entry has all required fields', () => {
    for (const [code, entry] of Object.entries(FAILURE_TAXONOMY)) {
      expect(entry.code, `${code}: missing code`).toBe(code);
      expect(entry.label, `${code}: missing label`).toBeTruthy();
      expect(entry.class, `${code}: missing class`).toBeTruthy();
      expect(entry.default_severity, `${code}: missing default_severity`).toBeTruthy();
      expect(typeof entry.default_blocking, `${code}: missing default_blocking`).toBe('boolean');
      expect(entry.recoverability, `${code}: missing recoverability`).toBeTruthy();
      expect(entry.determinism, `${code}: missing determinism`).toBeTruthy();
    }
  });

  it('1.4 lookupFailureCode returns the correct entry for a known code', () => {
    const entry = lookupFailureCode('EVIDENCE_ABSENT');
    expect(entry.code).toBe('EVIDENCE_ABSENT');
    expect(entry.class).toBe('evidence');
  });

  it('1.5 lookupFailureCode returns UNCLASSIFIED_FAILURE entry for unknown code', () => {
    const entry = lookupFailureCode('TOTALLY_UNKNOWN_CODE_XYZ');
    expect(entry.code).toBe('UNCLASSIFIED_FAILURE');
  });
});

// ─── 2. Causality ─────────────────────────────────────────────────────────────

describe('2. Causality', () => {
  it('2.1 buildCausalGraph returns a graph from a list of ReportEvent objects', () => {
    const events = [
      makeReportEvent({ event_id: 'ev_A', kind: 'decision', stage: 'knowledge' }),
      makeReportEvent({ event_id: 'ev_B', kind: 'decision', stage: 'eco' }),
    ];
    const graph = buildCausalGraph(events);
    expect(graph).toBeDefined();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
  });

  it('2.2 Edge exists from A to B when B.causes contains A event_id', () => {
    const evA = makeReportEvent({ event_id: 'ev_A', kind: 'decision', stage: 'knowledge' });
    const evB = makeReportEvent({ event_id: 'ev_B', kind: 'decision', stage: 'eco', causes: ['ev_A'] });
    const graph = buildCausalGraph([evA, evB]);
    const edge = graph.edges.find(e => e.from_node_id === 'ev_A' && e.to_node_id === 'ev_B');
    expect(edge).toBeDefined();
  });

  it('2.3 Chain A → B → C is identified with length 3', () => {
    const evA = makeReportEvent({ event_id: 'ev_A', kind: 'decision', stage: 'knowledge', causes: [] });
    const evB = makeReportEvent({ event_id: 'ev_B', kind: 'decision', stage: 'eco', causes: ['ev_A'] });
    const evC = makeReportEvent({ event_id: 'ev_C', kind: 'outcome', stage: 'outcome', causes: ['ev_B'] });
    const graph = buildCausalGraph([evA, evB, evC]);
    const allChains = [...graph.primary_chains, ...graph.secondary_chains];
    const chain = allChains.find(c => c.node_ids.includes('ev_A') && c.node_ids.includes('ev_C'));
    expect(chain).toBeDefined();
    expect(chain!.node_ids).toHaveLength(3);
  });

  it('2.4 findPrimaryChains returns chains ending at outcome/failure nodes', () => {
    const evA = makeReportEvent({ event_id: 'ev_A', kind: 'decision', stage: 'knowledge', causes: [] });
    const evB = makeReportEvent({ event_id: 'ev_B', kind: 'outcome', stage: 'outcome', causes: ['ev_A'] });
    const graph = buildCausalGraph([evA, evB]);
    const chains = findPrimaryChains(graph);
    expect(Array.isArray(chains)).toBe(true);
    for (const chain of chains) {
      const terminal = graph.nodes.find(n => n.node_id === chain.terminal_node_id);
      expect(terminal).toBeDefined();
      expect(['outcome', 'failure']).toContain(terminal!.kind);
    }
  });

  it('2.5 Empty events array returns empty graph', () => {
    const graph = buildCausalGraph([]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.primary_chains).toHaveLength(0);
    expect(graph.secondary_chains).toHaveLength(0);
  });
});

// ─── 3. Validators ────────────────────────────────────────────────────────────

describe('3. Validators', () => {
  it('3.1 validateBundle returns { valid: true, issues: [] } for a complete valid bundle', () => {
    const bundle = makeMinimalBundle();
    const result = validateBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('3.2 Missing outcome in stages returns issue of kind missing_outcome', () => {
    const bundle = makeMinimalBundle({
      raw_events: [], // no outcome event
    });
    const result = validateBundle(bundle);
    const issue = result.issues.find(i => i.kind === 'missing_outcome');
    expect(issue).toBeDefined();
  });

  it('3.3 Broken causal reference returns issue of kind broken_causal_ref', () => {
    const evA = makeReportEvent({
      event_id: 'ev_A',
      kind: 'decision',
      stage: 'knowledge',
      causes: ['ev_NONEXISTENT'],
    });
    const bundle = makeMinimalBundle({
      raw_events: [evA, makeReportEvent({ kind: 'outcome', stage: 'outcome' })],
    });
    const result = validateBundle(bundle);
    const issue = result.issues.find(i => i.kind === 'broken_causal_ref');
    expect(issue).toBeDefined();
  });

  it('3.4 Bundle with no stages returns issues for the 5 expected stages', () => {
    const bundle = makeMinimalBundle({ stages: [] });
    const result = validateBundle(bundle);
    const missingStageIssues = result.issues.filter(i => i.kind === 'missing_stage');
    expect(missingStageIssues.length).toBeGreaterThanOrEqual(5);
  });

  it('3.5 Duplicate failure codes do not cause issues', () => {
    const failure1 = makeFailureRecord('EVIDENCE_ABSENT');
    const failure2 = makeFailureRecord('EVIDENCE_ABSENT');
    const bundle = makeMinimalBundle({
      failures: [failure1, failure2],
      stages: [
        makeStageRecord('knowledge', 'ok'),
        makeStageRecord('eco', 'ok'),
        makeStageRecord('classification', 'ok'),
        makeStageRecord('strategy', 'ok'),
        makeStageRecord('implementation', 'ok'),
      ],
    });
    const result = validateBundle(bundle);
    // Duplicate codes are allowed — no issue type for that
    const duplicateIssues = result.issues.filter(
      i => i.message?.toLowerCase().includes('duplicate'),
    );
    expect(duplicateIssues).toHaveLength(0);
  });

  it('3.6 Confidence checkpoints out of order get flagged', () => {
    const now = Date.now();
    const bundle = makeMinimalBundle({
      confidence: {
        overall_confidence: 75,
        effective_confidence: 75,
        band: 'medium',
        dimensions: {},
        penalties: [],
        checkpoints: [
          {
            trigger: 'eco_complete',
            snapshot_index: 0,
            computed_confidence: 75,
            effective_confidence: 75,
            band: 'medium',
            stage_name: 'eco',
          },
          {
            trigger: 'knowledge_complete',
            snapshot_index: 1,
            computed_confidence: 80,
            effective_confidence: 80,
            band: 'high',
            stage_name: 'knowledge',
            // knowledge should come before eco — out of order
          },
        ],
      },
      // Provide some ordering signal via timestamps in raw_events
      raw_events: [
        makeReportEvent({
          event_id: 'ev_snap_1',
          kind: 'confidence_snapshot',
          stage: 'eco',
          timestamp: new Date(now + 1000).toISOString(),
          causes: [],
        }),
        makeReportEvent({
          event_id: 'ev_snap_0',
          kind: 'confidence_snapshot',
          stage: 'knowledge',
          timestamp: new Date(now).toISOString(),
          causes: [],
        }),
        makeReportEvent({ kind: 'outcome', stage: 'outcome' }),
      ],
    });
    const result = validateBundle(bundle);
    const outOfOrderIssue = result.issues.find(
      i => i.kind === 'confidence_inconsistent' || i.kind === 'timestamp_out_of_order',
    );
    expect(outOfOrderIssue).toBeDefined();
  });
});

// ─── 4. Assembler ─────────────────────────────────────────────────────────────

describe('4. Assembler', () => {
  const TRACE_ID = 'tr_assembler_test';
  const REQUEST_ID = 'req_assembler_test';

  function makeDecisionEntry(stage: LedgerEntry['stage'] = 'knowledge'): LedgerEntry {
    return makeLedgerEntry({
      trace_id: TRACE_ID,
      request_id: REQUEST_ID,
      stage,
      record_type: 'decision',
      payload: {
        kind: 'decision',
        decision_name: `${stage}_decision`,
        decision_code: `${stage.toUpperCase()}_DEC`,
        input_refs: {},
        result: { status: 'pass' },
        rationale: { summary: `${stage} passed`, rule_refs: [] },
      } as LedgerEntry['payload'],
    });
  }

  function makeOutcomeEntry(): LedgerEntry {
    return makeLedgerEntry({
      trace_id: TRACE_ID,
      request_id: REQUEST_ID,
      stage: 'outcome',
      record_type: 'outcome',
      payload: {
        kind: 'outcome',
        completion_state: 'merged',
        final_disposition_reason: 'pipeline completed successfully',
        final_lane: 'A',
      } as LedgerEntry['payload'],
    });
  }

  function makeConfidenceEntry(): LedgerEntry {
    return makeLedgerEntry({
      trace_id: TRACE_ID,
      request_id: REQUEST_ID,
      stage: 'confidence',
      record_type: 'confidence_snapshot',
      payload: {
        kind: 'confidence_snapshot',
        trigger: 'eco_complete',
        snapshot_index: 0,
        computed_confidence: 78,
        effective_confidence: 78,
        band: 'medium',
        stage_name: 'eco',
        dimensions: {},
        penalties: [],
      } as unknown as LedgerEntry['payload'],
    });
  }

  function makeRefusalEntry(): LedgerEntry {
    return makeLedgerEntry({
      trace_id: TRACE_ID,
      request_id: REQUEST_ID,
      stage: 'eco',
      record_type: 'refusal',
      payload: {
        kind: 'refusal',
        refusal_code: 'POLICY_EVIDENCE_BLOCK',
        refusal_reason: 'Insufficient evidence to proceed',
        blocking_dimension: 'coverage',
      } as LedgerEntry['payload'],
    });
  }

  it('4.1 assembleReport returns a RunEvidenceBundle', () => {
    const entries = [makeDecisionEntry(), makeOutcomeEntry()];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle).toBeDefined();
    expect(bundle.bundle_id).toBeTruthy();
    expect(bundle.schema_version).toBe('1.0.0');
  });

  it('4.2 Bundle run_id matches trace_id from entries', () => {
    const entries = [makeDecisionEntry(), makeOutcomeEntry()];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.run_id).toBe(TRACE_ID);
  });

  it('4.3 Bundle.stages contains at least one stage for each decision record', () => {
    const entries = [
      makeDecisionEntry('knowledge'),
      makeDecisionEntry('eco'),
      makeOutcomeEntry(),
    ];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    const stageIds = bundle.stages.map(s => s.stage_id);
    expect(stageIds).toContain('knowledge');
    expect(stageIds).toContain('eco');
  });

  it('4.4 Bundle.confidence.overall_confidence matches latest confidence snapshot value', () => {
    const entries = [
      makeDecisionEntry(),
      makeConfidenceEntry(),
      makeOutcomeEntry(),
    ];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.confidence.overall_confidence).toBe(78);
  });

  it('4.5 Bundle.failures contains an entry when a refusal record exists', () => {
    const entries = [makeDecisionEntry(), makeRefusalEntry()];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.failures.length).toBeGreaterThan(0);
  });

  it('4.6 Bundle.integrity.valid is false when entries are missing terminal outcome', () => {
    const entries = [makeDecisionEntry('knowledge')];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.integrity.valid).toBe(false);
  });

  it('4.7 assembleReport([]) returns bundle with DATA_SNAPSHOT_INCOMPLETE integrity issue', () => {
    const bundle = assembleReport([], { requestId: REQUEST_ID });
    const issue = bundle.integrity.issues.find(
      i => i.kind === 'data_snapshot_incomplete',
    );
    expect(issue).toBeDefined();
    expect(bundle.integrity.valid).toBe(false);
  });

  it('4.8 Bundle.raw_events contains all entries as ReportEvents', () => {
    const entries = [makeDecisionEntry(), makeOutcomeEntry()];
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.raw_events).toHaveLength(entries.length);
    const eventIds = bundle.raw_events.map(e => e.event_id);
    for (const entry of entries) {
      expect(eventIds).toContain(entry.ledger_id);
    }
  });
});

// ─── 5. Optimisation Rules ────────────────────────────────────────────────────

describe('5. Optimisation Rules', () => {
  it('5.1 generateOptimisationHints returns an array of OptimisationHint', () => {
    const bundle = makeMinimalBundle();
    const hints = generateOptimisationHints(bundle);
    expect(Array.isArray(hints)).toBe(true);
  });

  it('5.2 EVIDENCE_ABSENT failures produce evidence retrieval suggestion', () => {
    const failure = makeFailureRecord('EVIDENCE_ABSENT');
    const bundle = makeMinimalBundle({ failures: [failure] });
    const hints = generateOptimisationHints(bundle);
    const evidenceHint = hints.find(
      h => h.rule_id.includes('evidence') || h.observation.toLowerCase().includes('evidence'),
    );
    expect(evidenceHint).toBeDefined();
  });

  it('5.3 POLICY_CONFIDENCE_BLOCK failures produce confidence improvement suggestion', () => {
    const failure = makeFailureRecord('POLICY_CONFIDENCE_BLOCK');
    const bundle = makeMinimalBundle({ failures: [failure] });
    const hints = generateOptimisationHints(bundle);
    const confidenceHint = hints.find(
      h => h.rule_id.includes('confidence') || h.observation.toLowerCase().includes('confidence'),
    );
    expect(confidenceHint).toBeDefined();
  });

  it('5.4 Override records in raw_events produce governance smell hint', () => {
    const overrideEvent = makeReportEvent({
      kind: 'override',
      stage: 'override',
      payload: { kind: 'override', reason: 'manual override' },
    });
    const bundle = makeMinimalBundle({
      raw_events: [
        overrideEvent,
        makeReportEvent({ kind: 'outcome', stage: 'outcome' }),
      ],
    });
    const hints = generateOptimisationHints(bundle);
    const governanceHint = hints.find(
      h => h.rule_id.includes('governance') || h.observation.toLowerCase().includes('override'),
    );
    expect(governanceHint).toBeDefined();
  });

  it('5.5 No failures returns empty or minimal hints', () => {
    const bundle = makeMinimalBundle({ failures: [] });
    const hints = generateOptimisationHints(bundle);
    // Governance smell hints should not appear without overrides
    const overrideHints = hints.filter(
      h => h.observation.toLowerCase().includes('override'),
    );
    expect(overrideHints).toHaveLength(0);
  });

  it('5.6 Each hint has all required fields', () => {
    const failure = makeFailureRecord('EVIDENCE_ABSENT');
    const bundle = makeMinimalBundle({ failures: [failure] });
    const hints = generateOptimisationHints(bundle);
    for (const hint of hints) {
      expect(hint.hint_id).toBeTruthy();
      expect(hint.rule_id).toBeTruthy();
      expect(hint.observation).toBeTruthy();
      expect(hint.evidence_basis).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(hint.hint_confidence);
      expect(hint.subsystem).toBeTruthy();
      expect(Array.isArray(hint.supporting_event_ids)).toBe(true);
    }
  });
});

// ─── 6. HTML Renderer ─────────────────────────────────────────────────────────

describe('6. HTML Renderer', () => {
  it('6.1 renderHtml returns a string', () => {
    const bundle = makeMinimalBundle();
    const html = renderHtml(bundle);
    expect(typeof html).toBe('string');
  });

  it('6.2 Returned string contains <!DOCTYPE html>', () => {
    const html = renderHtml(makeMinimalBundle());
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('6.3 Returned string contains the run_id', () => {
    const bundle = makeMinimalBundle();
    const html = renderHtml(bundle);
    expect(html).toContain(bundle.run_id);
  });

  it('6.4 Returned string contains a section for Stage Timeline', () => {
    const html = renderHtml(makeMinimalBundle());
    expect(html.toLowerCase()).toContain('stage timeline');
  });

  it('6.5 Returned string contains Failure Matrix section when failures exist', () => {
    const bundle = makeMinimalBundle({
      failures: [makeFailureRecord('EVIDENCE_ABSENT')],
    });
    const html = renderHtml(bundle);
    expect(html.toLowerCase()).toContain('failure matrix');
  });

  it('6.6 Returned string contains a section for Causal Chains', () => {
    const html = renderHtml(makeMinimalBundle());
    expect(html.toLowerCase()).toContain('causal chain');
  });

  it('6.7 Returned string contains a section for Confidence & Evidence', () => {
    const html = renderHtml(makeMinimalBundle());
    expect(html.toLowerCase()).toMatch(/confidence.*evidence|evidence.*confidence/);
  });

  it('6.8 Returned string contains a section for Optimisation Hints', () => {
    const html = renderHtml(makeMinimalBundle());
    expect(html.toLowerCase()).toContain('optimis');
  });

  it('6.9 Returned string contains a section for Report Integrity', () => {
    const html = renderHtml(makeMinimalBundle());
    expect(html.toLowerCase()).toContain('integrity');
  });

  it('6.10 Returned string contains the embedded JSON bundle as a script tag', () => {
    const bundle = makeMinimalBundle();
    const html = renderHtml(bundle);
    expect(html).toContain('<script');
    // The bundle JSON should be embedded
    expect(html).toContain(bundle.bundle_id);
  });

  it('6.11 When bundle.integrity.valid is false, HTML shows integrity warning prominently', () => {
    const bundle = makeMinimalBundle({
      integrity: {
        valid: false,
        issues: [
          {
            kind: 'missing_outcome',
            severity: 'error',
            message: 'No terminal outcome found',
          },
        ],
        missing_stages: [],
        broken_causal_refs: [],
        unclassified_failure_codes: [],
      },
      summary: {
        run_id: 'tr_bundle_test',
        request_id: 'req_bundle_test',
        final_status: 'incomplete',
        report_integrity_status: 'failed',
      },
    });
    const html = renderHtml(bundle);
    // Should contain a prominent warning indicator
    expect(html.toLowerCase()).toMatch(/warning|invalid|integrity.*fail|fail.*integrity/);
  });

  it('6.12 When bundle.comparison exists, HTML shows a comparison section', () => {
    const bundle = makeMinimalBundle({
      comparison: {
        baseline_run_id: 'tr_baseline',
        current_run_id: 'tr_bundle_test',
        generated_at: new Date().toISOString(),
        deltas: {
          confidence: {
            baseline: 70,
            current: 75,
            direction: 'improved',
          },
        },
        regression_findings: [],
      },
    });
    const html = renderHtml(bundle);
    expect(html.toLowerCase()).toContain('comparison');
  });
});

// ─── 7. Integration ───────────────────────────────────────────────────────────

describe('7. Integration', () => {
  const TRACE_ID = 'tr_integration';
  const REQUEST_ID = 'req_integration';

  function makeFullEntries(): LedgerEntry[] {
    const ts = (offset: number) => new Date(Date.now() + offset).toISOString();
    const makeEntry = (
      stage: LedgerEntry['stage'],
      record_type: LedgerEntry['record_type'],
      payload: LedgerEntry['payload'],
    ): LedgerEntry => ({
      schema_version: '1.0.0',
      ledger_id: randomUUID(),
      trace_id: TRACE_ID,
      request_id: REQUEST_ID,
      timestamp: ts(0),
      stage,
      record_type,
      actor: 'system',
      payload,
    });

    return [
      makeEntry('knowledge', 'decision', {
        kind: 'decision',
        decision_name: 'knowledge_assessment',
        decision_code: 'KNOW_PASS',
        input_refs: {},
        result: { status: 'pass' },
        rationale: { summary: 'knowledge ok', rule_refs: [] },
      } as LedgerEntry['payload']),
      makeEntry('eco', 'decision', {
        kind: 'decision',
        decision_name: 'eco_assessment',
        decision_code: 'ECO_PASS',
        input_refs: {},
        result: { status: 'pass' },
        rationale: { summary: 'eco ok', rule_refs: [] },
      } as LedgerEntry['payload']),
      makeEntry('confidence', 'confidence_snapshot', {
        kind: 'confidence_snapshot',
        trigger: 'eco_complete',
        snapshot_index: 0,
        computed_confidence: 80,
        effective_confidence: 80,
        band: 'high',
        stage_name: 'eco',
        dimensions: {},
        penalties: [],
      } as unknown as LedgerEntry['payload']),
      makeEntry('outcome', 'outcome', {
        kind: 'outcome',
        completion_state: 'merged',
        final_disposition_reason: 'pipeline succeeded',
        final_lane: 'A',
      } as LedgerEntry['payload']),
    ];
  }

  it('7.1 Full pipeline LedgerEntry[] → assembleReport → renderHtml produces valid HTML', () => {
    const entries = makeFullEntries();
    const bundle = assembleReport(entries, { requestId: REQUEST_ID });
    expect(bundle.run_id).toBe(TRACE_ID);

    const html = renderHtml(bundle);
    expect(typeof html).toBe('string');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(TRACE_ID);
  });

  it('7.2 compareRuns(bundleA, bundleB) returns a RunComparison', () => {
    const bundleA = makeMinimalBundle({ run_id: 'tr_run_A' });
    const bundleB = makeMinimalBundle({ run_id: 'tr_run_B' });
    const comparison = compareRuns(bundleA, bundleB);
    expect(comparison).toBeDefined();
    expect(comparison.baseline_run_id).toBe('tr_run_A');
    expect(comparison.current_run_id).toBe('tr_run_B');
    expect(comparison.generated_at).toBeTruthy();
    expect(comparison.deltas).toBeDefined();
    expect(Array.isArray(comparison.regression_findings)).toBe(true);
  });

  it('7.3 compareRuns detects lane change between two runs', () => {
    const bundleA = makeMinimalBundle({
      run_id: 'tr_run_A',
      summary: {
        run_id: 'tr_run_A',
        request_id: 'req_test',
        final_status: 'success',
        report_integrity_status: 'valid',
        lane: 'A',
      },
    });
    const bundleB = makeMinimalBundle({
      run_id: 'tr_run_B',
      summary: {
        run_id: 'tr_run_B',
        request_id: 'req_test',
        final_status: 'success',
        report_integrity_status: 'valid',
        lane: 'C',
      },
    });
    const comparison = compareRuns(bundleA, bundleB);
    expect(comparison.deltas.lane).toBeDefined();
    expect(comparison.deltas.lane!.baseline).toBe('A');
    expect(comparison.deltas.lane!.current).toBe('C');
    expect(comparison.deltas.lane!.direction).toBe('changed');
  });

  it('7.4 compareRuns detects confidence delta', () => {
    const bundleA = makeMinimalBundle({
      run_id: 'tr_run_A',
      confidence: {
        overall_confidence: 60,
        effective_confidence: 60,
        band: 'medium',
        dimensions: {},
        penalties: [],
        checkpoints: [],
      },
    });
    const bundleB = makeMinimalBundle({
      run_id: 'tr_run_B',
      confidence: {
        overall_confidence: 80,
        effective_confidence: 80,
        band: 'high',
        dimensions: {},
        penalties: [],
        checkpoints: [],
      },
    });
    const comparison = compareRuns(bundleA, bundleB);
    expect(comparison.deltas.confidence).toBeDefined();
    expect(comparison.deltas.confidence!.baseline).toBe(60);
    expect(comparison.deltas.confidence!.current).toBe(80);
    expect(comparison.deltas.confidence!.direction).toBe('improved');
  });
});
