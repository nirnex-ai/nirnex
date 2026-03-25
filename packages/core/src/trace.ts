import fs from 'fs';
import path from 'path';

export function getTraceId(dateStr: string) {
  const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
  const rHex = Math.random().toString(16).slice(2, 6);
  return 'tr_' + dateStr.replace(/-/g, '') + '_' + time + '_' + rHex;
}

export function writeTrace(targetDir: string, data: any) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateStr = y + '-' + m + '-' + day;
  const dir = path.join(targetDir, '.ai-index', 'traces', dateStr);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  if (!data.trace_id) {
    data.trace_id = getTraceId(dateStr);
  }
  
  fs.writeFileSync(path.join(dir, data.trace_id + '.json'), JSON.stringify(data, null, 2));
  return data.trace_id;
}

export function readTrace(targetDir: string, id: string): Record<string, unknown> | null {
  // Scan all date subdirs for the trace file
  const tracesRoot = path.join(targetDir, '.ai-index', 'traces');
  if (!fs.existsSync(tracesRoot)) return null;

  for (const dateDir of fs.readdirSync(tracesRoot)) {
    const p = path.join(tracesRoot, dateDir, `${id}.json`);
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface TraceListEntry {
  trace_id: string;
  timestamp: string;
  date: string;
  intent?: string;
  confidence_score?: number;
  lane?: string;
}

export function listTraces(targetDir: string, limit = 20): TraceListEntry[] {
  const tracesRoot = path.join(targetDir, '.ai-index', 'traces');
  if (!fs.existsSync(tracesRoot)) return [];

  const results: TraceListEntry[] = [];

  // Walk date dirs newest-first
  const dateDirs = fs.readdirSync(tracesRoot).sort().reverse();
  for (const dateDir of dateDirs) {
    const dir = path.join(tracesRoot, dateDir);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
    } catch {
      continue;
    }

    for (const file of files) {
      if (results.length >= limit) break;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Record<string, any>;
        results.push({
          trace_id: raw.trace_id ?? file.replace('.json', ''),
          timestamp: raw.timestamp ?? dateDir,
          date: dateDir,
          intent: raw.intent?.primary ?? raw.eco?.intent?.primary,
          confidence_score: raw.confidence?.score ?? raw.eco?.confidence_score,
          lane: raw.eco?.recommended_lane,
        });
      } catch {
        // Skip malformed files
      }
    }

    if (results.length >= limit) break;
  }

  return results;
}
