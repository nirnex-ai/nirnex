/**
 * Reproducibility — Evidence Freeze
 *
 * Pure function that builds a FrozenEvidenceBundle from already-collected
 * retrieval data. All I/O (file reads, git queries, db access) is the
 * caller's responsibility and must happen BEFORE calling buildFrozenBundle.
 *
 * The freeze boundary is:
 *   [all retrieval I/O] → buildFrozenBundle() → fingerprint → cache check
 *   → [deterministic scoring only, no further I/O]
 *
 * Design constraints:
 *   - Pure function — no file system access, no git commands, no DB queries
 *   - All inputs are already-collected; nothing is re-fetched inside here
 *   - hashContent / hashSources from fingerprint.ts handle hashing
 *   - resolveReproducibility is deterministic given the bundle contents
 */

import { hashContent, hashSources } from './fingerprint.js';
import type {
  FrozenEvidenceBundle,
  FrozenSourceRecord,
  ReproducibilityStatus,
} from './types.js';

// ─── Config version ───────────────────────────────────────────────────────────

/**
 * Hardcoded config version for initial release.
 * Bump when intent patterns, threshold policy, or scoring config changes.
 */
export const CONFIG_VERSION = '1.0.0';

// ─── buildFrozenBundle ────────────────────────────────────────────────────────

/**
 * Build a FrozenEvidenceBundle from already-collected retrieval data.
 *
 * This is a pure function: the caller has already done all I/O.
 * The bundle is a stable, content-addressed snapshot of all ECO inputs.
 *
 * @param params.specPath          - original spec file path (or null)
 * @param params.specContent       - spec file content already read (or null)
 * @param params.headCommit        - git HEAD commit SHA (or 'unknown')
 * @param params.indexedCommit     - .aidos.db indexed commit SHA (or 'unknown')
 * @param params.evidenceItems     - all evidence sources already collected
 * @param params.normalizerVersion - CALCULATION_VERSION from scoring module
 * @param params.schemaVersion     - LEDGER_SCHEMA_VERSION
 */
export function buildFrozenBundle(params: {
  specPath:          string | null;
  specContent:       string | null;
  headCommit:        string;
  indexedCommit:     string;
  evidenceItems:     FrozenSourceRecord[];
  normalizerVersion: string;
  schemaVersion:     string;
  dirtyWorkingTree?: boolean;
  dirtyScopeHash?:   string;
}): FrozenEvidenceBundle {
  const {
    specPath,
    specContent,
    headCommit,
    indexedCommit,
    evidenceItems,
    normalizerVersion,
    schemaVersion,
    dirtyWorkingTree = false,
    dirtyScopeHash,
  } = params;

  // ── Spec ───────────────────────────────────────────────────────────────────
  const rawSpecContent = specContent ?? '';
  const specContentHash = rawSpecContent !== '' ? hashContent(rawSpecContent) : '';
  const normalizedContent = normalizeSpec(rawSpecContent);
  const normalizedHash = normalizedContent !== '' ? hashContent(normalizedContent) : '';

  // ── Retrieval ──────────────────────────────────────────────────────────────
  // Sort evidence sources canonically so input order never affects the fingerprint
  const sortedSources = [...evidenceItems].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.ref    !== b.ref)    return a.ref.localeCompare(b.ref);
    return a.content.localeCompare(b.content);
  });

  const aggregateHash = hashSources(evidenceItems); // hashSources sorts internally

  // ── Index ──────────────────────────────────────────────────────────────────
  // snapshot_id is the indexed commit; content_hash approximates index state
  const indexContentHash = indexedCommit !== 'unknown' ? hashContent(indexedCommit) : 'unknown';

  // ── Build metadata ─────────────────────────────────────────────────────────
  const configHash = hashContent(
    `${CONFIG_VERSION}:${normalizerVersion}:${schemaVersion}`,
  );

  return {
    frozen_at: new Date().toISOString(),

    spec: {
      content_hash:    specContentHash,
      normalized_hash: normalizedHash,
      ...(specPath ? { path: specPath } : {}),
    },

    repo: {
      head_commit:      headCommit,
      dirty:            dirtyWorkingTree,
      ...(dirtyScopeHash ? { dirty_scope_hash: dirtyScopeHash } : {}),
    },

    index: {
      snapshot_id:       indexedCommit,
      content_hash:      indexContentHash,
      built_from_commit: indexedCommit !== 'unknown' ? indexedCommit : undefined,
    },

    retrieval: {
      sources:        sortedSources,
      aggregate_hash: aggregateHash,
    },

    build: {
      config_hash:        configHash,
      prompt_versions:    {},
      model_versions:     {},
      normalizer_version: normalizerVersion,
      schema_version:     schemaVersion,
    },
  };
}

// ─── resolveReproducibility ───────────────────────────────────────────────────

/**
 * Determine the reproducibility status from a FrozenEvidenceBundle.
 *
 * Status decision rules (checked in order):
 *   1. head_commit = 'unknown'     → unbounded (no git state available)
 *   2. snapshot_id = 'unknown'     → unbounded (index not fingerprinted)
 *   3. spec content is empty       → bounded   (no spec to freeze)
 *   4. dirty working tree with no  → bounded   (changes not fingerprinted)
 *      dirty_scope_hash
 *   5. everything present          → strict
 *
 * @param bundle - the frozen evidence bundle to evaluate
 * @returns      ReproducibilityStatus
 */
export function resolveReproducibility(bundle: FrozenEvidenceBundle): ReproducibilityStatus {
  const reasons = collectUnreproducibleReasons(bundle);
  if (reasons.length === 0) return 'strict';
  // Distinguish bounded (soft uncertainty) from unbounded (hard non-determinism)
  const hardReasons = reasons.filter(r => r.startsWith('HARD:'));
  if (hardReasons.length > 0) return 'unbounded';
  return 'bounded';
}

// ─── collectUnreproducibleReasons ────────────────────────────────────────────

/**
 * Collect all reasons why a bundle is not fully reproducible.
 * Reasons prefixed with 'HARD:' are unbounded; others are bounded.
 */
export function collectUnreproducibleReasons(bundle: FrozenEvidenceBundle): string[] {
  const reasons: string[] = [];

  if (bundle.repo.head_commit === 'unknown') {
    reasons.push('HARD:repo_head_commit_unavailable');
  }

  if (bundle.index.snapshot_id === 'unknown') {
    reasons.push('HARD:index_snapshot_unavailable');
  }

  if (bundle.spec.content_hash === '') {
    reasons.push('SOFT:spec_content_empty');
  }

  if (bundle.repo.dirty && !bundle.repo.dirty_scope_hash) {
    reasons.push('SOFT:dirty_working_tree_not_hashed');
  }

  return reasons;
}

// ─── normalizeSpec ────────────────────────────────────────────────────────────

/**
 * Normalize spec content for stable hashing.
 * Collapses whitespace and trims so minor formatting differences
 * don't produce different fingerprints.
 */
function normalizeSpec(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}
