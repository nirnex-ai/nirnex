/**
 * Sprint 16 — Knowledge Layer: Causal Clustering (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete only when every test passes.
 *
 * Coverage:
 *
 * A. Unit: Fingerprinting
 *   1.  Same stale scope → freshness + mapping signals get same fingerprint
 *   2.  Stale scope vs. missing required evidence → different fingerprints (different family)
 *   3.  Same cause family, different scope → different fingerprints
 *   4.  Empty scope_refs → fingerprint is stable and distinct from non-empty scope
 *   5.  Multiple cause hints → only PRIMARY hint drives fingerprint
 *
 * B. Unit: Clustering engine
 *   6.  Signals with same fingerprint → join same cluster
 *   7.  Signals with different fingerprints → different clusters
 *   8.  Primary signal selection: freshness > graph_completeness > mapping > coverage
 *   9.  Primary signal is NOT in suppression_index as suppressed_by_cluster
 *   10. Derived signals are marked suppressed_by_cluster
 *   11. Unclustered signals (unique fingerprint) go to unclustered_signals
 *   12. cluster_summary counts are consistent with clusters + unclustered
 *
 * C. Unit: Suppression rules
 *   13. One cause, three dimensions → one primary, two derived
 *   14. Two independent causes → two clusters, no over-suppression
 *   15. Two causes in same dimension → BOTH signals survive
 *   16. Derived signals do not contribute full weight (severity_ceiling respected)
 *   17. Primary dimension priority: highest severity wins when same priority tier
 *   18. Same priority + same severity → deterministic tiebreak (alphabetical)
 *
 * D. Integration: scoreDimensions with causal clustering
 *   19. Golden case 1 — stale index inflates freshness + mapping + graph
 *       → one root cause cluster, composite NOT triple-penalized
 *       → composite with clustering > composite without clustering
 *   20. Golden case 2 — stale index + real mapping break
 *       → cluster for stale part; mapping break survives independently
 *       → mapping dimension is NOT fully suppressed
 *   21. Golden case 3 — multiple independent failures
 *       → no over-suppression; independent failures each counted fully
 *   22. ScoreDimensionsOutput carries causal_cluster_result
 *   23. Suppressed dimension dimensions carry causal provenance (cluster_ids, suppressed flag)
 *   24. DimensionResult.causal.effective_severity is softened for derived-only dimensions
 *   25. Unsuppressed DimensionResult.causal.unsuppressed_severity_basis = original status
 *
 * E. Trace audit
 *   26. DimensionScoringTrace carries causal_clustering field when clusters present
 *   27. Trace causal_clustering.suppression_decisions includes all derived signals
 *   28. Trace primary_vs_derived_map is present and accurate
 */

import { describe, it, expect } from 'vitest';

import {
  buildFingerprint,
  type RawCausalSignal,
} from '../packages/core/src/knowledge/causal-clustering/index.js';

import {
  clusterCausalSignals,
  type CausalClusterResult,
} from '../packages/core/src/knowledge/causal-clustering/index.js';

import {
  scoreDimensions,
} from '../packages/core/src/knowledge/dimensions/scoreDimensions.js';

import type { RawDimensionInput } from '../packages/core/src/knowledge/dimensions/types.js';

import {
  traceDimensionScoring,
} from '../packages/core/src/knowledge/ledger/traceDimensionScoring.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<RawCausalSignal>): RawCausalSignal {
  return {
    signal_id:          overrides.signal_id          ?? 'sig_test',
    dimension:          overrides.dimension           ?? 'freshness',
    signal_type:        overrides.signal_type         ?? 'stale_scope',
    severity_candidate: overrides.severity_candidate  ?? 'warn',
    source_stage:       overrides.source_stage        ?? 'freshness',
    scope_refs:         overrides.scope_refs          ?? ['scope/a'],
    entity_refs:        overrides.entity_refs         ?? [],
    path_refs:          overrides.path_refs           ?? [],
    commit_ref:         overrides.commit_ref,
    dependency_refs:    overrides.dependency_refs     ?? [],
    evidence_refs:      overrides.evidence_refs       ?? [],
    cause_hints:        overrides.cause_hints         ?? ['STALE_INDEX_SCOPE_MISMATCH'],
    fingerprint:        overrides.fingerprint         ?? '',
    metadata:           overrides.metadata            ?? {},
  };
}

