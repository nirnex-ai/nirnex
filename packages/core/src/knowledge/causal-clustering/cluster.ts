/**
 * Causal Clustering — Clustering Engine
 *
 * Consumes RawCausalSignal[] and produces CausalClusterResult.
 *
 * Pipeline:
 *   1. Assign fingerprints to all signals (via fingerprints.ts)
 *   2. Group signals by fingerprint
 *   3. Groups with 2+ signals → form a CausalCluster
 *   4. Groups with 1 signal → go to unclustered_signals
 *   5. For each cluster: select primary via rules.ts, mark others as derived
 *   6. Build suppression_index for every signal
 *   7. Return CausalClusterResult
 *
 * Also contains buildRawCausalSignals() — the function that maps DimensionSignals
 * into RawCausalSignal[] before clustering runs. This is the canonical
 * signal-emission boundary between the dimension layer and the clustering layer.
 *
 * Design constraints:
 *   - Pure function — no side effects, no I/O
 *   - Deterministic: same inputs → same outputs regardless of array ordering
 *   - Clusters only form when 2+ signals share a fingerprint
 *   - Single-member fingerprint groups are never promoted to clusters (no false precision)
 *   - Signal visibility is preserved: derived signals remain in all outputs
 */

import type {
  RawCausalSignal,
  CausalCluster,
  CausalClusterResult,
  SuppressionRecord,
  CausalDimension,
  FingerprintFamily,
  SignalSeverityCandidate,
} from './types.js';
import type { DimensionSignals } from '../dimensions/types.js';
import { assignFingerprints } from './fingerprints.js';
import {
  selectPrimarySignalId,
  computeSeverityCeiling,
  SUPPRESSION_RULES,
} from './rules.js';

// ─── buildRawCausalSignals ────────────────────────────────────────────────────

/**
 * Convert DimensionSignals into RawCausalSignal[].
 *
 * This is the canonical signal-emission boundary. Each dimension produces
 * signals that reflect the conditions it observes. When a stale index is
 * present, mapping and graph signals also receive STALE_INDEX_SCOPE_MISMATCH
 * as their primary cause hint — enabling clustering with the freshness signal.
 *
 * A dimension may emit MULTIPLE signals for INDEPENDENT causes (e.g., mapping
 * emits both a stale-attributed signal AND an independent scatter signal).
 * Only same-fingerprint signals cluster together; different fingerprints
 * are always independent.
 */
