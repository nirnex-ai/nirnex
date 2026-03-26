/**
 * Sprint 13 — Evidence Sufficiency Gate
 *
 * TDD test suite. Tests are written to define the contract; implementation
 * must satisfy every assertion without exception.
 *
 * Covers:
 *   - Types and policy registry
 *   - Fact extraction from EcoBuildOutput
 *   - Unit: pass / clarify / refuse for each intent class
 *   - Regression: stub unconditional-pass cannot reappear
 *   - Integration: pipeline hard-stops before TEE on clarify and refuse
 *   - Ledger: entries written for all verdicts (pass, clarify, refuse)
 *   - fromEvidenceGateDecision mapper
 *   - Reclassification affects gate outcome
 */

import { describe, it, expect } from 'vitest';

// ─── Imports under test ───────────────────────────────────────────────────────

import {
  evaluateEvidenceGate,
  extractEvidenceFacts,
  getEvidencePolicy,
  EVIDENCE_RULES_BY_INTENT,
  evidenceGateHandler,
  type EvidenceGateVerdict,
  type EvidenceGateReasonCode,
  type EvidenceGateFacts,
  type EvidenceGateDecision,
  type IntentEvidencePolicy,
  type RuleResult,
} from '../packages/core/src/runtime/evidence/index.js';

import {
  fromEvidenceGateDecision,
} from '../packages/core/src/runtime/ledger/mappers.js';

import { runOrchestrator } from '../packages/core/src/pipeline/orchestrator.js';
import type { SufficiencyGateInput, SufficiencyGateOutput } from '../packages/core/src/pipeline/types.js';
import type { LedgerEntry } from '../packages/core/src/runtime/ledger/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid SufficiencyGateInput (EcoBuildOutput) for tests.
 * All dimensions default to 'pass'; override individual fields as needed.
 */
function makeEco(overrides: Partial<{
  intentPrimary: string;
  intentComposite: boolean;
  intentConfidence: string;
  coverageSeverity: string;
  freshnessSeverity: string;
  mappingSeverity: string;
  conflictSeverity: string;
  graphSeverity: string;
  conflicts: unknown[];
  mapping: { pattern: string; roots_ranked: unknown[] };
  modules_touched: string[];
  forced_unknown: boolean;
  blocked: boolean;
  confidence_score: number;
  reclassification: unknown;
  recommended_lane: string;
}> = {}): SufficiencyGateInput {
  return {
    intent: {
      primary:   overrides.intentPrimary   ?? 'bug_fix',
      composite: overrides.intentComposite ?? false,
      confidence: overrides.intentConfidence,
    },
    eco_dimensions: {
      coverage:  { severity: overrides.coverageSeverity  ?? 'pass' },
      freshness: { severity: overrides.freshnessSeverity ?? 'pass' },
      mapping:   { severity: overrides.mappingSeverity   ?? 'pass' },
      conflict:  { severity: overrides.conflictSeverity  ?? 'pass' },
      graph:     { severity: overrides.graphSeverity     ?? 'pass' },
    },
    confidence_score: overrides.confidence_score ?? 80,
    conflicts:        overrides.conflicts        ?? [],
    modules_touched:  overrides.modules_touched  ?? ['src/foo.ts'],
    mapping: overrides.mapping ?? { pattern: '1:1', roots_ranked: [{ rank: '1' }] },
    forced_unknown:   overrides.forced_unknown   ?? false,
    blocked:          overrides.blocked          ?? false,
    recommended_lane: overrides.recommended_lane ?? 'A',
    reclassification: overrides.reclassification ?? undefined,
  } as unknown as SufficiencyGateInput;
}

// ─── 1. Types — Shape Contract ─────────────────────────────────────────────────

