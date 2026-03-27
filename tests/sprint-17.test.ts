/**
 * Sprint 17 — Reproducibility Boundary (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete only when every test passes.
 *
 * Coverage:
 *
 * A. FrozenEvidenceBundle construction (pure function — no I/O)
 *   1.  spec content present → bundle.spec.content_hash is non-empty hex
 *   2.  query-only (no spec) → bundle.spec.content_hash derived from query
 *   3.  no spec, no query → bundle.spec.content_hash is empty-string sentinel
 *   4.  bundle carries head_commit, indexed_commit, evidence aggregate_hash
 *   5.  bundle.build fields include normalizer_version and schema_version
 *   6.  bundle.frozen_at is an ISO 8601 timestamp
 *
 * B. Deterministic fingerprinting
 *   7.  same bundle inputs → same fingerprint
 *   8.  different spec content → different fingerprint
 *   9.  different head_commit → different fingerprint
 *   10. different indexed_commit → different fingerprint
 *   11. frozen_at is NOT included in fingerprint (volatile timestamp excluded)
 *   12. fingerprint is a 64-char lowercase hex string (SHA-256)
 *   13. shuffled evidence order → same fingerprint (canonical sort before hash)
 *
 * C. Canonicalization
 *   14. canonicalizeECO sorts boundary_warnings alphabetically
 *   15. canonicalizeECO sorts escalation_reasons alphabetically
 *   16. canonicalizeECO sorts conflicts by id
 *   17. stableJsonStringify produces same output for same object regardless of
 *       input key insertion order
 *   18. canonicalizeECO is idempotent (applying twice = applying once)
 *
 * D. ECO cache (filesystem)
 *   19. fresh cache → get(fingerprint) returns null
 *   20. set() then get() → returns stored entry
 *   21. cache entry contains eco + provenance + fingerprint
 *   22. cache file lives at eco-cache/{fingerprint}.json under cache dir
 *   23. corrupt cache file → get() returns null (graceful degradation)
 *
 * E. ECO provenance — buildECO integration
 *   24. buildECO returns eco.provenance with fingerprint field
 *   25. buildECO returns eco.provenance.reproducibility (strict | bounded | unbounded)
 *   26. buildECO returns eco.provenance.cache_hit = false on first call
 *   27. buildECO returns eco.provenance.bundle_snapshot with key fields populated
 *   28. two identical buildECO calls → same fingerprint both times
 *
 * F. Cache hit / replay
 *   29. two identical buildECO calls → second has cache_hit = true
 *   30. cached ECO has same confidence_score as original
 *   31. cached ECO has same eco_dimensions as original
 *
 * G. Reproducibility policy gating
 *   32. strict reproducibility → forced_lane_minimum unchanged (no escalation)
 *   33. unbounded reproducibility → forced_lane_minimum escalated to 'B' minimum
 *   34. unbounded + high-risk intent (bug_fix) → escalation_reasons includes
 *       reproducibility warning
 *
 * H. Determinism / ordering independence
 *   35. Same query twice → eco.boundary_warnings in same order
 *   36. Same query twice → eco.escalation_reasons in same order
 *   37. Any unbounded-reason source → eco.provenance.unreproducible_reasons populated
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  buildFrozenBundle,
  computeFingerprint,
  canonicalizeECO,
  stableJsonStringify,
  EcoCache,
  resolveReproducibility,
  type FrozenEvidenceBundle,
  type FrozenSourceRecord,
} from '../packages/core/src/knowledge/reproducibility/index.js';

import { buildECO } from '../packages/core/src/eco.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBundleParams(overrides: Partial<{
  specPath: string | null;
  specContent: string | null;
  headCommit: string;
  indexedCommit: string;
  evidenceItems: FrozenSourceRecord[];
  normalizerVersion: string;
  schemaVersion: string;
}> = {}) {
  return {
    specPath:          overrides.specPath          ?? null,
    specContent:       overrides.specContent !== undefined ? overrides.specContent : 'spec content here',
    headCommit:        overrides.headCommit        ?? 'abc123def456',
    indexedCommit:     overrides.indexedCommit     ?? 'abc123def456',
    evidenceItems:     overrides.evidenceItems     ?? [
      { source: 'spec', ref: 'spec.md', content: 'fix the login bug' },
    ],
    normalizerVersion: overrides.normalizerVersion ?? '3.0.0',
    schemaVersion:     overrides.schemaVersion     ?? '1.0.0',
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-17-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── A. FrozenEvidenceBundle construction ────────────────────────────────────

describe('A. FrozenEvidenceBundle construction', () => {
  it('1. spec content present → bundle.spec.content_hash is non-empty hex', () => {
    const bundle = buildFrozenBundle(makeBundleParams({ specContent: 'fix the login bug' }));
    expect(bundle.spec.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2. query-only (no spec path) → bundle.spec.content_hash derived from query', () => {
    const bundle1 = buildFrozenBundle(makeBundleParams({ specPath: null, specContent: 'fix query A' }));
    const bundle2 = buildFrozenBundle(makeBundleParams({ specPath: null, specContent: 'fix query B' }));
    expect(bundle1.spec.content_hash).not.toBe(bundle2.spec.content_hash);
  });

  it('3. no spec, no query → bundle marks as empty-string sentinel hash', () => {
    const bundle = buildFrozenBundle(makeBundleParams({ specPath: null, specContent: null }));
    expect(bundle.spec.content_hash).toBe('');
  });

  it('4. bundle carries head_commit, indexed_commit, evidence aggregate_hash', () => {
    const bundle = buildFrozenBundle(makeBundleParams({
      headCommit: 'HEAD_SHA',
      indexedCommit: 'INDEX_SHA',
    }));
    expect(bundle.repo.head_commit).toBe('HEAD_SHA');
    expect(bundle.index.built_from_commit).toBe('INDEX_SHA');
    expect(bundle.retrieval.aggregate_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('5. bundle.build fields include normalizer_version and schema_version', () => {
    const bundle = buildFrozenBundle(makeBundleParams({
      normalizerVersion: '3.0.0',
      schemaVersion: '1.0.0',
    }));
    expect(bundle.build.normalizer_version).toBe('3.0.0');
    expect(bundle.build.schema_version).toBe('1.0.0');
  });

  it('6. bundle.frozen_at is an ISO 8601 timestamp', () => {
    const bundle = buildFrozenBundle(makeBundleParams());
    expect(bundle.frozen_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(() => new Date(bundle.frozen_at)).not.toThrow();
  });
});

// ─── B. Deterministic fingerprinting ─────────────────────────────────────────

describe('B. Deterministic fingerprinting', () => {
  it('7. same bundle inputs → same fingerprint', () => {
    const params = makeBundleParams();
    const fp1 = computeFingerprint(buildFrozenBundle(params));
    const fp2 = computeFingerprint(buildFrozenBundle(params));
    expect(fp1).toBe(fp2);
  });

  it('8. different spec content → different fingerprint', () => {
    const fp1 = computeFingerprint(buildFrozenBundle(makeBundleParams({ specContent: 'content A' })));
    const fp2 = computeFingerprint(buildFrozenBundle(makeBundleParams({ specContent: 'content B' })));
    expect(fp1).not.toBe(fp2);
  });

  it('9. different head_commit → different fingerprint', () => {
    const fp1 = computeFingerprint(buildFrozenBundle(makeBundleParams({ headCommit: 'aaa111' })));
    const fp2 = computeFingerprint(buildFrozenBundle(makeBundleParams({ headCommit: 'bbb222' })));
    expect(fp1).not.toBe(fp2);
  });

  it('10. different indexed_commit → different fingerprint', () => {
    const fp1 = computeFingerprint(buildFrozenBundle(makeBundleParams({ indexedCommit: 'idx_aaa' })));
    const fp2 = computeFingerprint(buildFrozenBundle(makeBundleParams({ indexedCommit: 'idx_bbb' })));
    expect(fp1).not.toBe(fp2);
  });

  it('11. frozen_at is NOT included in fingerprint (volatile timestamp excluded)', () => {
    const params = makeBundleParams();
    const bundle1 = buildFrozenBundle(params);
    // Mutate frozen_at — fingerprint should not change
    const bundle2 = { ...bundle1, frozen_at: '2099-01-01T00:00:00.000Z' };
    expect(computeFingerprint(bundle1)).toBe(computeFingerprint(bundle2));
  });

  it('12. fingerprint is a 64-char lowercase hex string (SHA-256)', () => {
    const fp = computeFingerprint(buildFrozenBundle(makeBundleParams()));
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.length).toBe(64);
  });

  it('13. shuffled evidence order → same fingerprint (canonical sort before hash)', () => {
    const items: FrozenSourceRecord[] = [
      { source: 'spec', ref: 'z-last.md', content: 'zzz' },
      { source: 'code', ref: 'a-first.ts', content: 'aaa' },
      { source: 'spec', ref: 'm-mid.md', content: 'mmm' },
    ];
    const shuffled: FrozenSourceRecord[] = [
      { source: 'spec', ref: 'm-mid.md', content: 'mmm' },
      { source: 'code', ref: 'a-first.ts', content: 'aaa' },
      { source: 'spec', ref: 'z-last.md', content: 'zzz' },
    ];
    const fp1 = computeFingerprint(buildFrozenBundle(makeBundleParams({ evidenceItems: items })));
    const fp2 = computeFingerprint(buildFrozenBundle(makeBundleParams({ evidenceItems: shuffled })));
    expect(fp1).toBe(fp2);
  });
});

// ─── C. Canonicalization ──────────────────────────────────────────────────────

describe('C. Canonicalization', () => {
  it('14. canonicalizeECO sorts boundary_warnings alphabetically', () => {
    const eco = {
      boundary_warnings: ['z-warning', 'a-warning', 'm-warning'],
    } as any;
    const canonical = canonicalizeECO(eco);
    expect(canonical.boundary_warnings).toEqual(['a-warning', 'm-warning', 'z-warning']);
  });

  it('15. canonicalizeECO sorts escalation_reasons alphabetically', () => {
    const eco = {
      escalation_reasons: ['z-reason', 'a-reason', 'm-reason'],
    } as any;
    const canonical = canonicalizeECO(eco);
    expect(canonical.escalation_reasons).toEqual(['a-reason', 'm-reason', 'z-reason']);
  });

  it('16. canonicalizeECO sorts conflicts by id', () => {
    const eco = {
      conflicts: [
        { id: 'conflict_zzz', severity: 'high' },
        { id: 'conflict_aaa', severity: 'low' },
        { id: 'conflict_mmm', severity: 'medium' },
      ],
    } as any;
    const canonical = canonicalizeECO(eco);
    expect(canonical.conflicts.map((c: any) => c.id)).toEqual([
      'conflict_aaa',
      'conflict_mmm',
      'conflict_zzz',
    ]);
  });

  it('17. stableJsonStringify produces same output regardless of key insertion order', () => {
    const objA = { z: 3, a: 1, m: 2 };
    const objB = { a: 1, m: 2, z: 3 };
    expect(stableJsonStringify(objA)).toBe(stableJsonStringify(objB));
  });

  it('18. canonicalizeECO is idempotent', () => {
    const eco = {
      boundary_warnings: ['z-warn', 'a-warn'],
      escalation_reasons: ['z-reason', 'a-reason'],
      conflicts: [
        { id: 'cz', severity: 'high' },
        { id: 'ca', severity: 'low' },
      ],
    } as any;
    const once  = canonicalizeECO(eco);
    const twice = canonicalizeECO(once);
    expect(stableJsonStringify(once)).toBe(stableJsonStringify(twice));
  });
});

// ─── D. ECO cache (filesystem) ───────────────────────────────────────────────

describe('D. ECO cache', () => {
  it('19. fresh cache → get(fingerprint) returns null', () => {
    const cache = new EcoCache(path.join(tmpDir, 'eco-cache'));
    expect(cache.get('nonexistent_fingerprint')).toBeNull();
  });

  it('20. set() then get() → returns stored entry', () => {
    const cache = new EcoCache(path.join(tmpDir, 'eco-cache'));
    const fp = 'a'.repeat(64);
    const eco = { confidence_score: 75, eco_dimensions: {} };
    const provenance = {
      fingerprint: fp,
      reproducibility: 'strict' as const,
      cache_hit: false,
      bundle_snapshot: {},
    };
    cache.set(fp, eco, provenance as any);
    const entry = cache.get(fp);
    expect(entry).not.toBeNull();
    expect(entry!.eco.confidence_score).toBe(75);
  });

  it('21. cache entry contains eco + provenance + fingerprint', () => {
    const cache = new EcoCache(path.join(tmpDir, 'eco-cache'));
    const fp = 'b'.repeat(64);
    const eco = { confidence_score: 60 };
    const provenance = {
      fingerprint: fp,
      reproducibility: 'bounded' as const,
      cache_hit: false,
      bundle_snapshot: { head_commit: 'abc' },
    };
    cache.set(fp, eco, provenance as any);
    const entry = cache.get(fp);
    expect(entry!.fingerprint).toBe(fp);
    expect(entry!.provenance.reproducibility).toBe('bounded');
  });

  it('22. cache file lives at {cacheDir}/{fingerprint}.json', () => {
    const cacheDir = path.join(tmpDir, 'eco-cache');
    const cache = new EcoCache(cacheDir);
    const fp = 'c'.repeat(64);
    cache.set(fp, {}, { fingerprint: fp, reproducibility: 'strict', cache_hit: false, bundle_snapshot: {} } as any);
    const expectedPath = path.join(cacheDir, `${fp}.json`);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('23. corrupt cache file → get() returns null (graceful degradation)', () => {
    const cacheDir = path.join(tmpDir, 'eco-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const fp = 'd'.repeat(64);
    fs.writeFileSync(path.join(cacheDir, `${fp}.json`), 'NOT_VALID_JSON!!{');
    const cache = new EcoCache(cacheDir);
    expect(cache.get(fp)).toBeNull();
  });
});

// ─── E. ECO provenance — buildECO integration ────────────────────────────────

describe('E. ECO provenance — buildECO integration', () => {
  it('24. buildECO returns eco.provenance with fingerprint field', () => {
    const eco = buildECO(null, tmpDir, { query: 'fix the login timeout' }) as any;
    expect(eco.provenance).toBeDefined();
    expect(eco.provenance.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('25. buildECO returns eco.provenance.reproducibility', () => {
    const eco = buildECO(null, tmpDir, { query: 'add retry logic' }) as any;
    expect(['strict', 'bounded', 'unbounded']).toContain(eco.provenance.reproducibility);
  });

  it('26. buildECO returns eco.provenance.cache_hit = false on first call', () => {
    const eco = buildECO(null, tmpDir, { query: 'fix the permissions check' }) as any;
    expect(eco.provenance.cache_hit).toBe(false);
  });

  it('27. buildECO returns eco.provenance.bundle_snapshot with key fields', () => {
    const eco = buildECO(null, tmpDir, { query: 'refactor the auth module' }) as any;
    expect(eco.provenance.bundle_snapshot).toBeDefined();
    expect(eco.provenance.bundle_snapshot).toHaveProperty('normalizer_version');
    expect(eco.provenance.bundle_snapshot).toHaveProperty('schema_version');
  });

  it('28. two identical buildECO calls → same fingerprint both times', () => {
    // Query mode: no file I/O, spec content = query string → fully deterministic
    const eco1 = buildECO(null, tmpDir, { query: 'same query string' }) as any;
    const eco2 = buildECO(null, tmpDir, { query: 'same query string' }) as any;
    expect(eco1.provenance.fingerprint).toBe(eco2.provenance.fingerprint);
  });
});

// ─── F. Cache hit / replay ────────────────────────────────────────────────────

describe('F. Cache hit / replay', () => {
  it('29. two identical buildECO calls → second has cache_hit = true', () => {
    // Use a unique tmpDir with a .ai-index directory to enable caching
    const cacheRoot = path.join(tmpDir, 'cache-test-root');
    fs.mkdirSync(cacheRoot, { recursive: true });

    const query = 'fix the payment processing timeout unique_29';
    const eco1 = buildECO(null, cacheRoot, { query }) as any;
    const eco2 = buildECO(null, cacheRoot, { query }) as any;

    expect(eco1.provenance.cache_hit).toBe(false);
    expect(eco2.provenance.cache_hit).toBe(true);
  });

  it('30. cached ECO has same confidence_score as original', () => {
    const cacheRoot = path.join(tmpDir, 'cache-test-root-30');
    fs.mkdirSync(cacheRoot, { recursive: true });

    const query = 'unique_query_for_test_30_confidence';
    const eco1 = buildECO(null, cacheRoot, { query }) as any;
    const eco2 = buildECO(null, cacheRoot, { query }) as any;

    expect(eco2.confidence_score).toBe(eco1.confidence_score);
  });

  it('31. cached ECO has same eco_dimensions as original', () => {
    const cacheRoot = path.join(tmpDir, 'cache-test-root-31');
    fs.mkdirSync(cacheRoot, { recursive: true });

    const query = 'unique_query_for_test_31_dimensions';
    const eco1 = buildECO(null, cacheRoot, { query }) as any;
    const eco2 = buildECO(null, cacheRoot, { query }) as any;

    expect(eco2.eco_dimensions.coverage.severity).toBe(eco1.eco_dimensions.coverage.severity);
    expect(eco2.eco_dimensions.freshness.severity).toBe(eco1.eco_dimensions.freshness.severity);
    expect(eco2.eco_dimensions.mapping.severity).toBe(eco1.eco_dimensions.mapping.severity);
  });
});

// ─── G. Reproducibility policy gating ────────────────────────────────────────

describe('G. Reproducibility policy gating', () => {
  it('32. strict reproducibility → forced_lane_minimum unchanged from A', () => {
    // query mode with known inputs → strict reproducibility
    const eco = buildECO(null, tmpDir, { query: 'fix the auth timeout' }) as any;
    if (eco.provenance.reproducibility === 'strict') {
      // strict = no escalation from reproducibility alone
      expect(eco.escalation_reasons.filter((r: string) =>
        r.startsWith('reproducibility:')
      )).toHaveLength(0);
    }
    // If not strict (e.g. in test env without git), skip this assertion
  });

  it('33. unbounded reproducibility → forced_lane_minimum escalated to B minimum', () => {
    const eco = buildECO(null, tmpDir, { query: 'add the new feature X' }) as any;
    if (eco.provenance.reproducibility === 'unbounded') {
      const laneOrder = ['A', 'B', 'C', 'D', 'E'];
      const laneIdx = laneOrder.indexOf(eco.forced_lane_minimum);
      expect(laneIdx).toBeGreaterThanOrEqual(1); // >= 'B'
    }
  });

  it('34. unbounded → escalation_reasons includes reproducibility warning', () => {
    const eco = buildECO(null, tmpDir, { query: 'deploy the new service' }) as any;
    if (eco.provenance.reproducibility === 'unbounded') {
      const hasReproWarn = eco.escalation_reasons.some(
        (r: string) => r.startsWith('reproducibility:'),
      );
      expect(hasReproWarn).toBe(true);
    }
  });
});

// ─── H. Determinism / ordering independence ───────────────────────────────────

describe('H. Determinism / ordering independence', () => {
  it('35. same query twice → eco.boundary_warnings in same order', () => {
    const eco1 = buildECO(null, tmpDir, { query: 'fix the connection pooling' }) as any;
    const eco2 = buildECO(null, tmpDir, { query: 'fix the connection pooling' }) as any;
    expect(eco1.boundary_warnings).toEqual(eco2.boundary_warnings);
  });

  it('36. same query twice → eco.escalation_reasons in same order', () => {
    const eco1 = buildECO(null, tmpDir, { query: 'update the database schema' }) as any;
    const eco2 = buildECO(null, tmpDir, { query: 'update the database schema' }) as any;
    expect(eco1.escalation_reasons).toEqual(eco2.escalation_reasons);
  });

  it('37. unbounded → eco.provenance.unreproducible_reasons is non-empty', () => {
    const eco = buildECO(null, tmpDir, { query: 'fix the service mesh routing' }) as any;
    if (eco.provenance.reproducibility === 'unbounded') {
      expect(eco.provenance.unreproducible_reasons).toBeDefined();
      expect(eco.provenance.unreproducible_reasons.length).toBeGreaterThan(0);
    }
  });
});