export function buildRawCausalSignals(signals: DimensionSignals): RawCausalSignal[] {
  const result: RawCausalSignal[] = [];
  const scopeIds = signals.scopeIds.length > 0 ? signals.scopeIds : ['<global>'];

  const freshnessImpact = signals.freshnessImpact;
  const isStaleImpacted =
    freshnessImpact !== null &&
    freshnessImpact !== undefined &&
    freshnessImpact.isStale &&
    freshnessImpact.severity !== 'none';

  const staleScopes: string[] =
    isStaleImpacted && freshnessImpact!.impactedScopeIds.length > 0
      ? freshnessImpact!.impactedScopeIds
      : scopeIds;

  // ── Freshness ──────────────────────────────────────────────────────────────
  if (isStaleImpacted && freshnessImpact) {
    result.push({
      signal_id:          `freshness::stale::${staleScopes.sort().join('+')}`,
      dimension:          'freshness',
      signal_type:        'stale_scope',
      severity_candidate: freshnessImpact.severity as SignalSeverityCandidate,
      source_stage:       'freshness',
      scope_refs:         staleScopes,
      entity_refs:        [],
      path_refs:          freshnessImpact.impactedFiles,
      commit_ref:         undefined,
      dependency_refs:    [],
      evidence_refs:      [],
      cause_hints:        ['STALE_INDEX_SCOPE_MISMATCH'],
      fingerprint:        '',
      metadata: {
        impactRatio:            freshnessImpact.impactRatio,
        intersectedScopeCount:  freshnessImpact.intersectedScopeCount,
        staleScopeCount:        freshnessImpact.staleScopeCount,
      },
    });
  }

  // ── Coverage ───────────────────────────────────────────────────────────────
  const missingEvidence = signals.requiredEvidenceClasses.filter(
    c => !signals.retrievedEvidenceClasses.includes(c),
  );
  if (missingEvidence.length > 0 || signals.matchedScopeCount === 0) {
    const hasNoScope = signals.matchedScopeCount === 0 && signals.requestedScopeCount > 0;
    const sevCandidate: SignalSeverityCandidate =
      hasNoScope || missingEvidence.length >= signals.requiredEvidenceClasses.length
        ? 'block'
        : missingEvidence.length > 0
          ? 'escalate'
          : 'warn';

    result.push({
      signal_id:          `coverage::missing_evidence::${scopeIds.sort().join('+')}`,
      dimension:          'coverage',
      signal_type:        'missing_required_evidence',
      severity_candidate: sevCandidate,
      source_stage:       'coverage',
      scope_refs:         scopeIds,
      entity_refs:        missingEvidence,
      path_refs:          [],
      commit_ref:         undefined,
      dependency_refs:    [],
      evidence_refs:      [],
      cause_hints:        ['MISSING_REQUIRED_EVIDENCE'],
      fingerprint:        '',
      metadata: {
        missingEvidenceClasses: missingEvidence,
        matchedScopeCount:      signals.matchedScopeCount,
        requestedScopeCount:    signals.requestedScopeCount,
      },
    });
  }

  // ── Mapping ────────────────────────────────────────────────────────────────
  const hasRealMappingProblem =
    signals.mappingPattern === '1:scattered' ||
    signals.mappingPattern === 'ambiguous' ||
    (signals.mappingPattern === 'unknown' && signals.primaryCandidateScore === 0) ||
    signals.primaryCandidateScore < 0.4;

  if (hasRealMappingProblem) {
    // Stale-attributed mapping signal (clusters with freshness if stale)
    if (isStaleImpacted) {
      result.push({
        signal_id:          `mapping::stale::${staleScopes.sort().join('+')}`,
        dimension:          'mapping',
        signal_type:        'stale_attributed_mapping_problem',
        severity_candidate: freshnessImpact!.severity as SignalSeverityCandidate,
        source_stage:       'mapping',
        scope_refs:         staleScopes,
        entity_refs:        [],
        path_refs:          [],
        commit_ref:         undefined,
        dependency_refs:    [],
        evidence_refs:      [],
        cause_hints:        ['STALE_INDEX_SCOPE_MISMATCH'],
        fingerprint:        '',
        metadata: {
          mappingPattern:      signals.mappingPattern,
          primaryCandidateScore: signals.primaryCandidateScore,
          attributedToStale:   true,
        },
      });
    }

    // Independent mapping signal (real structural problem, not stale-only)
    // Only emit for patterns that indicate structural issues regardless of freshness
    const isStructuralMappingIssue =
      signals.mappingPattern === '1:scattered' ||
      (signals.disconnectedClusterCount > 2 && signals.primaryCandidateScore < 0.3);

    if (isStructuralMappingIssue) {
      const mapSevCandidate: SignalSeverityCandidate =
        signals.mappingPattern === '1:scattered' ? 'escalate' : 'warn';

      result.push({
        signal_id:          `mapping::unresolved::${scopeIds.sort().join('+')}`,
        dimension:          'mapping',
        signal_type:        'unresolved_mapping_chain',
        severity_candidate: mapSevCandidate,
        source_stage:       'mapping',
        scope_refs:         scopeIds,
        entity_refs:        [],
        path_refs:          [],
        commit_ref:         undefined,
        dependency_refs:    [],
        evidence_refs:      [],
        cause_hints:        ['UNRESOLVED_MAPPING_CHAIN'],
        fingerprint:        '',
        metadata: {
          mappingPattern:           signals.mappingPattern,
          primaryCandidateScore:    signals.primaryCandidateScore,
          disconnectedClusterCount: signals.disconnectedClusterCount,
          isStructuralBreak:        true,
        },
      });
    }
  }

  // ── Graph completeness ─────────────────────────────────────────────────────
  const hasGraphProblem =
    signals.parseFailureCount > 0 ||
    signals.criticalNodesMissing > 0 ||
    (signals.brokenSymbolCount > 0 && signals.totalSymbolCount > 0 &&
     signals.brokenSymbolCount / signals.totalSymbolCount > 0.2);

  if (hasGraphProblem) {
    const isHardGraphBreak = signals.criticalNodesMissing > 0;
    const graphSevCandidate: SignalSeverityCandidate =
      isHardGraphBreak ? 'block' :
      signals.parseFailureCount >= 3 ? 'block' :
      signals.parseFailureCount >= 2 ? 'escalate' :
      'warn';

    // Stale-attributed graph signal (clusters with freshness if stale)
    if (isStaleImpacted && !isHardGraphBreak) {
      result.push({
        signal_id:          `graph::stale::${staleScopes.sort().join('+')}`,
        dimension:          'graph_completeness',
        signal_type:        'stale_attributed_graph_problem',
        severity_candidate: freshnessImpact!.severity as SignalSeverityCandidate,
        source_stage:       'graph',
        scope_refs:         staleScopes,
        entity_refs:        [],
        path_refs:          [],
        commit_ref:         undefined,
        dependency_refs:    [],
        evidence_refs:      [],
        cause_hints:        ['STALE_INDEX_SCOPE_MISMATCH'],
        fingerprint:        '',
        metadata: {
          parseFailureCount:  signals.parseFailureCount,
          brokenSymbolCount:  signals.brokenSymbolCount,
          attributedToStale:  true,
        },
      });
    }

    // Independent graph structural break (critical nodes, high parse failure, not stale)
    if (isHardGraphBreak || (!isStaleImpacted && signals.parseFailureCount > 0)) {
      result.push({
        signal_id:          `graph::structural_break::${scopeIds.sort().join('+')}`,
        dimension:          'graph_completeness',
        signal_type:        isHardGraphBreak ? 'critical_nodes_missing' : 'parse_failure',
        severity_candidate: graphSevCandidate,
        source_stage:       'graph',
        scope_refs:         scopeIds,
        entity_refs:        [],
        path_refs:          [],
        commit_ref:         undefined,
        dependency_refs:    [],
        evidence_refs:      [],
        cause_hints:        [isHardGraphBreak ? 'MISSING_SYMBOL_GRAPH_FOR_SCOPE' : 'STRUCTURAL_GRAPH_BREAK'] as FingerprintFamily[],
        fingerprint:        '',
        metadata: {
          parseFailureCount:    signals.parseFailureCount,
          criticalNodesMissing: signals.criticalNodesMissing,
          brokenSymbolCount:    signals.brokenSymbolCount,
        },
      });
    }
  }

  // ── Conflict ───────────────────────────────────────────────────────────────
  const blockConflicts = signals.conflicts.filter(c => c.severity === 'block' || c.severity === 'high');
  if (blockConflicts.length > 0) {
    // Conflict signals are independent per conflict-set — use conflict IDs as scope
    const conflictIds = blockConflicts.map(c => c.id).sort();
    result.push({
      signal_id:          `conflict::evidence_set::${conflictIds.join('+')}`,
      dimension:          'conflict',
      signal_type:        'conflicting_evidence_set',
      severity_candidate: blockConflicts.some(c => c.severity === 'block') ? 'block' : 'escalate',
      source_stage:       'conflict',
      scope_refs:         scopeIds,
      entity_refs:        conflictIds,
      path_refs:          [],
      commit_ref:         undefined,
      dependency_refs:    [],
      evidence_refs:      [],
      cause_hints:        ['CONFLICTING_EVIDENCE_SET'],
      fingerprint:        '',
      metadata: {
        conflictCount:       blockConflicts.length,
        conflictIds,
      },
    });
  }

  return result;
}