describe('Sprint 13 — Evidence Gate Types', () => {
  it('EvidenceGateVerdict has exactly three values', () => {
    const verdicts: EvidenceGateVerdict[] = ['pass', 'clarify', 'refuse'];
    expect(verdicts).toHaveLength(3);
  });

  it('EvidenceGateReasonCode covers all required codes from spec', () => {
    const required: EvidenceGateReasonCode[] = [
      'INSUFFICIENT_SCOPE_BINDING',
      'INSUFFICIENT_CODE_EVIDENCE',
      'INSUFFICIENT_SPEC_EVIDENCE',
      'INSUFFICIENT_AC_BINDING',
      'HIGH_CONFLICT_UNRESOLVED',
      'LOW_MAPPING_CONFIDENCE',
      'LOW_COVERAGE',
      'GRAPH_INCOMPLETE',
      'FORCED_UNKNOWN_HIGH_RISK',
      'MISSING_TARGET_FILES',
      'MISSING_EXECUTION_PATH',
      'AMBIGUOUS_INTENT',
      'RECLASSIFICATION_REQUIRED',
    ];
    // All should compile and be usable as reason codes
    expect(required).toHaveLength(13);
  });

  it('EVIDENCE_RULES_BY_INTENT is a non-empty record', () => {
    expect(typeof EVIDENCE_RULES_BY_INTENT).toBe('object');
    expect(Object.keys(EVIDENCE_RULES_BY_INTENT).length).toBeGreaterThan(0);
  });

  it('all registered policies have rules arrays', () => {
    for (const [key, policy] of Object.entries(EVIDENCE_RULES_BY_INTENT)) {
      expect(Array.isArray(policy.rules), `${key}.rules must be an array`).toBe(true);
      expect(policy.rules.length, `${key}.rules must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('getEvidencePolicy returns unknown policy for unregistered intent', () => {
    const p = getEvidencePolicy('completely_unknown_intent_xyz');
    expect(p.intentClass).toBe('unknown');
  });

  it('all policies cover the 5 required intent classes', () => {
    const required = ['bug_fix', 'new_feature', 'refactor', 'dep_update', 'config_infra'];
    for (const cls of required) {
      expect(EVIDENCE_RULES_BY_INTENT[cls], `missing policy for ${cls}`).toBeDefined();
    }
  });
});

// ─── 2. Fact Extraction ───────────────────────────────────────────────────────

describe('Sprint 13 — extractEvidenceFacts', () => {
  it('extracts intent fields correctly', () => {
    const eco = makeEco({
      intentPrimary: 'refactor',
      intentComposite: true,
      intentConfidence: 'low',
    });
    const facts = extractEvidenceFacts(eco);
    expect(facts.intentPrimary).toBe('refactor');
    expect(facts.intentComposite).toBe(true);
    expect(facts.intentConfidence).toBe('low');
  });

  it('extracts dimension severities correctly', () => {
    const eco = makeEco({
      coverageSeverity:  'escalate',
      freshnessSeverity: 'warn',
      mappingSeverity:   'block',
      conflictSeverity:  'pass',
      graphSeverity:     'escalate',
    });
    const facts = extractEvidenceFacts(eco);
    expect(facts.coverageSeverity).toBe('escalate');
    expect(facts.freshnessSeverity).toBe('warn');
    expect(facts.mappingSeverity).toBe('block');
    expect(facts.conflictSeverity).toBe('pass');
    expect(facts.graphSeverity).toBe('escalate');
  });

  it('detects blocking conflicts from conflicts array', () => {
    const eco = makeEco({
      conflictSeverity: 'escalate',
      conflicts: [
        { id: 'c1', severity: 'block', resolution_hint: 'must_block', type: 'circular_dependency' },
      ],
    });
    const facts = extractEvidenceFacts(eco);
    expect(facts.hasBlockingConflict).toBe(true);
  });

  it('counts unresolved high conflicts correctly', () => {
    const eco = makeEco({
      conflicts: [
        { severity: 'high', resolution_hint: 'needs_clarification', type: 'hub_collision' },
        { severity: 'high', resolution_hint: 'can_proceed_with_warning', type: 'ownership_overlap' },
        { severity: 'low',  resolution_hint: 'needs_clarification', type: 'ownership_overlap' },
      ],
    });
    const facts = extractEvidenceFacts(eco);
    // Only the first: severity=high AND not can_proceed_with_warning
    expect(facts.unresolvedHighConflicts).toBe(1);
  });

  it('collects unique conflict dominant types', () => {
    const eco = makeEco({
      conflicts: [
        { type: 'ownership_overlap', severity: 'medium' },
        { type: 'ownership_overlap', severity: 'high' },
        { type: 'circular_dependency', severity: 'low' },
      ],
    });
    const facts = extractEvidenceFacts(eco);
    expect(facts.conflictDominantTypes).toContain('ownership_overlap');
    expect(facts.conflictDominantTypes).toContain('circular_dependency');
    // Deduplication: ownership_overlap appears once
    expect(facts.conflictDominantTypes.filter(t => t === 'ownership_overlap')).toHaveLength(1);
  });

  it('extracts mapping pattern and modules touched', () => {
    const eco = makeEco({
      mapping: { pattern: 'ambiguous', roots_ranked: [] },
      modules_touched: ['src/a.ts', 'src/b.ts'],
    });
    const facts = extractEvidenceFacts(eco);
    expect(facts.mappingPattern).toBe('ambiguous');
    expect(facts.modulesTouchedCount).toBe(2);
    expect(facts.hasTargetFiles).toBe(true);
  });

  it('hasTargetFiles is false when neither modules_touched nor roots_ranked are populated', () => {
    const eco = makeEco({
      mapping: { pattern: 'unknown', roots_ranked: [] },
      modules_touched: [],
    });
    const facts = extractEvidenceFacts(eco);
    expect(facts.hasTargetFiles).toBe(false);
  });

  it('extracts forced_unknown correctly', () => {
    const eco = makeEco({ forced_unknown: true });
    const facts = extractEvidenceFacts(eco);
    expect(facts.forcedUnknown).toBe(true);
  });

  it('defaults to safe values when fields are absent', () => {
    // Minimal input — only the required pipeline fields
    const bare = {
      intent: { primary: 'bug_fix', composite: false },
      eco_dimensions: {
        coverage:  { severity: 'pass' },
        freshness: { severity: 'pass' },
        mapping:   { severity: 'pass' },
        conflict:  { severity: 'pass' },
        graph:     { severity: 'pass' },
      },
      confidence_score: 0,
    } as unknown as SufficiencyGateInput;

    const facts = extractEvidenceFacts(bare);
    expect(facts.forcedUnknown).toBe(false);
    expect(facts.modulesTouchedCount).toBe(0);
    expect(facts.conflictDominantTypes).toEqual([]);
    expect(facts.hasBlockingConflict).toBe(false);
  });
});

// ─── 3. Unit — Pass Cases ────────────────────────────────────────────────────

describe('Sprint 13 — Unit: Pass Cases', () => {
  it('passes a well-evidenced bug fix with bounded scope and mapping', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      coverageSeverity: 'pass',
      mappingSeverity:  'pass',
      graphSeverity:    'pass',
      conflictSeverity: 'pass',
      modules_touched:  ['src/buggy.ts'],
      mapping: { pattern: '1:1', roots_ranked: [{ rank: '1' }] },
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('pass');
    expect(d.reasonCodes).toHaveLength(0);
    expect(d.clarificationQuestions).toHaveLength(0);
    expect(d.refusalDetail).toBeNull();
  });

  it('passes a well-evidenced feature with bounded scope and graph', () => {
    const eco = makeEco({
      intentPrimary:    'new_feature',
      coverageSeverity: 'warn',    // warn is acceptable
      graphSeverity:    'warn',
      conflictSeverity: 'pass',
      modules_touched:  ['src/new-feature.ts'],
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('pass');
  });

  it('passes a refactor with graph coverage and no ownership conflict', () => {
    const eco = makeEco({
      intentPrimary:    'refactor',
      coverageSeverity: 'pass',
      graphSeverity:    'pass',
      conflictSeverity: 'pass',
      modules_touched:  ['src/module-a.ts'],
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('pass');
  });

  it('passes despite low (escalate) freshness — freshness is non-blocking for bug_fix', () => {
    const eco = makeEco({
      intentPrimary:     'bug_fix',
      freshnessSeverity: 'escalate',  // escalated but should not block
      coverageSeverity:  'pass',
      mappingSeverity:   'pass',
      modules_touched:   ['src/foo.ts'],
    });
    const d = evaluateEvidenceGate(eco);
    // escalate freshness is NOT a gate condition — should still pass
    expect(d.verdict).toBe('pass');
  });

  it('passes despite warn freshness — freshness=warn never triggers gate', () => {
    const eco = makeEco({
      intentPrimary:     'refactor',
      freshnessSeverity: 'warn',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('pass');
  });

  it('perRuleResults is populated on pass — all rules ran', () => {
    const eco = makeEco({ intentPrimary: 'bug_fix' });
    const d = evaluateEvidenceGate(eco);
    expect(d.perRuleResults.length).toBeGreaterThan(0);
    expect(d.perRuleResults.every(r => r.passed)).toBe(true);
  });

  it('provenance captures all 5 dimension severities on pass', () => {
    const eco = makeEco({ intentPrimary: 'new_feature' });
    const d = evaluateEvidenceGate(eco);
    const dims = d.provenance.dimensionsRead;
    expect(dims.coverage).toBeDefined();
    expect(dims.freshness).toBeDefined();
    expect(dims.mapping).toBeDefined();
    expect(dims.conflict).toBeDefined();
    expect(dims.graph).toBeDefined();
  });
});

// ─── 4. Unit — Clarify Cases ─────────────────────────────────────────────────

describe('Sprint 13 — Unit: Clarify Cases', () => {
  it('clarifies a composite feature with low confidence', () => {
    const eco = makeEco({
      intentPrimary:     'new_feature',
      intentComposite:   true,
      intentConfidence:  'low',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
    expect(d.reasonCodes).toContain('AMBIGUOUS_INTENT');
    expect(d.clarificationQuestions.length).toBeGreaterThan(0);
  });

  it('clarifies bug fix with ambiguous mapping pattern', () => {
    const eco = makeEco({
      intentPrimary:   'bug_fix',
      mappingSeverity: 'escalate',
      mapping: { pattern: 'ambiguous', roots_ranked: [] },
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
    expect(d.reasonCodes).toContain('LOW_MAPPING_CONFIDENCE');
  });

  it('clarifies bug fix with escalated coverage and no modules', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      coverageSeverity: 'escalate',
      modules_touched:  [],
      mapping: { pattern: 'unknown', roots_ranked: [] },
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
    // Either LOW_COVERAGE or MISSING_EXECUTION_PATH should appear
    const hasClarifyCode = d.reasonCodes.some(c =>
      c === 'LOW_COVERAGE' || c === 'MISSING_EXECUTION_PATH',
    );
    expect(hasClarifyCode).toBe(true);
  });

  it('clarifies when freshness is block-level (not refuse)', () => {
    const eco = makeEco({
      intentPrimary:     'bug_fix',
      freshnessSeverity: 'block',
      // everything else is fine
      coverageSeverity:  'pass',
      mappingSeverity:   'pass',
      modules_touched:   ['src/foo.ts'],
    });
    const d = evaluateEvidenceGate(eco);
    // freshness=block → clarify, NOT refuse
    expect(d.verdict).toBe('clarify');
    // Must NOT be refuse
    expect(d.verdict).not.toBe('refuse');
  });

  it('clarifies feature with incomplete graph (escalate)', () => {
    const eco = makeEco({
      intentPrimary:    'new_feature',
      graphSeverity:    'escalate',
      coverageSeverity: 'pass',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
    expect(d.reasonCodes).toContain('GRAPH_INCOMPLETE');
  });

  it('clarifies refactor with ownership overlap conflict', () => {
    const eco = makeEco({
      intentPrimary:    'refactor',
      conflictSeverity: 'warn',
      conflicts: [
        { type: 'ownership_overlap', severity: 'medium', resolution_hint: 'needs_clarification' },
      ],
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
    expect(d.reasonCodes).toContain('INSUFFICIENT_SCOPE_BINDING');
  });

  it('clarification questions are non-empty on clarify verdict', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      mappingSeverity:  'escalate',
      mapping: { pattern: 'ambiguous', roots_ranked: [] },
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
    expect(d.clarificationQuestions.length).toBeGreaterThan(0);
    // Each question must be a non-empty string
    for (const q of d.clarificationQuestions) {
      expect(typeof q).toBe('string');
      expect(q.length).toBeGreaterThan(0);
    }
  });

  it('refusalDetail is null on clarify', () => {
    const eco = makeEco({
      intentPrimary:   'new_feature',
      intentComposite: true,
      intentConfidence: 'low',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
    expect(d.refusalDetail).toBeNull();
  });

  it('clarifies when reclassification is required', () => {
    const eco = makeEco({
      intentPrimary: 'bug_fix',
      reclassification: { required: true, reason: 'scope changed' },
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
    expect(d.reasonCodes).toContain('RECLASSIFICATION_REQUIRED');
  });
});

// ─── 5. Unit — Refuse Cases ──────────────────────────────────────────────────

describe('Sprint 13 — Unit: Refuse Cases', () => {
  it('refuses when forced_unknown is true — non-overrideable', () => {
    const eco = makeEco({
      intentPrimary:  'bug_fix',
      forced_unknown: true,
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('FORCED_UNKNOWN_HIGH_RISK');
    // Must be non-overrideable
    expect(d.refusalDetail).not.toBeNull();
    expect(d.refusalDetail!.overrideable).toBe(false);
  });

  it('refuses when conflict dimension is block', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      conflictSeverity: 'block',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('HIGH_CONFLICT_UNRESOLVED');
  });

  it('refuses when a conflict has must_block resolution hint', () => {
    const eco = makeEco({
      intentPrimary:    'new_feature',
      conflictSeverity: 'high',
      conflicts: [
        { severity: 'high', resolution_hint: 'must_block', type: 'circular_dependency' },
      ],
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('HIGH_CONFLICT_UNRESOLVED');
  });

  it('refuses when coverage is block — missing scope binding', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      coverageSeverity: 'block',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('LOW_COVERAGE');
  });

  it('refuses when mapping is block for bug_fix', () => {
    const eco = makeEco({
      intentPrimary:   'bug_fix',
      mappingSeverity: 'block',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('LOW_MAPPING_CONFIDENCE');
  });

  it('refuses when graph is block for refactor', () => {
    const eco = makeEco({
      intentPrimary: 'refactor',
      graphSeverity: 'block',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('GRAPH_INCOMPLETE');
  });

  it('refuses when graph is block for new_feature', () => {
    const eco = makeEco({
      intentPrimary: 'new_feature',
      graphSeverity: 'block',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('GRAPH_INCOMPLETE');
  });

  it('refuses when intent is unknown', () => {
    const eco = makeEco({ intentPrimary: 'unknown' });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('MISSING_TARGET_FILES');
  });

  it('refusalDetail is populated on refuse', () => {
    const eco = makeEco({
      intentPrimary:  'bug_fix',
      forced_unknown: true,
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.refusalDetail).not.toBeNull();
    expect(typeof d.refusalDetail!.why).toBe('string');
    expect(d.refusalDetail!.failedRules.length).toBeGreaterThan(0);
  });

  it('refuse verdict from forced_unknown is not overrideable; other refuses are', () => {
    const forcedEco = makeEco({ forced_unknown: true });
    const dForced = evaluateEvidenceGate(forcedEco);
    expect(dForced.refusalDetail!.overrideable).toBe(false);

    const conflictEco = makeEco({ conflictSeverity: 'block' });
    const dConflict = evaluateEvidenceGate(conflictEco);
    expect(dConflict.refusalDetail!.overrideable).toBe(true);
  });
});

// ─── 6. Determinism Guarantee ────────────────────────────────────────────────

describe('Sprint 13 — Determinism', () => {
  it('same input always yields same verdict (called 5x)', () => {
    const eco = makeEco({
      intentPrimary:   'bug_fix',
      mappingSeverity: 'escalate',
      mapping: { pattern: 'ambiguous', roots_ranked: [] },
    });
    const verdicts = Array.from({ length: 5 }, () => evaluateEvidenceGate(eco).verdict);
    expect(new Set(verdicts).size).toBe(1);  // all identical
  });

  it('same input yields same reasonCodes (deterministic code order)', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      conflictSeverity: 'block',
      coverageSeverity: 'block',
    });
    const runs = Array.from({ length: 3 }, () => evaluateEvidenceGate(eco).reasonCodes.join(','));
    expect(new Set(runs).size).toBe(1);
  });

  it('no LLM-variable text — summary is deterministic', () => {
    const eco = makeEco({ intentPrimary: 'new_feature' });
    const s1 = evaluateEvidenceGate(eco).summary;
    const s2 = evaluateEvidenceGate(eco).summary;
    expect(s1).toBe(s2);
  });
});

// ─── 7. Verdict Precedence ────────────────────────────────────────────────────

describe('Sprint 13 — Verdict Precedence', () => {
  it('refuse wins over clarify — forced_unknown beats ambiguous intent', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      intentComposite:  true,
      intentConfidence: 'low',
      forced_unknown:   true,
    });
    const d = evaluateEvidenceGate(eco);
    // Both FORCED_UNKNOWN_HIGH_RISK and AMBIGUOUS_INTENT should fire;
    // refuse must win
    expect(d.verdict).toBe('refuse');
    expect(d.reasonCodes).toContain('FORCED_UNKNOWN_HIGH_RISK');
  });

  it('refuse wins when multiple rules contribute different verdicts', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      conflictSeverity: 'block',   // → refuse
      mappingSeverity:  'escalate', // → clarify
      intentComposite:  true,
      intentConfidence: 'low',     // → clarify
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
  });

  it('clarify wins over pass when no refuse-level rule fires', () => {
    const eco = makeEco({
      intentPrimary:    'new_feature',
      intentComposite:  true,
      intentConfidence: 'low',  // → clarify
      conflictSeverity: 'warn', // → pass
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('clarify');
  });
});

// ─── 8. evidenceGateHandler — Pipeline Contract ───────────────────────────────

describe('Sprint 13 — evidenceGateHandler (Pipeline Contract)', () => {
  it('returns SufficiencyGateOutput shape', async () => {
    const eco = makeEco({ intentPrimary: 'bug_fix' });
    const out = await evidenceGateHandler(eco);
    expect(out).toHaveProperty('behavior');
    expect(out).toHaveProperty('lane');
    expect(out).toHaveProperty('reason');
  });

  it('maps pass verdict to behavior=pass', async () => {
    const eco = makeEco({ intentPrimary: 'bug_fix' });
    const out = await evidenceGateHandler(eco);
    expect(out.behavior).toBe('pass');
  });

  it('maps clarify verdict to behavior=ask', async () => {
    const eco = makeEco({
      intentPrimary:   'bug_fix',
      mappingSeverity: 'escalate',
      mapping: { pattern: 'ambiguous', roots_ranked: [] },
    });
    const out = await evidenceGateHandler(eco);
    expect(out.behavior).toBe('ask');
  });

  it('maps refuse verdict to behavior=block', async () => {
    const eco = makeEco({
      intentPrimary: 'bug_fix',
      forced_unknown: true,
    });
    const out = await evidenceGateHandler(eco);
    expect(out.behavior).toBe('block');
  });

  it('carries recommended_lane from ECO on pass', async () => {
    const eco = makeEco({ intentPrimary: 'bug_fix', recommended_lane: 'B' });
    const out = await evidenceGateHandler(eco);
    expect(out.lane).toBe('B');
  });

  it('returns lane C on non-pass (pipeline is stopping)', async () => {
    const eco = makeEco({
      intentPrimary: 'bug_fix',
      forced_unknown: true,
      recommended_lane: 'A',
    });
    const out = await evidenceGateHandler(eco);
    expect(out.lane).toBe('C');
  });

  it('reason field is a non-empty string summary', async () => {
    const eco = makeEco({ intentPrimary: 'new_feature' });
    const out = await evidenceGateHandler(eco);
    expect(typeof out.reason).toBe('string');
    expect(out.reason.length).toBeGreaterThan(0);
  });
});

// ─── 9. Regression — Stub Cannot Reappear ────────────────────────────────────

describe('Sprint 13 — Regression: Stub Cannot Reappear', () => {
  it('incomplete evidence does NOT pass (coverage=block fails)', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      coverageSeverity: 'block',
      modules_touched:  [],
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).not.toBe('pass');
  });

  it('unknown intent does NOT pass', () => {
    const eco = makeEco({ intentPrimary: 'unknown' });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).not.toBe('pass');
  });

  it('forced_unknown does NOT pass regardless of dimension quality', () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      forced_unknown:   true,
      coverageSeverity: 'pass',
      mappingSeverity:  'pass',
      graphSeverity:    'pass',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).toBe('refuse');
  });

  it('block-level conflict does NOT pass', () => {
    const eco = makeEco({
      intentPrimary:    'new_feature',
      conflictSeverity: 'block',
    });
    const d = evaluateEvidenceGate(eco);
    expect(d.verdict).not.toBe('pass');
  });

  it('perRuleResults is never empty — gate always evaluates rules', () => {
    const eco = makeEco({ intentPrimary: 'config_infra' });
    const d = evaluateEvidenceGate(eco);
    expect(d.perRuleResults.length).toBeGreaterThan(0);
  });
});

// ─── 10. Integration — Pipeline Hard-Stops ───────────────────────────────────

describe('Sprint 13 — Integration: Pipeline Hard-Stops', () => {
  /** Build minimal handlers; SUFFICIENCY_GATE uses the real evidence gate. */
  function makeHandlers(gateOverride?: (input: unknown) => Promise<SufficiencyGateOutput>) {
    return {
      INTENT_DETECT: async (_input: unknown) => ({
        primary:   'bug_fix',
        composite: false,
      }),
      ECO_BUILD: async (_input: unknown): Promise<SufficiencyGateInput> => ({
        intent:          { primary: 'bug_fix', composite: false },
        eco_dimensions: {
          coverage:  { severity: 'pass' },
          freshness: { severity: 'pass' },
          mapping:   { severity: 'pass' },
          conflict:  { severity: 'pass' },
          graph:     { severity: 'pass' },
        },
        confidence_score: 80,
        modules_touched:  ['src/foo.ts'],
        mapping: { pattern: '1:1', roots_ranked: [{ rank: '1' }] },
        forced_unknown:   false,
        blocked:          false,
        recommended_lane: 'A',
      } as unknown as SufficiencyGateInput),
      SUFFICIENCY_GATE: gateOverride ?? evidenceGateHandler,
      TEE_BUILD: async (_input: unknown) => ({
        blocked_paths:           [],
        blocked_symbols:         [],
        clarification_questions: [],
        proceed_warnings:        [],
      }),
      CLASSIFY_LANE: async (_input: unknown) => ({
        lane:   'A',
        set_by: 'P1' as const,
        reason: 'default',
      }),
    };
  }

  it('pipeline completes when gate passes', async () => {
    const result = await runOrchestrator(
      { specPath: null, query: 'fix the login bug' },
      makeHandlers(),
    );
    expect(result.completed).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('pipeline hard-stops before TEE when gate returns ask (clarify)', async () => {
    let teeWasCalled = false;

    const handlers = makeHandlers(async (_input: unknown) => ({
      behavior: 'ask' as const,
      lane: 'C',
      reason: 'clarification required',
    }));
    handlers.TEE_BUILD = async (_input: unknown) => {
      teeWasCalled = true;
      return { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] };
    };

    const result = await runOrchestrator(
      { specPath: null, query: 'add some feature' },
      handlers,
    );

    expect(result.blocked).toBe(true);
    expect(result.blockedAt).toBe('SUFFICIENCY_GATE');
    expect(result.completed).toBe(false);
    expect(teeWasCalled).toBe(false);  // TEE must NOT have run
  });

  it('pipeline hard-stops before TEE when gate returns block (refuse)', async () => {
    let teeWasCalled = false;

    const handlers = makeHandlers(async (_input: unknown) => ({
      behavior: 'block' as const,
      lane: 'C',
      reason: 'evidence gate refused',
    }));
    handlers.TEE_BUILD = async (_input: unknown) => {
      teeWasCalled = true;
      return { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] };
    };

    const result = await runOrchestrator(
      { specPath: null, query: 'unknown change' },
      handlers,
    );

    expect(result.blocked).toBe(true);
    expect(result.blockedAt).toBe('SUFFICIENCY_GATE');
    expect(teeWasCalled).toBe(false);  // TEE must NOT have run
  });

  it('CLASSIFY_LANE is also unreachable when gate stops pipeline', async () => {
    let laneWasCalled = false;

    const handlers = makeHandlers(async () => ({
      behavior: 'block' as const,
      lane: 'C',
      reason: 'refused',
    }));
    handlers.CLASSIFY_LANE = async (_input: unknown) => {
      laneWasCalled = true;
      return { lane: 'A', set_by: 'P1' as const, reason: '' };
    };

    await runOrchestrator({ specPath: null, query: 'test' }, handlers);
    expect(laneWasCalled).toBe(false);
  });

  it('pipeline emits ledger entries including a refusal entry on block', async () => {
    const entries: LedgerEntry[] = [];

    const handlers = makeHandlers(async () => ({
      behavior: 'block' as const,
      lane: 'C',
      reason: 'gate refused',
    }));

    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        onLedgerEntry: (e) => entries.push(e),
      },
      handlers,
    );

    // At least one refusal record should be emitted
    const refusalEntries = entries.filter(e => e.record_type === 'refusal');
    expect(refusalEntries.length).toBeGreaterThan(0);
  });

  it('pipeline emits a clarify refusal entry on ask verdict', async () => {
    const entries: LedgerEntry[] = [];

    const handlers = makeHandlers(async () => ({
      behavior: 'ask' as const,
      lane: 'C',
      reason: 'gate needs clarification',
    }));

    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        onLedgerEntry: (e) => entries.push(e),
      },
      handlers,
    );

    const refusalEntries = entries.filter(e => e.record_type === 'refusal');
    expect(refusalEntries.length).toBeGreaterThan(0);
    // The refusal code should indicate clarification
    const clarifyEntry = refusalEntries.find(e =>
      (e.payload as { refusal_code?: string }).refusal_code === 'EVIDENCE_GATE_CLARIFY',
    );
    expect(clarifyEntry).toBeDefined();
  });

  it('pipeline emits outcome with completion_state=refused on gate block', async () => {
    const entries: LedgerEntry[] = [];

    await runOrchestrator(
      {
        specPath: null,
        query: 'test',
        onLedgerEntry: (e) => entries.push(e),
      },
      makeHandlers(async () => ({
        behavior: 'block' as const,
        lane: 'C',
        reason: 'refused',
      })),
    );

    const outcomeEntries = entries.filter(e => e.record_type === 'outcome');
    expect(outcomeEntries.length).toBeGreaterThan(0);
    const outcome = outcomeEntries[0].payload as { completion_state?: string };
    expect(outcome.completion_state).toBe('refused');
  });

  it('pass verdict allows pipeline to complete with ledger entries', async () => {
    const entries: LedgerEntry[] = [];

    const result = await runOrchestrator(
      {
        specPath: null,
        query: 'fix bug',
        onLedgerEntry: (e) => entries.push(e),
      },
      makeHandlers(),
    );

    expect(result.completed).toBe(true);
    // At least one decision entry should be present
    const decisionEntries = entries.filter(e => e.record_type === 'decision');
    expect(decisionEntries.length).toBeGreaterThan(0);
  });
});

// ─── 11. Ledger — fromEvidenceGateDecision Mapper ────────────────────────────

describe('Sprint 13 — Ledger: fromEvidenceGateDecision', () => {
  function makeDecision(verdict: EvidenceGateVerdict): Parameters<typeof fromEvidenceGateDecision>[0] {
    return {
      verdict,
      reasonCodes: verdict === 'pass' ? [] : ['HIGH_CONFLICT_UNRESOLVED'],
      summary:     `Gate ${verdict} for intent 'bug_fix'`,
      perRuleResults: [
        {
          ruleCode:           'HIGH_CONFLICT_UNRESOLVED',
          passed:             verdict === 'pass',
          verdictContribution: verdict === 'pass' ? null : verdict,
          detail:             'test detail',
        },
      ],
      provenance: {
        dimensionsRead:       { coverage: 'pass', freshness: 'pass', mapping: 'pass', conflict: 'block', graph: 'pass' },
        intentClass:          'bug_fix',
        forcedUnknownApplied: false,
      },
    };
  }

  const baseOpts = { trace_id: 'tr_test', request_id: 'req_test' };

  it('returns a valid LedgerEntry on pass verdict', () => {
    const entry = fromEvidenceGateDecision(makeDecision('pass'), baseOpts);
    expect(entry.schema_version).toBe('1.0.0');
    expect(entry.record_type).toBe('decision');
    expect(entry.stage).toBe('classification');
    expect(entry.actor).toBe('system');
  });

  it('decision_code is EVIDENCE_GATE_EVALUATED', () => {
    const entry = fromEvidenceGateDecision(makeDecision('pass'), baseOpts);
    const payload = entry.payload as { decision_code?: string };
    expect(payload.decision_code).toBe('EVIDENCE_GATE_EVALUATED');
  });

  it('result.selected_value reflects the verdict', () => {
    for (const verdict of ['pass', 'clarify', 'refuse'] as EvidenceGateVerdict[]) {
      const entry = fromEvidenceGateDecision(makeDecision(verdict), baseOpts);
      const payload = entry.payload as { result: { selected_value?: string } };
      expect(payload.result.selected_value).toBe(verdict);
    }
  });

  it('severity is critical on refuse, high on clarify, low on pass', () => {
    const refuse  = fromEvidenceGateDecision(makeDecision('refuse'),  baseOpts);
    const clarify = fromEvidenceGateDecision(makeDecision('clarify'), baseOpts);
    const pass    = fromEvidenceGateDecision(makeDecision('pass'),    baseOpts);

    const sev = (e: LedgerEntry) => (e.payload as { severity?: string }).severity;
    expect(sev(refuse)).toBe('critical');
    expect(sev(clarify)).toBe('high');
    expect(sev(pass)).toBe('low');
  });

  it('rationale.signal_refs contains intent and dimension references', () => {
    const entry = fromEvidenceGateDecision(makeDecision('pass'), baseOpts);
    const payload = entry.payload as { rationale: { signal_refs?: string[] } };
    expect(payload.rationale.signal_refs).toContain('intent:bug_fix');
    expect(payload.rationale.signal_refs?.some(s => s.startsWith('coverage:'))).toBe(true);
  });

  it('parent_ledger_id is propagated', () => {
    const entry = fromEvidenceGateDecision(makeDecision('pass'), {
      ...baseOpts,
      parent_ledger_id: 'parent_abc',
    });
    expect(entry.parent_ledger_id).toBe('parent_abc');
  });

  it('ledger_id is unique across calls', () => {
    const ids = Array.from({ length: 5 }, () =>
      fromEvidenceGateDecision(makeDecision('pass'), baseOpts).ledger_id,
    );
    expect(new Set(ids).size).toBe(5);
  });
});

// ─── 12. Full evidenceGateHandler with real ECO evaluation ───────────────────

describe('Sprint 13 — evidenceGateHandler end-to-end scenarios', () => {
  it('bug_fix with no code path → ask (clarify)', async () => {
    const eco = makeEco({
      intentPrimary:    'bug_fix',
      modules_touched:  [],
      mapping: { pattern: 'unknown', roots_ranked: [] },
      coverageSeverity: 'escalate',
    });
    const out = await evidenceGateHandler(eco);
    expect(out.behavior).toBe('ask');
  });

  it('new_feature with blocking graph → block (refuse)', async () => {
    const eco = makeEco({
      intentPrimary: 'new_feature',
      graphSeverity: 'block',
    });
    const out = await evidenceGateHandler(eco);
    expect(out.behavior).toBe('block');
  });

  it('refactor with blocking conflict → block (refuse)', async () => {
    const eco = makeEco({
      intentPrimary:    'refactor',
      conflictSeverity: 'block',
    });
    const out = await evidenceGateHandler(eco);
    expect(out.behavior).toBe('block');
  });

  it('config_infra with good dimensions → pass', async () => {
    const eco = makeEco({
      intentPrimary:    'config_infra',
      coverageSeverity: 'warn',
      graphSeverity:    'warn',
    });
    const out = await evidenceGateHandler(eco);
    expect(out.behavior).toBe('pass');
  });
});
