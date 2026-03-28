/**
 * Runtime Reporting — Optimisation Rules Engine
 *
 * Deterministic rule-based optimisation hints derived from a RunEvidenceBundle.
 * Rules are observations, not root cause certainties.
 * All hints are explicitly marked as rule-based inference.
 *
 * Design constraints:
 *   - No LLMs — deterministic rules only
 *   - Hints are suggestions, not diagnoses
 *   - Each rule has a stable rule_id for tracking
 *   - hint_confidence reflects rule signal strength, not causal certainty
 *   - Rules are additive: multiple rules may fire on the same bundle
 */

import { RunEvidenceBundle, OptimisationHint, FailureRecord } from './types.js';
import { randomUUID } from 'crypto';

export function generateOptimisationHints(bundle: RunEvidenceBundle): OptimisationHint[] {
  const hints: OptimisationHint[] = [];
  const run_id_prefix = bundle.run_id.slice(0, 8);

  // ── OPT-001: Evidence absence dominates failures ───────────────────────────
  {
    const matchingFailures = bundle.failures.filter(f => f.code === 'EVIDENCE_ABSENT');
    const count = Math.max(
      matchingFailures.length,
      bundle.knowledge_health.absent_evidence.length,
    );
    if (matchingFailures.length >= 1 || bundle.knowledge_health.absent_evidence.length >= 1) {
      hints.push({
        hint_id: `hint_OPT-001_${run_id_prefix}`,
        rule_id: 'OPT-001',
        observation: 'Evidence absence is the primary failure pattern in this run',
        evidence_basis: `${count} EVIDENCE_ABSENT failure(s) detected`,
        hint_confidence: 'high',
        subsystem: 'knowledge-retrieval / index-freshness',
        supporting_event_ids: matchingFailures.map(f => f.source_event_id),
      });
    }
  }

  // ── OPT-002: Conflicting evidence dominates ────────────────────────────────
  {
    const matchingFailures = bundle.failures.filter(f => f.code === 'EVIDENCE_CONFLICT');
    const count = Math.max(
      matchingFailures.length,
      bundle.knowledge_health.conflicting_evidence.length,
    );
    if (matchingFailures.length >= 1 || bundle.knowledge_health.conflicting_evidence.length >= 1) {
      hints.push({
        hint_id: `hint_OPT-002_${run_id_prefix}`,
        rule_id: 'OPT-002',
        observation:
          'Conflicting evidence requires semantic resolution before this scope can proceed reliably',
        evidence_basis: `${count} EVIDENCE_CONFLICT record(s) detected`,
        hint_confidence: 'high',
        subsystem: 'knowledge-semantic / conflict-resolver',
        supporting_event_ids: matchingFailures.map(f => f.source_event_id),
      });
    }
  }

  // ── OPT-003: Override dependency ──────────────────────────────────────────
  {
    const overrideEvents = bundle.raw_events.filter(e => e.kind === 'override');
    const count = overrideEvents.length;
    if (count >= 1) {
      hints.push({
        hint_id: `hint_OPT-003_${run_id_prefix}`,
        rule_id: 'OPT-003',
        observation:
          'Execution is override-dependent — policy gates would have blocked without manual override',
        evidence_basis: `${count} override(s) applied during this run`,
        hint_confidence: 'medium',
        subsystem: 'governance / policy-thresholds',
        supporting_event_ids: overrideEvents.map(e => e.event_id),
      });
    }
  }

  // ── OPT-004: Low confidence success ───────────────────────────────────────
  {
    const confidence = bundle.confidence.overall_confidence;
    const band = bundle.confidence.band;
    if (confidence < 60 && bundle.summary.final_status === 'success') {
      const checkpointEventIds = bundle.raw_events
        .filter(e => e.kind === 'confidence_checkpoint')
        .map(e => e.event_id);
      hints.push({
        hint_id: `hint_OPT-004_${run_id_prefix}`,
        rule_id: 'OPT-004',
        observation: `Run succeeded at low confidence (${confidence}). Results may not be reliable.`,
        evidence_basis: `Overall confidence: ${confidence}, band: ${band}`,
        hint_confidence: 'high',
        subsystem: 'confidence-model / evidence-quality',
        supporting_event_ids: checkpointEventIds,
      });
    }
  }

  // ── OPT-005: Stale evidence in scope ──────────────────────────────────────
  {
    const matchingFailures = bundle.failures.filter(f => f.code === 'EVIDENCE_STALE_RELEVANT');
    const staleCount = bundle.knowledge_health.stale_evidence.length;
    const count = Math.max(matchingFailures.length, staleCount);
    if (staleCount >= 1 || matchingFailures.length >= 1) {
      hints.push({
        hint_id: `hint_OPT-005_${run_id_prefix}`,
        rule_id: 'OPT-005',
        observation:
          'Stale evidence contributed to this run. Index freshness may be limiting scope accuracy.',
        evidence_basis: `${count} stale evidence item(s) in scope`,
        hint_confidence: 'medium',
        subsystem: 'knowledge-freshness / indexing',
        supporting_event_ids: matchingFailures.map(f => f.source_event_id),
      });
    }
  }

  // ── OPT-006: Graph completeness weakness ──────────────────────────────────
  {
    const matchingFailures = bundle.failures.filter(
      f => f.code === 'EVIDENCE_GRAPH_INCOMPLETE',
    );
    const graphStatus = bundle.knowledge_health.dimension_statuses['graph'];
    const graphDegraded =
      graphStatus === 'warn' || graphStatus === 'block' || graphStatus === 'escalate';
    if (matchingFailures.length >= 1 || graphDegraded) {
      hints.push({
        hint_id: `hint_OPT-006_${run_id_prefix}`,
        rule_id: 'OPT-006',
        observation:
          'Graph completeness is limiting evidence coverage. Parse quality or scope binding may need review.',
        evidence_basis: `EVIDENCE_GRAPH_INCOMPLETE detected or graph dimension status degraded`,
        hint_confidence: 'medium',
        subsystem: 'knowledge-graph / parser',
        supporting_event_ids: matchingFailures.map(f => f.source_event_id),
      });
    }
  }

  // ── OPT-007: Weak mapping quality ─────────────────────────────────────────
  {
    const matchingFailures = bundle.failures.filter(f => f.code === 'EVIDENCE_MAPPING_WEAK');
    const weakCount = bundle.knowledge_health.weak_evidence.length;
    const count = weakCount;
    if (matchingFailures.length >= 1 || weakCount >= 2) {
      hints.push({
        hint_id: `hint_OPT-007_${run_id_prefix}`,
        rule_id: 'OPT-007',
        observation: 'Symbol-to-scope mapping quality is weak. Scope binding accuracy is reduced.',
        evidence_basis: `EVIDENCE_MAPPING_WEAK detected or ${count} weak evidence items`,
        hint_confidence: 'medium',
        subsystem: 'knowledge-mapping / scope-classifier',
        supporting_event_ids: matchingFailures.map(f => f.source_event_id),
      });
    }
  }

  // ── OPT-008: Policy confidence block ──────────────────────────────────────
  {
    const matchingFailures = bundle.failures.filter(f => f.code === 'POLICY_CONFIDENCE_BLOCK');
    if (matchingFailures.length >= 1) {
      const stage = matchingFailures[0].stage ?? 'unknown';
      hints.push({
        hint_id: `hint_OPT-008_${run_id_prefix}`,
        rule_id: 'OPT-008',
        observation:
          'Confidence fell below policy threshold. Inspect which dimension penalised confidence most.',
        evidence_basis: `POLICY_CONFIDENCE_BLOCK triggered at stage ${stage}`,
        hint_confidence: 'high',
        subsystem: 'policy / confidence-model',
        supporting_event_ids: matchingFailures.map(f => f.source_event_id),
      });
    }
  }

  // ── OPT-009: Report integrity degraded ────────────────────────────────────
  {
    if (bundle.integrity.valid === false && bundle.integrity.issues.length > 0) {
      const count = bundle.integrity.issues.length;
      const issueKinds = [...new Set(bundle.integrity.issues.map(i => i.kind))];
      hints.push({
        hint_id: `hint_OPT-009_${run_id_prefix}`,
        rule_id: 'OPT-009',
        observation:
          'Report integrity validation failed. Some conclusions in this report may be incomplete.',
        evidence_basis: `${count} integrity issue(s): ${issueKinds.join(', ')}`,
        hint_confidence: 'high',
        subsystem: 'reporting / ledger-completeness',
        supporting_event_ids: [],
      });
    }
  }

  return hints;
}