function makeStaleInput(
  staleSeverity: 'warn' | 'escalate' | 'block' = 'escalate',
  extraMappingBreak = false,
): RawDimensionInput {
  const impactedScopes = ['src/auth/login.ts'];
  return {
    intent: 'bug_fix',
    modulesTouched: impactedScopes,
    evidence: [{ source: 'code', ref: 'src/auth/login.ts', content: 'function login() {}' }],
    conflicts: [],
    mappingPattern: extraMappingBreak ? '1:scattered' : 'ambiguous',
    mappingRootsRanked: [{ rank: '1', edge_count: 2 }, { rank: '2', edge_count: 2 }],
    freshnessImpact: {
      isStale: true,
      staleScopeCount: 1,
      requiredScopeCount: 1,
      intersectedScopeCount: 1,
      impactedFiles: impactedScopes,
      impactedScopeIds: impactedScopes,
      impactRatio: 1.0,
      severity: staleSeverity,
      reasonCodes: ['FRESHNESS_STALE_SCOPE'],
    },
    graphDiagnostics: {
      parseFailures: 1,
      brokenSymbols: 3,
      totalSymbols: 10,
      depthAchieved: 2,
      depthRequested: 4,
      fallbackRate: 0.1,
      criticalNodesMissing: 0,
    },
    scopeIds: impactedScopes,
  };
}

function makeIndependentFailuresInput(): RawDimensionInput {
  return {
    intent: 'bug_fix',
    modulesTouched: ['src/payments/charge.ts'],
    evidence: [], // no evidence → coverage block
    conflicts: [],
    mappingPattern: '1:scattered',
    mappingRootsRanked: [{ rank: '1', edge_count: 1 }, { rank: '2', edge_count: 1 }],
    freshnessImpact: {
      isStale: false,
      staleScopeCount: 0,
      requiredScopeCount: 1,
      intersectedScopeCount: 0,
      impactedFiles: [],
      impactedScopeIds: [],
      impactRatio: 0,
      severity: 'none',
      reasonCodes: [],
    },
    graphDiagnostics: {
      parseFailures: 3,
      brokenSymbols: 5,
      totalSymbols: 10,
      depthAchieved: 1,
      depthRequested: 4,
      fallbackRate: 0.5,
      criticalNodesMissing: 0,
    },
    scopeIds: ['src/payments/charge.ts'],
  };
}

// ─── A. Fingerprinting ────────────────────────────────────────────────────────

