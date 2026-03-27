/**
 * Reproducibility — Deterministic Fingerprinting
 *
 * Produces stable SHA-256 fingerprints from evidence bundles.
 * The fingerprint is the cache key and the reproducibility identity.
 *
 * Design constraints:
 *   - Pure function — no side effects, no I/O, no randomness
 *   - frozen_at is ALWAYS excluded (volatile timestamp)
 *   - All arrays are sorted before hashing (canonical order)
 *   - Uses Node.js built-in crypto — no external dependencies
 *   - Returns lowercase hex strings (64 characters for SHA-256)
 */

import { createHash } from 'crypto';
import type { FrozenEvidenceBundle, FrozenSourceRecord } from './types.js';

// ─── hashContent ──────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hash of an arbitrary string.
 * Returns lowercase hex (64 characters).
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ─── hashSources ──────────────────────────────────────────────────────────────

/**
 * Compute an aggregate hash of a sorted set of source records.
 * Sources are sorted canonically before hashing so that input order
 * does not affect the result.
 *
 * Canonical sort key: (source, ref, content) lexicographic.
 */
export function hashSources(sources: FrozenSourceRecord[]): string {
  const sorted = [...sources].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.ref    !== b.ref)    return a.ref.localeCompare(b.ref);
    return a.content.localeCompare(b.content);
  });

  const canonical = sorted.map(s => `${s.source}\x00${s.ref}\x00${s.content}`).join('\x01');
  return hashContent(canonical);
}

// ─── extractFingerprintInputs ─────────────────────────────────────────────────

/**
 * Extract only the deterministic fields from a bundle for fingerprint computation.
 * frozen_at is explicitly excluded.
 *
 * Used for testing (verify what's included) and as input to computeFingerprint.
 */
export function extractFingerprintInputs(bundle: FrozenEvidenceBundle): Record<string, unknown> {
  return {
    spec: {
      content_hash:    bundle.spec.content_hash,
      normalized_hash: bundle.spec.normalized_hash,
      path:            bundle.spec.path ?? null,
    },
    repo: {
      head_commit:     bundle.repo.head_commit,
      dirty:           bundle.repo.dirty,
      dirty_scope_hash: bundle.repo.dirty_scope_hash ?? null,
    },
    index: {
      snapshot_id:       bundle.index.snapshot_id,
      content_hash:      bundle.index.content_hash,
      built_from_commit: bundle.index.built_from_commit ?? null,
    },
    retrieval: {
      aggregate_hash: bundle.retrieval.aggregate_hash,
    },
    build: {
      config_hash:        bundle.build.config_hash,
      normalizer_version: bundle.build.normalizer_version,
      schema_version:     bundle.build.schema_version,
      // prompt_versions and model_versions are included if non-empty
      ...(Object.keys(bundle.build.prompt_versions).length > 0
        ? { prompt_versions: bundle.build.prompt_versions }
        : {}),
      ...(Object.keys(bundle.build.model_versions).length > 0
        ? { model_versions: bundle.build.model_versions }
        : {}),
    },
  };
}

// ─── computeFingerprint ───────────────────────────────────────────────────────

/**
 * Compute the deterministic fingerprint for a FrozenEvidenceBundle.
 *
 * The fingerprint is a SHA-256 hex digest of the canonical JSON of all
 * deterministic bundle fields. frozen_at is always excluded.
 *
 * @param bundle - the frozen evidence bundle to fingerprint
 * @returns      lowercase 64-char hex SHA-256
 */
export function computeFingerprint(bundle: FrozenEvidenceBundle): string {
  const inputs = extractFingerprintInputs(bundle);
  const canonical = stableStringify(inputs);
  return hashContent(canonical);
}

// ─── stableStringify ──────────────────────────────────────────────────────────

/**
 * JSON.stringify with deterministically sorted keys at every level.
 * Arrays preserve their order (callers must sort before passing in).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(k => {
    return JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]);
  });
  return '{' + pairs.join(',') + '}';
}
