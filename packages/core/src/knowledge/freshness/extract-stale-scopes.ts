import type Database from 'better-sqlite3';
import type { FreshnessSnapshot, StaleScopeRef } from './types.js';

/**
 * Convert a FreshnessSnapshot into a list of StaleScopeRef objects.
 *
 * Fallback hierarchy (deterministic):
 *   1. Symbol scope IDs from the DB modules table  (future: symbol-level)
 *   2. File path as scope ID                       (release implementation)
 *   3. Nothing when the file was not in changedFiles
 *
 * This function is pure: it calls no git commands.
 * All git interaction is encapsulated in buildFreshnessSnapshot().
 */
export function extractStaleScopes(
  snapshot: FreshnessSnapshot,
  db?: InstanceType<typeof Database>,
): StaleScopeRef[] {
  if (!snapshot.isStale || snapshot.changedFiles.length === 0) return [];

  // Build a lookup map from path → changeType for O(1) access
  const changeTypeMap = new Map<string, StaleScopeRef['changeType']>();
  for (const entry of snapshot.changedFileStatuses) {
    changeTypeMap.set(entry.path, entry.changeType);
  }

  return snapshot.changedFiles.map((filePath): StaleScopeRef => {
    const changeType = changeTypeMap.get(filePath) ?? 'modified';

    // ── DB-backed symbol scope lookup (release: file-level fallback) ─────────
    // When the DB is available we confirm the file was indexed, but for the
    // release the scope ID is still the file path.
    // Symbol-level scope IDs are reserved for a future pass.
    const scopeIds = resolveFileScopeIds(filePath, db);

    return {
      filePath,
      scopeIds,
      changeType,
    };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve scope IDs for a changed file.
 * Release implementation: file path is the scope ID.
 * Future: symbol IDs from DB.
 */
function resolveFileScopeIds(
  filePath: string,
  db?: InstanceType<typeof Database>,
): string[] {
  if (db) {
    try {
      // Verify the file is tracked by the index
      const row = db
        .prepare('SELECT id FROM modules WHERE path = ?')
        .get(filePath) as { id: number } | undefined;

      // Whether or not the file is in the DB, the scope ID is still the file path.
      // The DB check is a hook for future symbol-level expansion.
      void row;
    } catch {
      // DB lookup failure → fall back silently
    }
  }

  // Release: file path = scope ID (stable, deterministic, no model inference)
  return [filePath];
}
