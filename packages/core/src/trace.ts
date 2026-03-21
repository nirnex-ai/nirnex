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

export function readTrace(targetDir: string, id: string) { return {}; }
export function listTraces(targetDir: string) { return []; }