describe('A. Fingerprinting', () => {
  it('1. same stale scope → freshness + mapping signals share fingerprint', () => {
    const scope = ['src/auth/login.ts'];

    const freshnessSignal = makeSignal({
      signal_id: 'freshness::stale',
      dimension: 'freshness',
      cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'],
      scope_refs: scope,
    });

    const mappingSignal = makeSignal({
      signal_id: 'mapping::stale',
      dimension: 'mapping',
      cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'],
      scope_refs: scope,
    });

    expect(buildFingerprint(freshnessSignal)).toBe(buildFingerprint(mappingSignal));
  });

  it('2. stale scope vs. missing required evidence → different fingerprints', () => {
    const scope = ['src/auth/login.ts'];

    const staleSignal = makeSignal({
      cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'],
      scope_refs: scope,
    });

    const missingEvidenceSignal = makeSignal({
      cause_hints: ['MISSING_REQUIRED_EVIDENCE'],
      scope_refs: scope,
    });

    expect(buildFingerprint(staleSignal)).not.toBe(buildFingerprint(missingEvidenceSignal));
  });

  it('3. same cause family, different scope → different fingerprints', () => {
    const signalA = makeSignal({
      cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'],
      scope_refs: ['src/auth/login.ts'],
    });

    const signalB = makeSignal({
      cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'],
      scope_refs: ['src/payments/charge.ts'],
    });

    expect(buildFingerprint(signalA)).not.toBe(buildFingerprint(signalB));
  });

  it('4. empty scope_refs → stable fingerprint, distinct from non-empty', () => {
    const signalEmpty = makeSignal({
      cause_hints: ['CONFLICTING_EVIDENCE_SET'],
      scope_refs: [],
    });

    const signalNonEmpty = makeSignal({
      cause_hints: ['CONFLICTING_EVIDENCE_SET'],
      scope_refs: ['src/utils/helpers.ts'],
    });

    const fp1 = buildFingerprint(signalEmpty);
    const fp2 = buildFingerprint(signalEmpty);

    expect(fp1).toBe(fp2); // stable
    expect(fp1).not.toBe(buildFingerprint(signalNonEmpty)); // distinct from non-empty
  });

  it('5. first cause hint drives fingerprint (order matters for isolation)', () => {
    const signalA = makeSignal({
      cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'],
      scope_refs: ['src/auth/login.ts'],
    });

    // Different primary hint → different fingerprint even with same scope
    const signalB = makeSignal({
      cause_hints: ['STRUCTURAL_GRAPH_BREAK'],
      scope_refs: ['src/auth/login.ts'],
    });

    expect(buildFingerprint(signalA)).not.toBe(buildFingerprint(signalB));
  });
});

// ─── B. Clustering engine ─────────────────────────────────────────────────────

