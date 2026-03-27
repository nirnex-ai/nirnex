/**
 * Reproducibility — Content-Addressed ECO Cache
 *
 * Filesystem cache keyed by ECO fingerprint.
 * Cache entries are stored as JSON files at:
 *   {cacheDir}/{fingerprint}.json
 *
 * This cache is both a performance optimization AND a governance feature:
 * it proves that identical input identity maps to a stable output identity.
 *
 * Design constraints:
 *   - Filesystem-only for initial release (no Redis, no DB)
 *   - Cache directory is created on first write
 *   - Corrupt or unreadable cache files degrade gracefully (return null)
 *   - No TTL/eviction for initial release (content-addressed = stable forever)
 *   - Cache reads/writes are synchronous (compatible with existing sync ECO builder)
 */

import fs from 'fs';
import path from 'path';
import type { CachedEcoEntry, ECOProvenance } from './types.js';

// ─── EcoCache ────────────────────────────────────────────────────────────────

/**
 * Content-addressed filesystem cache for ECO outputs.
 *
 * @example
 * const cache = new EcoCache('/project/.ai-index/eco-cache');
 * const hit = cache.get(fingerprint);
 * if (!hit) {
 *   const eco = buildECOFromBundle(bundle);
 *   cache.set(fingerprint, eco, provenance);
 * }
 */
export class EcoCache {
  private readonly cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  /**
   * Look up a cached ECO entry by fingerprint.
   * Returns null on cache miss or if the cache entry is unreadable/corrupt.
   *
   * @param fingerprint - SHA-256 hex fingerprint (64 chars)
   */
  get(fingerprint: string): CachedEcoEntry | null {
    const filePath = this.entryPath(fingerprint);
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as CachedEcoEntry;
      // Minimal sanity check
      if (!parsed.fingerprint || !parsed.eco || !parsed.provenance) return null;
      return parsed;
    } catch {
      // Corrupt file, permission error, or invalid JSON → degrade gracefully
      return null;
    }
  }

  /**
   * Store an ECO output in the cache.
   * Creates the cache directory if it does not exist.
   * Silently ignores write failures (cache is best-effort).
   *
   * @param fingerprint - SHA-256 hex fingerprint (64 chars)
   * @param eco         - the full ECO object to cache
   * @param provenance  - the ECOProvenance attached to this ECO
   */
  set(fingerprint: string, eco: unknown, provenance: ECOProvenance): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const entry: CachedEcoEntry = {
        fingerprint,
        eco: eco as Record<string, unknown>,
        provenance,
        created_at: new Date().toISOString(),
      };
      const filePath = this.entryPath(fingerprint);
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch {
      // Write failure is non-fatal — cache is best-effort
    }
  }

  /**
   * Return the filesystem path for a cache entry.
   */
  entryPath(fingerprint: string): string {
    return path.join(this.cacheDir, `${fingerprint}.json`);
  }

  /**
   * Return the canonical cache directory path for a project root.
   * Callers can use this to construct a standard EcoCache instance.
   */
  static defaultCacheDir(targetRoot: string): string {
    return path.join(targetRoot, '.ai-index', 'eco-cache');
  }
}
