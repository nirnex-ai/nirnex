import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ScopeDecision } from './scope/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Schema versioning ────────────────────────────────────────────────────────

/**
 * Current schema version.
 * v1: original schema (no scope columns)
 * v2: adds tier, reason_code, decision_source, matched_rule to modules
 */
const CURRENT_SCHEMA_VERSION = 2;

function readUserVersion(db: DatabaseType): number {
  const rows = db.pragma('user_version') as Array<{ user_version: number }>;
  return rows[0]?.user_version ?? 0;
}

// ─── checkSchemaVersionOrRebuild ─────────────────────────────────────────────

/**
 * Check whether an existing database is at the current schema version.
 *
 * Behavior:
 *   - DB does not exist       → OK (fresh, will be created)
 *   - DB at current version   → OK
 *   - DB at older version + isRebuild=true  → delete DB, returns OK (fresh)
 *   - DB at older version + isRebuild=false → returns { needsRebuild: true }
 *
 * Call this BEFORE openDb().
 */
export function checkSchemaVersionOrRebuild(
  dbPath: string,
  isRebuild: boolean
): { needsRebuild: boolean; currentVersion?: number; message?: string } {
  if (!existsSync(dbPath)) {
    return { needsRebuild: false };
  }

  let db: DatabaseType | null = null;
  let userVersion = 0;
  try {
    db = new Database(dbPath, { readonly: true });
    userVersion = readUserVersion(db);
  } catch {
    // Can't read DB — treat as stale, require rebuild
    userVersion = 0;
  } finally {
    db?.close();
  }

  if (userVersion >= CURRENT_SCHEMA_VERSION) {
    return { needsRebuild: false };
  }

  if (isRebuild) {
    // Delete the old DB so openDb() creates a fresh one
    try {
      unlinkSync(dbPath);
      // Also delete WAL and SHM sidecar files if present
      for (const ext of ['-wal', '-shm']) {
        const sidecar = dbPath + ext;
        if (existsSync(sidecar)) unlinkSync(sidecar);
      }
    } catch {
      // If deletion fails, openDb will overwrite via exec
    }
    return { needsRebuild: false };
  }

  return {
    needsRebuild: true,
    currentVersion: userVersion,
    message:
      `Index schema updated (v${userVersion} → v${CURRENT_SCHEMA_VERSION}). ` +
      'Run: nirnex index --rebuild',
  };
}

// ─── openDb ──────────────────────────────────────────────────────────────────

/**
 * Open (or create) the Nirnex SQLite database at the given path.
 * On first open, bootstraps all tables from schema.sql.
 */
export function openDb(dbPath: string): DatabaseType {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Bootstrap if this is a fresh database
  const metaExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_meta'`)
    .get() as { name: string } | undefined;

  if (!metaExists) {
    let schemaPath = path.join(__dirname, 'schema.sql');
    if (!existsSync(schemaPath)) {
      schemaPath = path.join(__dirname, '../src/schema.sql');
    }
    const schemaSql = readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);
    db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`).run(
      String(CURRENT_SCHEMA_VERSION)
    );
    db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('created_at', datetime('now'))`).run();
  }

  return db;
}

// ─── indexStats ──────────────────────────────────────────────────────────────

