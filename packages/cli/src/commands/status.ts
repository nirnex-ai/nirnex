// Command: dev status
// Reads the local .ai-delivery-os.db (or path from AIDOS_DB env var)
// and prints a one-line index summary.

import { openDb, indexStats } from '@ai-delivery-os/core';
import path from 'node:path';
import { existsSync } from 'node:fs';

export function statusCommand(args: string[]): void {
  // Resolve db path: flag --db <path> > env var > cwd default
  let dbPath: string | undefined;

  const dbFlagIdx = args.indexOf('--db');
  if (dbFlagIdx !== -1 && args[dbFlagIdx + 1]) {
    dbPath = args[dbFlagIdx + 1];
  } else if (process.env['AIDOS_DB']) {
    dbPath = process.env['AIDOS_DB'];
  } else {
    dbPath = path.join(process.cwd(), '.aidos.db');
  }

  const isNew = !existsSync(dbPath);
  const db = openDb(dbPath);
  const stats = indexStats(db);
  db.close();

  if (isNew || stats.moduleCount === 0) {
    console.log(
      `index empty, ${stats.moduleCount} modules, ${stats.edgeCount} edges  [db: ${dbPath}]`
    );
  } else {
    console.log(
      `index ok — ${stats.moduleCount} modules, ${stats.edgeCount} edges, schema v${stats.schemaVersion}  [db: ${dbPath}]`
    );
  }
}
