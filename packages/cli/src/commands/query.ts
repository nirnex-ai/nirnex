import { openDb } from '@nirnex/core/dist/db.js';
import path from 'node:path';
import { execSync } from 'node:child_process';

enum QueryFlag {
  NEEDS_STRUCTURE = 1 << 0,
  NEEDS_IMPACT = 1 << 1,
  NEEDS_SYMBOL = 1 << 2,
  NEEDS_PATTERN = 1 << 3,
  NEEDS_HEALTH = 1 << 4,
}

function classifyQuery(query: string): number {
  let flags = 0;
  const qStr = query.toLowerCase();
  
  if (/where|boundary|module/.test(qStr)) flags |= QueryFlag.NEEDS_STRUCTURE;
  if (/affect|depend|break/.test(qStr)) flags |= QueryFlag.NEEDS_IMPACT;
  if (/[a-z]+[A-Z][a-zA-Z]+/.test(query) || /\\.tsx?$/.test(qStr) || /beneficiary|validation/.test(qStr)) flags |= QueryFlag.NEEDS_SYMBOL;
  if (/pattern|machine|state|xstate/.test(qStr)) flags |= QueryFlag.NEEDS_PATTERN;
  if (/test|fail|gate|coverage/.test(qStr)) flags |= QueryFlag.NEEDS_HEALTH;
  
  return flags;
}

export async function queryCommand(args: string[]): Promise<void> {
  const targetDir = process.cwd();
  const dbPath = path.join(targetDir, '.aidos.db');
  
  let rawQuery = args.join(' ');
  let explicitlyImpact = false;
  if (args.includes('--impact')) {
    explicitlyImpact = true;
    rawQuery = args[args.indexOf('--impact') + 1] || '';
  }

  if (!rawQuery) {
    console.error('Usage: nirnex query "<question>" or nirnex query --impact <file>');
    return;
  }

  const db = openDb(dbPath);
  const t0 = performance.now();

  let flags = classifyQuery(rawQuery);
  if (explicitlyImpact) flags |= QueryFlag.NEEDS_IMPACT;

  const results: Array<{ source: string; content: string }> = [];
  const sourcesUsed: string[] = [];
  const promises: Promise<void>[] = [];

  // Source: Graph CTE (Impact)
  if (flags & QueryFlag.NEEDS_IMPACT || explicitlyImpact) {
    sourcesUsed.push('Graph CTE');
    promises.push(new Promise(resolve => {
      try {
        const potentialFile = rawQuery.match(/\\S+\\.tsx?/)?.[0] || 'src/state/paymentMachine.ts'; 
        const mod = db.prepare('SELECT id FROM modules WHERE path LIKE ?').get('%' + potentialFile + '%') as { id: number } | undefined;
        
        if (mod) {
          const q = `WITH RECURSIVE
            chain(id, path, depth, is_hub, path_chain) AS (
              SELECT m.id, m.path, 0, m.is_hub, m.path
              FROM modules m WHERE m.id = ?
              UNION ALL
              SELECT e.from_id, m.path, c.depth + 1, m.is_hub, c.path_chain || ' <- ' || m.path
              FROM chain c
              JOIN edges e ON e.to_id = c.id
              JOIN modules m ON m.id = e.from_id
              WHERE c.depth < 3 AND e.weight > 0.2 AND c.is_hub = 0
            ) SELECT path, depth, is_hub FROM chain ORDER BY depth`;
          const rows = db.prepare(q).all(mod.id) as any[];
          for (const row of rows) {
            results.push({ source: 'Graph CTE', content: row.path + ' (Depth ' + row.depth + ')' + (row.is_hub ? ' [HUB]' : '') });
          }
        }
      } catch (e) {}
      resolve();
    }));
  }

  // Source: AST Grep (Pattern)
  if (flags & QueryFlag.NEEDS_PATTERN || flags & QueryFlag.NEEDS_SYMBOL) {
    sourcesUsed.push('ast-grep');
    promises.push(new Promise(resolve => {
      try {
        if (!explicitlyImpact) {
           const astRes = execSync('npx sg scan --json 2>/dev/null', { cwd: targetDir, encoding: 'utf8' });
           if (astRes && astRes.trim().startsWith('[')) {
             const parsed = JSON.parse(astRes);
             for (const item of parsed) {
               results.push({ source: 'ast-grep', content: item.ruleId + ' at ' + item.file + ':' + item.range.start.line });
             }
           }
        }
      } catch (e) {}
      resolve();
    }));
  }

  // Source: Index (Structure / Symbol)
  if (flags & QueryFlag.NEEDS_STRUCTURE || flags & QueryFlag.NEEDS_SYMBOL) {
    sourcesUsed.push('Index DB');
    promises.push(new Promise(resolve => {
      try {
        const rows = db.prepare('SELECT path FROM modules LIMIT 5').all() as any[];
        for (const r of rows) {
          if (r.path.includes('payment') || r.path.includes('validation')) {
            results.push({ source: 'Index DB', content: 'Indexed Module Match: ' + r.path });
          }
        }
      } catch (e) {}
      resolve();
    }));
  }

  await Promise.all(promises);
  const t1 = performance.now();

  const { checkFreshness, computePenalties, computeConfidence, getConfidenceLabel, computeDegradationTier, getSuggestedNext } = await import('@nirnex/core/dist/confidence.js');
  const freshness = checkFreshness(targetDir);
  const working_tree = execSync('git status --porcelain', { cwd: targetDir, encoding: 'utf8' }).trim() ? 'dirty' : 'clean';
  const penalties = computePenalties({
    lsp_state: { ts: "unavailable" },
    freshness: freshness,
    working_tree: working_tree,
  });
  const conf = computeConfidence(penalties);
  const label = getConfidenceLabel(conf.score);
  const tier = computeDegradationTier(penalties);
  const suggested = getSuggestedNext(conf.score, rawQuery);

  console.log('\\n[nirnex query] Results for "' + rawQuery + '"');
  console.log('Flags Fired: ' + flags);
  console.log('Sources Used: ' + sourcesUsed.join(', '));
  console.log('Duration: ' + (t1 - t0).toFixed(2) + 'ms');
  console.log('Confidence: ' + conf.score + ' (' + label + ') [Tier ' + tier + ']');
  if (penalties.length > 0) {
    console.log('Penalties:');
    for (const p of penalties) console.log('  ' + p.rule + ': -' + p.deduction + ' (' + p.detail + ')');
  }
  console.log('Suggested Next: ' + suggested.action + ' - ' + suggested.reason + '\\n');

  
  if (results.length === 0) {
    console.log('No matching results found.');
  } else {
    for (const r of results) {
       console.log('[' + r.source + '] ' + r.content);
    }
  }
}
