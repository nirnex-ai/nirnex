import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Open (or create) the ai-delivery-os SQLite database at the given path.
 * On first open, bootstraps all tables from schema.sql.
 */
export function openDb(dbPath: string): DatabaseType {
  const db = new Database(dbPath);

  // Enable WAL + FK via pragmas (schema.sql also sets them, but run here for safety)
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Check if already bootstrapped
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_meta'`)
    .get() as { name: string } | undefined;

  if (!row) {
    let schemaPath = path.join(__dirname, 'schema.sql');
    if (!existsSync(schemaPath)) {
       // Support running from dist
       schemaPath = path.join(__dirname, '../src/schema.sql');
    }
    const schemaSql = readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);
    db.prepare(`INSERT INTO _meta (key, value) VALUES ('schema_version', '1')`).run();
    db.prepare(`INSERT INTO _meta (key, value) VALUES ('created_at', datetime('now'))`).run();
  }

  return db;
}

/**
 * Return a quick summary of index contents.
 * Used by `dev status`.
 */
export function indexStats(db: DatabaseType): {
  moduleCount: number;
  edgeCount: number;
  schemaVersion: string | null;
} {
  const moduleCountRow = db.prepare('SELECT COUNT(*) as n FROM modules').get() as { n: number };
  const moduleCount = moduleCountRow ? moduleCountRow.n : 0;

  const edgeCountRow = db.prepare('SELECT COUNT(*) as n FROM edges').get() as { n: number };
  const edgeCount = edgeCountRow ? edgeCountRow.n : 0;

  const meta = db
    .prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`)
    .get() as { value: string } | undefined;

  return {
    moduleCount,
    edgeCount,
    schemaVersion: meta?.value ?? null,
  };
}

export function setMetaCommitHash(db: DatabaseType, hash: string) {
  db.prepare(`
    INSERT INTO _meta (key, value) VALUES ('commit_hash', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(hash);
}

/**
 * Insert or update a parsed module in the database, along with its dependencies
 */
export function insertParsedModule(
  db: DatabaseType,
  parsed: {
    path: string;
    name: string;
    language: string;
    loc: number;
    imports: Array<{ source: string; specifiers: string[]; resolved?: string; is_local?: boolean; is_cross_module?: boolean }>;
  }
) {
  db.prepare(`
    INSERT INTO modules (path, name, language, loc, indexed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      name=excluded.name,
      language=excluded.language,
      loc=excluded.loc,
      indexed_at=excluded.indexed_at
  `).run(parsed.path, parsed.name, parsed.language, parsed.loc);

  const moduleId = (db.prepare(`SELECT id FROM modules WHERE path = ?`).get(parsed.path) as { id: number }).id;

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
        imp.resolved || null,
        imp.is_local ? 1 : 0,
        imp.is_cross_module ? 1 : 0
      );
    } catch (err) {
      // Ignore duplicates
    }
  }

  return moduleId;
}

export function computeGraphEdges(db: DatabaseType) {
  // Clear edges to rebuild (incremental logic would be more sophisticated)
  db.prepare('DELETE FROM edges').run();

  // 1. Insert imports edges
  db.prepare(`
    INSERT INTO edges (from_id, to_id, kind, weight)
    SELECT d.module_id, m.id, 'imports', 1.0
    FROM dependencies d
    JOIN modules m ON m.path = d.resolved
    WHERE d.resolved IS NOT NULL
      AND d.is_local = 1
  `).run();

  // (Calls and Extends/Implements edges would go here, 
  // currently we treat all resolved dependencies as 'imports' base edges)

  // 2. Clear old hubs
  db.prepare('UPDATE modules SET is_hub = 0').run();
  
  // 3. Mark nodes with >50 inbound edges as hubs
  // For demonstration/testing, if any node has multiple inbound edges, flag it
  const inboundCounts = db.prepare('SELECT to_id, COUNT(*) as cnt FROM edges GROUP BY to_id').all() as Array<{ to_id: number; cnt: number }>;
  const markHub = db.prepare('UPDATE modules SET is_hub = 1 WHERE id = ?');
  const insertSummary = db.prepare('INSERT INTO hub_summaries (hub_path, model, content, token_count) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET content=excluded.content');

  for (const row of inboundCounts) {
    if (row.cnt > 50) {
      markHub.run(row.to_id);
      const mod = db.prepare('SELECT path FROM modules WHERE id = ?').get(row.to_id) as { path: string };
      insertSummary.run(mod.path, 'system', 'Auto-detected hub node with ' + row.cnt + ' inbound edges.', 10);
    }
  }
}