// ─── clusterCausalSignals ─────────────────────────────────────────────────────

/**
 * The main clustering engine.
 *
 * Takes a pre-built array of RawCausalSignals, assigns fingerprints,
 * groups by fingerprint, and builds CausalClusterResult.
 *
 * Signals with a unique fingerprint (no partner) go to unclustered_signals.
 * Every input signal has exactly one entry in suppression_index.
 *
 * @param rawSignals - signals to cluster (fingerprints may be empty strings)
 * @returns          complete CausalClusterResult
 */
export function clusterCausalSignals(rawSignals: RawCausalSignal[]): CausalClusterResult {
  if (rawSignals.length === 0) {
    return {
      clusters: [],
      all_signals: [],
      unclustered_signals: [],
      suppression_index: {},
      cluster_summary: {
        total_signals: 0,
        total_clusters: 0,
        suppressed_signal_count: 0,
        primary_signal_count: 0,
      },
    };
  }

  // ── Step 1: Assign fingerprints ───────────────────────────────────────────
  const signals = assignFingerprints(rawSignals.map(s => ({ ...s }))); // shallow copy

  // ── Step 2: Group by fingerprint ──────────────────────────────────────────
  const groups = new Map<string, RawCausalSignal[]>();
  for (const signal of signals) {
    const existing = groups.get(signal.fingerprint);
    if (existing) {
      existing.push(signal);
    } else {
      groups.set(signal.fingerprint, [signal]);
    }
  }

  // ── Step 3: Build clusters (2+ members) and unclustered list ──────────────
  const clusters: CausalCluster[] = [];
  const unclustered: RawCausalSignal[] = [];
  const suppressionIndex: Record<string, SuppressionRecord> = {};

  let clusterCounter = 0;

  for (const [fingerprint, members] of groups) {
    if (members.length < 2) {
      // Single-member group → unclustered (independent)
      const sig = members[0]!;
      unclustered.push(sig);
      suppressionIndex[sig.signal_id] = {
        signal_id: sig.signal_id,
        status: 'independent',
        cluster_id: null,
        suppressed_by_signal_id: null,
      };
      continue;
    }

    // ── Form a cluster ──────────────────────────────────────────────────────
    clusterCounter++;
    const clusterId = `cluster_${clusterCounter}`;

    const primarySignalId = selectPrimarySignalId(members);
    const severityCeiling = computeSeverityCeiling(members);

    // Collect affected dimensions (unique)
    const affectedDimensions: CausalDimension[] = [
      ...new Set(members.map(m => m.dimension)),
    ];

    // Collect scope refs (union, sorted)
    const allScopeRefs: string[] = [
      ...new Set(members.flatMap(m => m.scope_refs)),
    ].sort();

    // Extract root cause type from fingerprint (first cause hint of any member)
    const rootCauseType = (members[0]!.cause_hints[0] ?? 'STRUCTURAL_GRAPH_BREAK') as FingerprintFamily;

    const cluster: CausalCluster = {
      cluster_id:        clusterId,
      root_cause_type:   rootCauseType,
      fingerprint,
      primary_signal_id: primarySignalId,
      member_signal_ids: members.map(m => m.signal_id),
      affected_dimensions: affectedDimensions,
      scope_refs:        allScopeRefs,
      severity_ceiling:  severityCeiling,
      suppression_rule:  SUPPRESSION_RULES.SHARED_ROOT_CAUSE_MULTI_DIMENSION,
      explanation: buildClusterExplanation(rootCauseType, affectedDimensions, allScopeRefs),
    };

    clusters.push(cluster);

    // ── Build suppression records for each member ───────────────────────────
    for (const member of members) {
      const isPrimary = member.signal_id === primarySignalId;
      suppressionIndex[member.signal_id] = {
        signal_id: member.signal_id,
        status: isPrimary ? 'primary' : 'suppressed_by_cluster',
        cluster_id: clusterId,
        suppressed_by_signal_id: isPrimary ? null : primarySignalId,
      };
    }
  }

  // ── Step 4: Build cluster_summary ─────────────────────────────────────────
  const suppressedCount = Object.values(suppressionIndex).filter(
    r => r.status === 'suppressed_by_cluster',
  ).length;
  const primaryCount = Object.values(suppressionIndex).filter(
    r => r.status === 'primary',
  ).length;

  return {
    clusters,
    all_signals: signals,
    unclustered_signals: unclustered,
    suppression_index: suppressionIndex,
    cluster_summary: {
      total_signals:         signals.length,
      total_clusters:        clusters.length,
      suppressed_signal_count: suppressedCount,
      primary_signal_count:  primaryCount,
    },
  };
}

