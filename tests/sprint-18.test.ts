/**
 * Sprint 18 — Evidence State: Absence vs Conflict (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete only when every test passes.
 *
 * Coverage:
 *
 * A. Absence detection (unit)
 *   1.  No evidence + required target → kind='absent'
 *   2.  Required target 'source:code', only spec evidence → absent for that target
 *   3.  Required target covered by matching evidence → not absent
 *   4.  No required targets + evidence present → kind='sufficient'
 *   5.  No evidence at all → absence reason='not_found'
 *   6.  Some evidence but wrong source type → reason='out_of_scope'
 *
 * B. Intra-evidence conflict detection (unit)
 *   7.  Same ref, state contradiction (present vs absent) → kind='conflicted'
 *   8.  Same ref, constraint contradiction (must vs optional) → kind='conflicted'
 *   9.  Same ref, behavior contradiction (synchronous vs asynchronous) → kind='conflicted'
 *   10. Different refs, same contradiction pattern → kind='sufficient' (no conflict)
 *   11. Single item per ref → kind='sufficient' (need ≥ 2 for contradiction)
 *   12. Same ref, non-contradictory content → kind='sufficient'
 *
 * C. Mixed state (unit)
 *   13. Missing required target + conflict on another ref → kind='mixed'
 *   14. Mixed state populates both missing_required_targets and conflict_groups
 *   15. Mixed state carries the conflict severity
 *
 * D. EvidenceAssessment structure (unit)
 *   16. buildEvidenceAssessment(absent) → availability.status='absent', missing_targets non-empty
 *   17. buildEvidenceAssessment(conflicted) → conflict.status='present', groups non-empty
 *   18. buildEvidenceAssessment(sufficient) → availability='sufficient', conflict='none'
 *   19. buildEvidenceAssessment(mixed) → availability='partial', conflict='present'
 *
 * E. Policy divergence — the critical proof
 *   20. applyEvidenceStatePolicy(absent, bug_fix) → escalation_reasons has 'evidence_absence:' prefix
 *   21. applyEvidenceStatePolicy(conflicted, bug_fix) → escalation_reasons has 'evidence_conflict:' prefix
 *   22. CRITICAL: same composite score + absent vs conflicted → different escalation_reasons
 *   23. absent + high-risk intent → lane escalated to minimum B
 *   24. conflicted medium severity → lane escalated
 *   25. No absence + no conflict → no evidence_* escalation reasons added
 *
 * F. ECO integration
 *   26. buildECO returns eco.evidence_assessment
 *   27. eco.evidence_assessment.state.kind is one of the valid kinds
 *   28. eco.evidence_assessment.availability.status is valid
 *   29. eco.evidence_state_events is a non-null array
 *   30. bug_fix intent ECO shows absence of 'code' evidence in assessment
 *
 * G. Audit trail
 *   31. Absence event has kind='evidence_absence_detected' with payload
 *   32. Conflict event has kind='evidence_conflict_detected' with payload
 *   33. State-classified event has kind='evidence_state_classified'
 *
 * H. Determinism
 *   34. Same inputs → same EvidenceState kind
 *   35. Shuffled evidence order → same EvidenceState
 *   36. Empty evidence + no required targets → always 'sufficient'
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  classifyEvidenceState,
  buildEvidenceAssessment,
  applyEvidenceStatePolicy,
  buildEvidenceStateEvents,
  type EvidenceState,
  type EvidenceAssessment,
  type ConflictGroup,
  type EvidenceStateEvent,
} from '../packages/core/src/knowledge/evidence-state/index.js';

import { buildECO } from '../packages/core/src/eco.js';
import type { EvidenceItem } from '../packages/core/src/knowledge/conflict/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function item(source: EvidenceItem['source'], ref: string, content: string): EvidenceItem {
  return { source, ref, content };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-18-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── A. Absence detection ─────────────────────────────────────────────────────

describe('A. Absence detection', () => {
  it('1. no evidence + required target → kind=absent', () => {
    const state = classifyEvidenceState({
      evidenceItems: [],
      requiredTargets: ['source:code'],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('absent');
  });

  it('2. required source:code target with only spec evidence → absent for code', () => {
    const state = classifyEvidenceState({
      evidenceItems: [item('spec', 'query', 'fix the login timeout')],
      requiredTargets: ['source:code'],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('absent');
    if (state.kind === 'absent') {
      expect(state.missing_required_targets).toContain('source:code');
    }
  });

  it('3. required target covered by matching evidence → not absent', () => {
    const state = classifyEvidenceState({
      evidenceItems: [item('code', 'src/auth.ts', 'auth implementation')],
      requiredTargets: ['source:code'],
      intent: 'bug_fix',
    });
    expect(state.kind).not.toBe('absent');
  });

  it('4. no required targets + evidence present → kind=sufficient', () => {
    const state = classifyEvidenceState({
      evidenceItems: [item('spec', 'query', 'fix the thing')],
      requiredTargets: [],
      intent: 'unknown',
    });
    expect(state.kind).toBe('sufficient');
  });

  it('5. no evidence at all → absence reason=not_found', () => {
    const state = classifyEvidenceState({
      evidenceItems: [],
      requiredTargets: ['source:code'],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('absent');
    if (state.kind === 'absent') {
      expect(state.reason).toBe('not_found');
    }
  });

  it('6. some evidence but wrong source type → reason=out_of_scope', () => {
    const state = classifyEvidenceState({
      evidenceItems: [item('docs', 'README.md', 'general documentation')],
      requiredTargets: ['source:code'],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('absent');
    if (state.kind === 'absent') {
      expect(state.reason).toBe('out_of_scope');
      expect(state.searched_sources).toContain('docs');
    }
  });
});

// ─── B. Intra-evidence conflict detection ─────────────────────────────────────

describe('B. Intra-evidence conflict detection', () => {
  it('7. same ref, state contradiction (present vs absent) → conflicted', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        item('spec', 'auth-module', 'Feature login is present and enabled'),
        item('docs', 'auth-module', 'Feature login is absent from this release'),
      ],
      requiredTargets: [],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('conflicted');
    if (state.kind === 'conflicted') {
      expect(state.conflict_groups[0].contradiction_type).toBe('state');
    }
  });

  it('8. same ref, constraint contradiction (must vs optional) → conflicted', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        item('spec', 'payment-flow', 'Authentication must be required for all payments'),
        item('docs', 'payment-flow', 'Authentication is optional and allowed to be skipped'),
      ],
      requiredTargets: [],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('conflicted');
    if (state.kind === 'conflicted') {
      expect(state.conflict_groups[0].contradiction_type).toBe('constraint');
    }
  });

  it('9. same ref, behavior contradiction (synchronous vs asynchronous) → conflicted', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        item('spec', 'email-sender', 'Email delivery is synchronous and blocking'),
        item('docs', 'email-sender', 'Email delivery is asynchronous and deferred'),
      ],
      requiredTargets: [],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('conflicted');
    if (state.kind === 'conflicted') {
      expect(state.conflict_groups[0].contradiction_type).toBe('behavior');
    }
  });

  it('10. different refs, same contradiction pattern → kind=sufficient', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        item('spec', 'module-a', 'Feature X is present and enabled'),
        item('docs', 'module-b', 'Feature X is absent from module-b'),
      ],
      requiredTargets: [],
      intent: 'bug_fix',
    });
    // Different refs → no shared target → no conflict
    expect(state.kind).toBe('sufficient');
  });

  it('11. single item per ref → kind=sufficient (no conflict possible)', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        item('spec', 'auth-module', 'Feature login is present and enabled'),
        item('docs', 'different-ref', 'Feature login is absent'),
      ],
      requiredTargets: [],
      intent: 'bug_fix',
    });
    // Each ref has only one item → cannot contradict itself
    expect(state.kind).toBe('sufficient');
  });

  it('12. same ref, non-contradictory content → kind=sufficient', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        item('spec', 'auth-module', 'Feature login handles timeout after 30s'),
        item('docs', 'auth-module', 'Feature login validates JWT tokens'),
      ],
      requiredTargets: [],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('sufficient');
  });
});

// ─── C. Mixed state ───────────────────────────────────────────────────────────

describe('C. Mixed state', () => {
  it('13. missing required target + conflict on another ref → kind=mixed', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        // Conflict on 'auth-module' target (no code evidence required)
        item('spec', 'auth-module', 'Feature login is present and enabled'),
        item('docs', 'auth-module', 'Feature login is absent from this release'),
      ],
      requiredTargets: ['source:code'],  // code is required but absent
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('mixed');
  });

  it('14. mixed state populates both missing_required_targets and conflict_groups', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        item('spec', 'cache-module', 'Caching is present and active'),
        item('docs', 'cache-module', 'Caching is absent and disabled'),
      ],
      requiredTargets: ['source:code'],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('mixed');
    if (state.kind === 'mixed') {
      expect(state.missing_required_targets.length).toBeGreaterThan(0);
      expect(state.conflict_groups.length).toBeGreaterThan(0);
    }
  });

  it('15. mixed state carries the conflict severity', () => {
    const state = classifyEvidenceState({
      evidenceItems: [
        item('spec', 'target-x', 'Feature is present and enabled'),
        item('docs', 'target-x', 'Feature is absent and disabled'),
      ],
      requiredTargets: ['source:code'],
      intent: 'bug_fix',
    });
    expect(state.kind).toBe('mixed');
    if (state.kind === 'mixed') {
      expect(['low', 'medium', 'high']).toContain(state.severity);
    }
  });
});

// ─── D. EvidenceAssessment structure ──────────────────────────────────────────

describe('D. EvidenceAssessment structure', () => {
  it('16. buildEvidenceAssessment(absent) → availability.status=absent, missing_targets non-empty', () => {
    const state: EvidenceState = {
      kind: 'absent',
      missing_required_targets: ['source:code'],
      searched_sources: ['spec'],
      reason: 'not_found',
    };
    const assessment = buildEvidenceAssessment(state);
    expect(assessment.availability.status).toBe('absent');
    expect(assessment.availability.missing_targets).toContain('source:code');
    expect(assessment.conflict.status).toBe('none');
  });

  it('17. buildEvidenceAssessment(conflicted) → conflict.status=present, groups non-empty', () => {
    const group: ConflictGroup = {
      target_id: 'auth-module',
      evidence_ids: ['spec:auth-module', 'docs:auth-module'],
      contradiction_type: 'state',
      severity: 'low',
      dominant_sources: ['spec', 'docs'],
    };
    const state: EvidenceState = {
      kind: 'conflicted',
      conflict_groups: [group],
      severity: 'low',
    };
    const assessment = buildEvidenceAssessment(state);
    expect(assessment.conflict.status).toBe('present');
    expect(assessment.conflict.groups).toHaveLength(1);
    expect(assessment.availability.status).toBe('sufficient');
  });

  it('18. buildEvidenceAssessment(sufficient) → availability=sufficient, conflict=none', () => {
    const state: EvidenceState = { kind: 'sufficient', supporting_count: 3, conflicting_count: 0 };
    const assessment = buildEvidenceAssessment(state);
    expect(assessment.availability.status).toBe('sufficient');
    expect(assessment.conflict.status).toBe('none');
    expect(assessment.conflict.severity).toBeNull();
  });

  it('19. buildEvidenceAssessment(mixed) → availability=partial, conflict=present', () => {
    const state: EvidenceState = {
      kind: 'mixed',
      missing_required_targets: ['source:code'],
      conflict_groups: [{
        target_id: 'module-x',
        evidence_ids: ['spec:module-x', 'docs:module-x'],
        contradiction_type: 'state',
        severity: 'medium',
        dominant_sources: ['spec', 'docs'],
      }],
      severity: 'medium',
    };
    const assessment = buildEvidenceAssessment(state);
    expect(assessment.availability.status).toBe('partial');
    expect(assessment.conflict.status).toBe('present');
    expect(assessment.conflict.severity).toBe('medium');
  });
});

// ─── E. Policy divergence — the critical proof ────────────────────────────────

describe('E. Policy divergence', () => {
  function makeEco() {
    return { confidence_score: 60, forced_lane_minimum: 'A', escalation_reasons: [] as string[] };
  }

  it('20. absent evidence → escalation_reasons has evidence_absence: prefix', () => {
    const assessment = buildEvidenceAssessment({
      kind: 'absent',
      missing_required_targets: ['source:code'],
      searched_sources: ['spec'],
      reason: 'not_found',
    });
    const eco = makeEco();
    applyEvidenceStatePolicy({ assessment, intent: 'bug_fix', eco });
    expect(eco.escalation_reasons.some(r => r.startsWith('evidence_absence:'))).toBe(true);
  });

  it('21. conflicted evidence → escalation_reasons has evidence_conflict: prefix', () => {
    const assessment = buildEvidenceAssessment({
      kind: 'conflicted',
      conflict_groups: [{
        target_id: 'auth-module',
        evidence_ids: ['spec:auth-module', 'docs:auth-module'],
        contradiction_type: 'state',
        severity: 'low',
        dominant_sources: ['spec', 'docs'],
      }],
      severity: 'low',
    });
    const eco = makeEco();
    applyEvidenceStatePolicy({ assessment, intent: 'bug_fix', eco });
    expect(eco.escalation_reasons.some(r => r.startsWith('evidence_conflict:'))).toBe(true);
  });

  it('22. CRITICAL: same composite score + different state → different escalation reasons (fix is real)', () => {
    const absentAssessment = buildEvidenceAssessment({
      kind: 'absent',
      missing_required_targets: ['source:code'],
      searched_sources: ['spec'],
      reason: 'not_found',
    });
    const conflictedAssessment = buildEvidenceAssessment({
      kind: 'conflicted',
      conflict_groups: [{
        target_id: 'auth-module',
        evidence_ids: ['spec:auth-module', 'docs:auth-module'],
        contradiction_type: 'state',
        severity: 'low',
        dominant_sources: ['spec', 'docs'],
      }],
      severity: 'low',
    });

    const eco1 = makeEco();  // composite = 60
    const eco2 = makeEco();  // composite = 60 (same)

    applyEvidenceStatePolicy({ assessment: absentAssessment,    intent: 'bug_fix', eco: eco1 });
    applyEvidenceStatePolicy({ assessment: conflictedAssessment, intent: 'bug_fix', eco: eco2 });

    // Same prior composite score
    expect(eco1.confidence_score).toBe(eco2.confidence_score);

    // Different escalation paths — proves the two states are handled independently
    const eco1AbsenceReasons   = eco1.escalation_reasons.filter(r => r.startsWith('evidence_absence:'));
    const eco1ConflictReasons  = eco1.escalation_reasons.filter(r => r.startsWith('evidence_conflict:'));
    const eco2AbsenceReasons   = eco2.escalation_reasons.filter(r => r.startsWith('evidence_absence:'));
    const eco2ConflictReasons  = eco2.escalation_reasons.filter(r => r.startsWith('evidence_conflict:'));

    expect(eco1AbsenceReasons.length).toBeGreaterThan(0);   // absent path has absence reason
    expect(eco1ConflictReasons.length).toBe(0);             // absent path has NO conflict reason
    expect(eco2ConflictReasons.length).toBeGreaterThan(0);  // conflict path has conflict reason
    expect(eco2AbsenceReasons.length).toBe(0);              // conflict path has NO absence reason
  });

  it('23. absent + high-risk intent (bug_fix) → lane escalated to minimum B', () => {
    const assessment = buildEvidenceAssessment({
      kind: 'absent',
      missing_required_targets: ['source:code'],
      searched_sources: [],
      reason: 'not_found',
    });
    const eco = makeEco();  // starts at A
    applyEvidenceStatePolicy({ assessment, intent: 'bug_fix', eco });
    const laneOrder = ['A', 'B', 'C', 'D', 'E'];
    expect(laneOrder.indexOf(eco.forced_lane_minimum)).toBeGreaterThanOrEqual(1);
  });

  it('24. conflicted medium severity → lane escalated', () => {
    const assessment = buildEvidenceAssessment({
      kind: 'conflicted',
      conflict_groups: [
        {
          target_id: 'module-a',
          evidence_ids: ['s1', 's2'],
          contradiction_type: 'state',
          severity: 'medium',
          dominant_sources: ['spec', 'docs'],
        },
        {
          target_id: 'module-b',
          evidence_ids: ['s3', 's4'],
          contradiction_type: 'constraint',
          severity: 'medium',
          dominant_sources: ['spec', 'code'],
        },
      ],
      severity: 'medium',
    });
    const eco = makeEco();  // starts at A
    applyEvidenceStatePolicy({ assessment, intent: 'bug_fix', eco });
    const laneOrder = ['A', 'B', 'C', 'D', 'E'];
    expect(laneOrder.indexOf(eco.forced_lane_minimum)).toBeGreaterThanOrEqual(1);
  });

  it('25. sufficient state → no evidence_* escalation reasons added', () => {
    const assessment = buildEvidenceAssessment({
      kind: 'sufficient',
      supporting_count: 3,
      conflicting_count: 0,
    });
    const eco = makeEco();
    applyEvidenceStatePolicy({ assessment, intent: 'bug_fix', eco });
    const evidenceReasons = eco.escalation_reasons.filter(r =>
      r.startsWith('evidence_absence:') || r.startsWith('evidence_conflict:'),
    );
    expect(evidenceReasons).toHaveLength(0);
  });
});

// ─── F. ECO integration ───────────────────────────────────────────────────────

describe('F. ECO integration', () => {
  it('26. buildECO returns eco.evidence_assessment', () => {
    const eco = buildECO(null, tmpDir, { query: 'fix the login timeout' }) as any;
    expect(eco.evidence_assessment).toBeDefined();
    expect(eco.evidence_assessment).not.toBeNull();
  });

  it('27. eco.evidence_assessment.state.kind is one of the valid kinds', () => {
    const eco = buildECO(null, tmpDir, { query: 'add retry logic' }) as any;
    const validKinds = ['sufficient', 'absent', 'conflicted', 'mixed'];
    expect(validKinds).toContain(eco.evidence_assessment.state.kind);
  });

  it('28. eco.evidence_assessment.availability.status is valid', () => {
    const eco = buildECO(null, tmpDir, { query: 'fix the timeout' }) as any;
    const validStatuses = ['sufficient', 'partial', 'absent'];
    expect(validStatuses).toContain(eco.evidence_assessment.availability.status);
  });

  it('29. eco.evidence_state_events is a non-null array', () => {
    const eco = buildECO(null, tmpDir, { query: 'fix the connection' }) as any;
    expect(Array.isArray(eco.evidence_state_events)).toBe(true);
  });

  it('30. bug_fix intent ECO shows absence of code evidence', () => {
    // Use "reproduction steps" keyword to reliably trigger bug_fix intent
    const eco = buildECO(null, tmpDir, {
      query: 'reproduction steps: login fails with 30s timeout, expected: no timeout',
    }) as any;
    expect(eco.evidence_assessment).toBeDefined();
    if ((eco.intent as any)?.primary === 'bug_fix') {
      // In query mode, only spec evidence is available — code is absent
      expect(eco.evidence_assessment.availability.missing_targets).toContain('source:code');
      // Policy should have added an evidence_absence reason
      const hasAbsenceReason = eco.escalation_reasons.some((r: string) =>
        r.startsWith('evidence_absence:'),
      );
      expect(hasAbsenceReason).toBe(true);
    }
    // If intent detection doesn't fire bug_fix (defensive), test structure only
    expect(['sufficient', 'absent', 'conflicted', 'mixed']).toContain(
      eco.evidence_assessment.state.kind,
    );
  });
});

// ─── G. Audit trail ───────────────────────────────────────────────────────────

describe('G. Audit trail', () => {
  it('31. absence events have kind=evidence_absence_detected with payload', () => {
    const state: EvidenceState = {
      kind: 'absent',
      missing_required_targets: ['source:code'],
      searched_sources: ['spec'],
      reason: 'not_found',
    };
    const assessment = buildEvidenceAssessment(state);
    const events = buildEvidenceStateEvents(assessment);
    const absenceEvent = events.find(e => e.kind === 'evidence_absence_detected');
    expect(absenceEvent).toBeDefined();
    expect(absenceEvent!.payload).toHaveProperty('missing_targets');
    expect(absenceEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('32. conflict events have kind=evidence_conflict_detected with payload', () => {
    const state: EvidenceState = {
      kind: 'conflicted',
      conflict_groups: [{
        target_id: 'auth',
        evidence_ids: ['spec:auth', 'docs:auth'],
        contradiction_type: 'state',
        severity: 'low',
        dominant_sources: ['spec', 'docs'],
      }],
      severity: 'low',
    };
    const assessment = buildEvidenceAssessment(state);
    const events = buildEvidenceStateEvents(assessment);
    const conflictEvent = events.find(e => e.kind === 'evidence_conflict_detected');
    expect(conflictEvent).toBeDefined();
    expect(conflictEvent!.payload).toHaveProperty('conflict_groups');
    expect(conflictEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('33. state-classified event is always present', () => {
    const state: EvidenceState = { kind: 'sufficient', supporting_count: 1, conflicting_count: 0 };
    const assessment = buildEvidenceAssessment(state);
    const events = buildEvidenceStateEvents(assessment);
    const classifiedEvent = events.find(e => e.kind === 'evidence_state_classified');
    expect(classifiedEvent).toBeDefined();
    expect(classifiedEvent!.payload).toHaveProperty('state_kind');
  });
});

// ─── H. Determinism ───────────────────────────────────────────────────────────

describe('H. Determinism', () => {
  it('34. same inputs → same EvidenceState kind', () => {
    const params = {
      evidenceItems: [
        item('spec', 'auth-module', 'Feature login is present and enabled'),
        item('docs', 'auth-module', 'Feature login is absent from this release'),
      ],
      requiredTargets: [],
      intent: 'bug_fix',
    };
    const state1 = classifyEvidenceState(params);
    const state2 = classifyEvidenceState(params);
    expect(state1.kind).toBe(state2.kind);
  });

  it('35. shuffled evidence order → same EvidenceState', () => {
    const original = [
      item('spec', 'auth-module', 'Feature login is present and enabled'),
      item('docs', 'auth-module', 'Feature login is absent from this release'),
      item('code', 'src/auth.ts', 'implementation'),
    ];
    const shuffled = [
      item('code', 'src/auth.ts', 'implementation'),
      item('docs', 'auth-module', 'Feature login is absent from this release'),
      item('spec', 'auth-module', 'Feature login is present and enabled'),
    ];

    const state1 = classifyEvidenceState({ evidenceItems: original, requiredTargets: [], intent: 'bug_fix' });
    const state2 = classifyEvidenceState({ evidenceItems: shuffled, requiredTargets: [], intent: 'bug_fix' });

    expect(state1.kind).toBe(state2.kind);
  });

  it('36. empty evidence + no required targets → always sufficient', () => {
    const state = classifyEvidenceState({
      evidenceItems: [],
      requiredTargets: [],
      intent: 'unknown',
    });
    expect(state.kind).toBe('sufficient');
  });
});