export function indexStats(db: DatabaseType): {
  moduleCount: number;
  edgeCount: number;
  schemaVersion: string | null;
} {
  const moduleCountRow = db.prepare('SELECT COUNT(*) as n FROM modules').get() as { n: number };
  const edgeCountRow = db.prepare('SELECT COUNT(*) as n FROM edges').get() as { n: number };
  const meta = db
    .prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`)
    .get() as { value: string } | undefined;

  return {
    moduleCount: moduleCountRow?.n ?? 0,
    edgeCount: edgeCountRow?.n ?? 0,
    schemaVersion: meta?.value ?? null,
  };
}

export function setMetaCommitHash(db: DatabaseType, hash: string) {
  db.prepare(`
    INSERT INTO _meta (key, value) VALUES ('commit_hash', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(hash);
}

// ─── writeFullIndexRecord ─────────────────────────────────────────────────────

/**
 * Insert or update a fully-indexed module, including its scope decision
 * and all dependencies.
 */
export function writeFullIndexRecord(
  db: DatabaseType,
  parsed: {
    path: string;
    name: string;
    language: string;
    loc: number;
    imports: Array<{
      source: string;
      specifiers: string[];
      resolved?: string;
      is_local?: boolean;
      is_cross_module?: boolean;
    }>;
  },
  decision: ScopeDecision
): number {
  db.prepare(`
    INSERT INTO modules (path, name, language, loc, indexed_at,
      tier, reason_code, decision_source, matched_rule)
    VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name=excluded.name,
      language=excluded.language,
      loc=excluded.loc,
      indexed_at=excluded.indexed_at,
      tier=excluded.tier,
      reason_code=excluded.reason_code,
      decision_source=excluded.decision_source,
      matched_rule=excluded.matched_rule
  `).run(
    parsed.path,
    parsed.name,
    parsed.language,
    parsed.loc,
    decision.tier,
    decision.reasonCode,
    decision.decisionSource,
    decision.matchedRule ?? null
  );

  const moduleId = (
    db.prepare(`SELECT id FROM modules WHERE path = ?`).get(parsed.path) as { id: number }
  ).id;

  db.prepare(`DELETE FROM dependencies WHERE module_id = ?`).run(moduleId);

  const insertDep = db.prepare(`
    INSERT INTO dependencies (module_id, specifier, resolved, kind, is_local, is_cross_module)
    VALUES (?, ?, ?, 'import', ?, ?)
  `);

  for (const imp of parsed.imports) {
    try {
      insertDep.run(
        moduleId,
        imp.source,
        imp.resolved ?? null,
        imp.is_local ? 1 : 0,
        imp.is_cross_module ? 1 : 0
      );
    } catch {
      // Ignore duplicate import specifiers
    }
  }

  return moduleId;
}

// ─── writeExcludedIndexRecord ─────────────────────────────────────────────────

/**
 * Record an excluded file as a minimal presence record.
 * No parse, no symbols, no edges — only enough for --explain-scope queries.
 */
export function writeExcludedIndexRecord(
  db: DatabaseType,
  filePath: string,
  decision: ScopeDecision
): void {
  const name = path.basename(filePath, path.extname(filePath));
  db.prepare(`
    INSERT INTO modules (path, name, language, loc, indexed_at,
      tier, reason_code, decision_source, matched_rule)
    VALUES (?, ?, 'excluded', 0, datetime('now'), ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      tier=excluded.tier,
      reason_code=excluded.reason_code,
      decision_source=excluded.decision_source,
      matched_rule=excluded.matched_rule,
      indexed_at=excluded.indexed_at
  `).run(
    filePath,
    name,
    decision.tier,
    decision.reasonCode,
    decision.decisionSource,
    decision.matchedRule ?? null
  );
}

// ─── insertParsedModule (backward-compat wrapper) ────────────────────────────

/**
 * Legacy insert — kept for backward compatibility.
 * New code should use writeFullIndexRecord() with a ScopeDecision.
 */
export function insertParsedModule(
  db: DatabaseType,
  parsed: {
    path: string;
    name: string;
    language: string;
    loc: number;
    imports: Array<{
      source: string;
      specifiers: string[];
      resolved?: string;
      is_local?: boolean;
      is_cross_module?: boolean;
    }>;
  }
): number {
  const legacyDecision: ScopeDecision = {
    path: parsed.path,
    tier: 'FULL',
    reasonCode: 'DEFAULT_FULL',
    decisionSource: 'builtin',
  };
  return writeFullIndexRecord(db, parsed, legacyDecision);
}

// ─── computeGraphEdges ────────────────────────────────────────────────────────

export function computeGraphEdges(db: DatabaseType) {
  db.prepare('DELETE FROM edges').run();

  // Build edges only from FULL modules
  db.prepare(`
    INSERT INTO edges (from_id, to_id, kind, weight)
    SELECT d.module_id, m.id, 'imports', 1.0
    FROM dependencies d
    JOIN modules m ON m.path = d.resolved
    WHERE d.resolved IS NOT NULL
      AND d.is_local = 1
      AND EXISTS (
        SELECT 1 FROM modules src WHERE src.id = d.module_id AND src.tier = 'FULL'
      )
  `).run();

  db.prepare('UPDATE modules SET is_hub = 0').run();

  const inboundCounts = db
    .prepare('SELECT to_id, COUNT(*) as cnt FROM edges GROUP BY to_id')
    .all() as Array<{ to_id: number; cnt: number }>;

  const markHub = db.prepare('UPDATE modules SET is_hub = 1 WHERE id = ?');
  const insertSummary = db.prepare(
    'INSERT INTO hub_summaries (hub_path, model, content, token_count) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT DO UPDATE SET content=excluded.content'
  );

  for (const row of inboundCounts) {
    if (row.cnt > 50) {
      markHub.run(row.to_id);
      const mod = db
        .prepare('SELECT path FROM modules WHERE id = ?')
        .get(row.to_id) as { path: string };
      insertSummary.run(mod.path, 'system', `Auto-detected hub node with ${row.cnt} inbound edges.`, 10);
    }
  }
}