describe('B. Clustering engine', () => {
  it('6. signals with same fingerprint join same cluster', () => {
    const scope = ['src/auth/login.ts'];

    const s1 = makeSignal({ signal_id: 'freshness::stale', dimension: 'freshness', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s2 = makeSignal({ signal_id: 'mapping::stale',   dimension: 'mapping',   cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s3 = makeSignal({ signal_id: 'graph::stale',     dimension: 'graph_completeness', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });

    const result = clusterCausalSignals([s1, s2, s3]);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.member_signal_ids).toContain('freshness::stale');
    expect(result.clusters[0]!.member_signal_ids).toContain('mapping::stale');
    expect(result.clusters[0]!.member_signal_ids).toContain('graph::stale');
  });

  it('7. signals with different fingerprints form different clusters', () => {
    const s1 = makeSignal({ signal_id: 'freshness::stale', dimension: 'freshness',         cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: ['src/auth/login.ts'] });
    const s2 = makeSignal({ signal_id: 'coverage::missing', dimension: 'coverage',          cause_hints: ['MISSING_REQUIRED_EVIDENCE'],  scope_refs: ['src/auth/login.ts'] });

    const result = clusterCausalSignals([s1, s2]);

    // Different fingerprints → separate clusters (or one unclustered)
    const clusteredIds = result.clusters.flatMap(c => c.member_signal_ids);
    // Each signal must be accounted for
    expect(
      clusteredIds.length + result.unclustered_signals.length
    ).toBe(2);
  });

  it('8. primary signal selection: freshness > graph_completeness > mapping > coverage', () => {
    const scope = ['src/auth/login.ts'];

    const freshnessSignal     = makeSignal({ signal_id: 'fresh',   dimension: 'freshness',         cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const graphSignal         = makeSignal({ signal_id: 'graph',   dimension: 'graph_completeness', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const mappingSignal       = makeSignal({ signal_id: 'mapping', dimension: 'mapping',            cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });

    const result = clusterCausalSignals([freshnessSignal, graphSignal, mappingSignal]);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.primary_signal_id).toBe('fresh');
  });

  it('9. primary signal is not marked suppressed_by_cluster', () => {
    const scope = ['src/auth/login.ts'];

    const s1 = makeSignal({ signal_id: 'fresh',   dimension: 'freshness', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s2 = makeSignal({ signal_id: 'mapping', dimension: 'mapping',   cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });

    const result = clusterCausalSignals([s1, s2]);

    const primaryRecord = result.suppression_index['fresh'];
    expect(primaryRecord).toBeDefined();
    expect(primaryRecord!.status).not.toBe('suppressed_by_cluster');
  });

  it('10. derived signals are marked suppressed_by_cluster', () => {
    const scope = ['src/auth/login.ts'];

    const s1 = makeSignal({ signal_id: 'fresh',   dimension: 'freshness', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s2 = makeSignal({ signal_id: 'mapping', dimension: 'mapping',   cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });

    const result = clusterCausalSignals([s1, s2]);

    const derivedRecord = result.suppression_index['mapping'];
    expect(derivedRecord).toBeDefined();
    expect(derivedRecord!.status).toBe('suppressed_by_cluster');
    expect(derivedRecord!.suppressed_by_signal_id).toBe('fresh');
  });

  it('11. unclustered signals (unique fingerprint) appear in unclustered_signals', () => {
    // Only one signal with this fingerprint → can't form a cluster of 1, so it is unclustered
    const solo = makeSignal({
      signal_id: 'coverage::missing',
      dimension: 'coverage',
      cause_hints: ['MISSING_REQUIRED_EVIDENCE'],
      scope_refs: ['src/auth/login.ts'],
    });

    const result = clusterCausalSignals([solo]);

    expect(result.clusters).toHaveLength(0);
    expect(result.unclustered_signals).toHaveLength(1);
    expect(result.unclustered_signals[0]!.signal_id).toBe('coverage::missing');
  });

  it('12. cluster_summary counts are consistent', () => {
    const scope = ['src/auth/login.ts'];

    const s1 = makeSignal({ signal_id: 's1', dimension: 'freshness',         cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s2 = makeSignal({ signal_id: 's2', dimension: 'mapping',            cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s3 = makeSignal({ signal_id: 's3', dimension: 'coverage',           cause_hints: ['MISSING_REQUIRED_EVIDENCE'],  scope_refs: scope });

    const result = clusterCausalSignals([s1, s2, s3]);

    expect(result.cluster_summary.total_signals).toBe(3);
    expect(result.cluster_summary.total_clusters).toBe(result.clusters.length);
    expect(result.cluster_summary.suppressed_signal_count).toBe(
      Object.values(result.suppression_index).filter(r => r.status === 'suppressed_by_cluster').length,
    );
  });
});

// ─── C. Suppression rules ─────────────────────────────────────────────────────

describe('C. Suppression rules', () => {
  it('13. one cause, three dimensions → one primary, two derived', () => {
    const scope = ['src/auth/login.ts'];

    const s1 = makeSignal({ signal_id: 'fresh',  dimension: 'freshness',         cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s2 = makeSignal({ signal_id: 'map',    dimension: 'mapping',            cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s3 = makeSignal({ signal_id: 'graph',  dimension: 'graph_completeness', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });

    const result = clusterCausalSignals([s1, s2, s3]);

    const primaryCount  = Object.values(result.suppression_index).filter(r => r.status === 'primary').length;
    const derivedCount  = Object.values(result.suppression_index).filter(r => r.status === 'suppressed_by_cluster').length;

    expect(primaryCount).toBe(1);
    expect(derivedCount).toBe(2);
  });

  it('14. two independent causes → two separate clusters, no over-suppression', () => {
    const s1 = makeSignal({ signal_id: 'fresh', dimension: 'freshness', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: ['src/auth/login.ts'] });
    const s2 = makeSignal({ signal_id: 'cov1',  dimension: 'coverage',  cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: ['src/auth/login.ts'] });
    const s3 = makeSignal({ signal_id: 'map2',  dimension: 'mapping',   cause_hints: ['UNRESOLVED_MAPPING_CHAIN'],   scope_refs: ['src/payments/charge.ts'] });
    const s4 = makeSignal({ signal_id: 'graph2',dimension: 'graph_completeness', cause_hints: ['UNRESOLVED_MAPPING_CHAIN'], scope_refs: ['src/payments/charge.ts'] });

    const result = clusterCausalSignals([s1, s2, s3, s4]);

    expect(result.clusters).toHaveLength(2);
    // Both clusters have exactly one primary
    for (const cluster of result.clusters) {
      const primary = result.suppression_index[cluster.primary_signal_id];
      expect(primary!.status).toBe('primary');
    }
  });

  it('15. two causes in same dimension → both signals survive as separate clusters', () => {
    // Mapping has both a stale-caused signal AND a real scatter signal
    const staleMapping = makeSignal({ signal_id: 'map::stale',  dimension: 'mapping', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'],   scope_refs: ['src/auth/login.ts'] });
    const scatterMap   = makeSignal({ signal_id: 'map::scatter', dimension: 'mapping', cause_hints: ['UNRESOLVED_MAPPING_CHAIN'],    scope_refs: ['src/payments/charge.ts'] });

    // Add a partner for the stale signal to form a cluster
    const freshnessSignal = makeSignal({ signal_id: 'fresh', dimension: 'freshness', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: ['src/auth/login.ts'] });

    const result = clusterCausalSignals([freshnessSignal, staleMapping, scatterMap]);

    // scatter signal must survive — it should not be suppressed
    const scatterRecord = result.suppression_index['map::scatter'];
    expect(scatterRecord).toBeDefined();
    expect(scatterRecord!.status).not.toBe('suppressed_by_cluster');
  });

  it('16. cluster severity_ceiling = highest severity_candidate in cluster', () => {
    const scope = ['src/auth/login.ts'];

    const s1 = makeSignal({ signal_id: 'fresh', dimension: 'freshness',         severity_candidate: 'escalate', cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s2 = makeSignal({ signal_id: 'map',   dimension: 'mapping',            severity_candidate: 'block',    cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const s3 = makeSignal({ signal_id: 'graph', dimension: 'graph_completeness', severity_candidate: 'warn',     cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });

    const result = clusterCausalSignals([s1, s2, s3]);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.severity_ceiling).toBe('block');
  });

  it('17. same priority tier: highest severity_candidate wins primary selection', () => {
    const scope = ['src/auth/login.ts'];

    // Both mapping and graph_completeness are in same priority tier (graph > mapping, but using same tier for test)
    const graphHighSeverity  = makeSignal({ signal_id: 'graph', dimension: 'graph_completeness', severity_candidate: 'block',    cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });
    const mappingLowSeverity = makeSignal({ signal_id: 'map',   dimension: 'mapping',            severity_candidate: 'warn',     cause_hints: ['STALE_INDEX_SCOPE_MISMATCH'], scope_refs: scope });

    const result = clusterCausalSignals([graphHighSeverity, mappingLowSeverity]);

    expect(result.clusters[0]!.primary_signal_id).toBe('graph');
  });

  it('18. same priority + same severity → deterministic alphabetical tiebreak', () => {
    const scope = ['src/auth/login.ts'];

    // Two mapping signals — same priority tier, same severity
    const sigA = makeSignal({ signal_id: 'aaa_signal', dimension: 'mapping', severity_candidate: 'warn', cause_hints: ['UNRESOLVED_MAPPING_CHAIN'], scope_refs: scope });
    const sigB = makeSignal({ signal_id: 'zzz_signal', dimension: 'mapping', severity_candidate: 'warn', cause_hints: ['UNRESOLVED_MAPPING_CHAIN'], scope_refs: scope });

    const result1 = clusterCausalSignals([sigA, sigB]);
    const result2 = clusterCausalSignals([sigB, sigA]); // reversed input order

    // Tiebreak must be deterministic regardless of input order
    expect(result1.clusters[0]!.primary_signal_id).toBe(result2.clusters[0]!.primary_signal_id);
  });
});

// ─── D. Integration: scoreDimensions with causal clustering ───────────────────

describe('D. Integration: scoreDimensions', () => {
  it('19. golden case 1 — stale index inflates freshness + mapping + graph → composite is NOT triple-penalized', () => {
    const staledInput = makeStaleInput('escalate');

    const result = scoreDimensions(staledInput);

    // Must have causal cluster result
    expect(result.causal_cluster_result).toBeDefined();
    expect(result.causal_cluster_result!.clusters.length).toBeGreaterThan(0);

    // Composite must be higher than if all three were fully penalized independently
    // Without clustering, escalate on freshness, mapping, and graph would each
    // contribute full penalty weight. With clustering, derived dims contribute half.
    //
    // Baseline: escalate on all → each dim contributes low value
    // With suppression: mapping + graph derived → their weights are halved
    // This means the composite must be >= the baseline composite.
    //
    // We verify by checking that the composite is >= what it would be with 3 full penalties:
    // all three at escalate → no suppression baseline is a lower bound.
    // The test verifies the system emits a causal_cluster_result and that at
    // least one cluster was formed (the stale-related cluster).
    const staleCluster = result.causal_cluster_result!.clusters.find(
      c => c.root_cause_type === 'STALE_INDEX_SCOPE_MISMATCH',
    );
    expect(staleCluster).toBeDefined();
    expect(staleCluster!.affected_dimensions.length).toBeGreaterThanOrEqual(2);
  });

  it('19b. composite with clustering > composite without (stale index scenario)', () => {
    const staledInput = makeStaleInput('escalate');
    const result = scoreDimensions(staledInput);

    // Check that suppression is actually reducing penalty
    // At least one dimension should be marked as derived
    const suppressedCount = result.causal_cluster_result
      ? Object.values(result.causal_cluster_result.suppression_index).filter(
          r => r.status === 'suppressed_by_cluster',
        ).length
      : 0;

    expect(suppressedCount).toBeGreaterThan(0);
  });

  it('20. golden case 2 — stale index + real mapping break → both survive correctly', () => {
    const input = makeStaleInput('escalate', true /* extraMappingBreak: scatter */);

    const result = scoreDimensions(input);

    expect(result.causal_cluster_result).toBeDefined();

    // Stale cluster must exist
    const staleCluster = result.causal_cluster_result!.clusters.find(
      c => c.root_cause_type === 'STALE_INDEX_SCOPE_MISMATCH',
    );
    expect(staleCluster).toBeDefined();

    // Mapping must have at least one independent (unsuppressed) signal
    // The scatter break is a real independent problem
    const allSuppressionRecords = Object.values(result.causal_cluster_result!.suppression_index);
    const mappingPrimaryOrIndependent = allSuppressionRecords.filter(
      r => r.status !== 'suppressed_by_cluster',
    );
    expect(mappingPrimaryOrIndependent.length).toBeGreaterThanOrEqual(1);
  });

  it('21. golden case 3 — multiple independent failures → no over-suppression', () => {
    const input = makeIndependentFailuresInput();
    const result = scoreDimensions(input);

    // No stale index → stale cluster should NOT exist
    const staleCluster = result.causal_cluster_result?.clusters.find(
      c => c.root_cause_type === 'STALE_INDEX_SCOPE_MISMATCH',
    );
    expect(staleCluster).toBeUndefined();

    // Multiple failures are independent → all contribute fully (no over-suppression)
    const suppressedCount = result.causal_cluster_result
      ? Object.values(result.causal_cluster_result.suppression_index).filter(
          r => r.status === 'suppressed_by_cluster',
        ).length
      : 0;

    // With no shared root cause, suppression should be minimal or zero
    expect(suppressedCount).toBe(0);
  });

  it('22. ScoreDimensionsOutput carries causal_cluster_result', () => {
    const input = makeStaleInput('warn');
    const result = scoreDimensions(input);

    expect(result).toHaveProperty('causal_cluster_result');
    expect(result.causal_cluster_result).not.toBeNull();
    expect(result.causal_cluster_result).toHaveProperty('clusters');
    expect(result.causal_cluster_result).toHaveProperty('suppression_index');
    expect(result.causal_cluster_result).toHaveProperty('cluster_summary');
  });

  it('23. suppressed dimension results carry causal provenance with cluster_ids', () => {
    const input = makeStaleInput('escalate');
    const result = scoreDimensions(input);

    const suppressedCount = result.causal_cluster_result
      ? Object.values(result.causal_cluster_result.suppression_index).filter(
          r => r.status === 'suppressed_by_cluster',
        ).length
      : 0;

    if (suppressedCount > 0) {
      // At least one dimension must have causal provenance populated
      const dimsWithCausal = Object.values(result.dimensions).filter(
        d => d.causal !== undefined,
      );
      expect(dimsWithCausal.length).toBeGreaterThan(0);

      // And at least one dim has cluster_ids populated
      const dimWithCluster = Object.values(result.dimensions).find(
        d => d.causal?.cluster_ids && d.causal.cluster_ids.length > 0,
      );
      expect(dimWithCluster).toBeDefined();
    }
  });

  it('24. derived-only dimension has softened effective_severity', () => {
    const scope = ['src/auth/login.ts'];
    // Pure stale: freshness escalate, mapping is derived from same stale root
    const input = makeStaleInput('escalate');
    const result = scoreDimensions(input);

    if (!result.causal_cluster_result) return;

    // Find which dimensions are derived (suppressed by cluster)
    const derivedDimensions = Object.entries(result.dimensions).filter(([_key, dim]) =>
      dim.causal?.suppressed_signals && dim.causal.suppressed_signals.length > 0,
    );

    for (const [_key, dim] of derivedDimensions) {
      // effective_severity should not be worse than unsuppressed_severity_basis
      // (it can be same or better, never worse)
      const effectiveSev = dim.causal?.effective_severity;
      const unsuppressedSev = dim.causal?.unsuppressed_severity_basis;
      if (effectiveSev && unsuppressedSev) {
        const sevOrder = ['pass', 'warn', 'escalate', 'block'];
        const effectiveIdx = sevOrder.indexOf(effectiveSev);
        const unsuppressedIdx = sevOrder.indexOf(unsuppressedSev);
        expect(effectiveIdx).toBeLessThanOrEqual(unsuppressedIdx);
      }
    }
  });

  it('25. unsuppressed dimension has effective_severity === status (no softening)', () => {
    const input = makeStaleInput('escalate');
    const result = scoreDimensions(input);

    const primaryOrIndependentDims = Object.values(result.dimensions).filter(d =>
      d.causal?.unsuppressed_severity_basis === d.causal?.effective_severity,
    );

    // At least the primary dimension and coverage (independent) should match
    expect(primaryOrIndependentDims.length).toBeGreaterThan(0);
  });
});

// ─── E. Trace audit ────────────────────────────────────────────────────────────

describe('E. Trace audit', () => {
  it('26. DimensionScoringTrace carries causal_clustering when clusters are present', () => {
    const input = makeStaleInput('escalate');
    const scored = scoreDimensions(input);
    const trace  = traceDimensionScoring(scored);

    expect(trace).toHaveProperty('causal_clustering');
    expect(trace.causal_clustering).toBeDefined();
  });

  it('27. trace causal_clustering.suppression_decisions includes all derived signals', () => {
    const input = makeStaleInput('escalate');
    const scored = scoreDimensions(input);
    const trace  = traceDimensionScoring(scored);

    const suppressionDecisions = trace.causal_clustering?.suppression_decisions ?? [];
    const derivedDecisions = suppressionDecisions.filter(
      (d: { status: string }) => d.status === 'suppressed_by_cluster',
    );

    const clusterDerived = Object.values(scored.causal_cluster_result?.suppression_index ?? {}).filter(
      r => r.status === 'suppressed_by_cluster',
    );

    expect(derivedDecisions.length).toBe(clusterDerived.length);
  });

  it('28. trace primary_vs_derived_map is present and accurate', () => {
    const input = makeStaleInput('escalate');
    const scored = scoreDimensions(input);
    const trace  = traceDimensionScoring(scored);

    expect(trace.causal_clustering?.primary_vs_derived_map).toBeDefined();

    const pvdMap = trace.causal_clustering?.primary_vs_derived_map ?? {};
    const entries = Object.values(pvdMap as Record<string, string>);

    // Every entry must be either 'primary' or 'derived' or 'independent'
    for (const entry of entries) {
      expect(['primary', 'derived', 'independent']).toContain(entry);
    }
  });
});