// ─── buildClusterExplanation ──────────────────────────────────────────────────

function buildClusterExplanation(
  rootCause: FingerprintFamily,
  dimensions: CausalDimension[],
  scopes: string[],
): string {
  const scopeLabel = scopes.length > 0 ? scopes.slice(0, 3).join(', ') : '(global)';
  const dimLabel = dimensions.join(', ');

  switch (rootCause) {
    case 'STALE_INDEX_SCOPE_MISMATCH':
      return `Stale index for scope [${scopeLabel}] propagated signals across dimensions: ${dimLabel}. Single root cause — only one full severity contribution applied.`;
    case 'MISSING_SYMBOL_GRAPH_FOR_SCOPE':
      return `Symbol graph absent for scope [${scopeLabel}] — signals across ${dimLabel} share this root cause.`;
    case 'MISSING_REQUIRED_EVIDENCE':
      return `Required evidence absent for scope [${scopeLabel}] — affected dimensions: ${dimLabel}.`;
    case 'UNRESOLVED_MAPPING_CHAIN':
      return `Mapping chain cannot be resolved for scope [${scopeLabel}] — affected dimensions: ${dimLabel}.`;
    case 'STRUCTURAL_GRAPH_BREAK':
      return `Structural graph failure in scope [${scopeLabel}] — affected dimensions: ${dimLabel}.`;
    case 'CONFLICTING_EVIDENCE_SET':
      return `Conflicting evidence in scope [${scopeLabel}] — affected dimensions: ${dimLabel}.`;
    default:
      return `Shared root cause across dimensions: ${dimLabel} for scope [${scopeLabel}].`;
  }
}
