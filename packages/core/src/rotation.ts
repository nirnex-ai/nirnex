import fs from 'fs';
import path from 'path';

export function rotateTraces(targetDir: string) {
  const rootDir = path.join(targetDir, '.ai-index', 'traces');
  if (!fs.existsSync(rootDir)) return;
  const archiveDir = path.join(rootDir, 'archive');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  
  const now = Date.now();
  const days30 = 30 * 24 * 60 * 60 * 1000;
  const days90 = 90 * 24 * 60 * 60 * 1000;
  
  for (const item of fs.readdirSync(rootDir)) {
    if (item === 'archive' || !fs.statSync(path.join(rootDir, item)).isDirectory()) continue;
    
    const [y, m, d] = item.split('-');
    if (y && m && d) {
       const dirDate = new Date(y + '-' + m + '-' + d).getTime();
       if (now - dirDate > days30) {
          const targetArchive = path.join(archiveDir, item);
          fs.renameSync(path.join(rootDir, item), targetArchive);
       }
    }
  }
  
  for (const item of fs.readdirSync(archiveDir)) {
    const [y, m, d] = item.split('-');
    if (y && m && d) {
       const dirDate = new Date(y + '-' + m + '-' + d).getTime();
       if (now - dirDate > days90) {
          fs.rmSync(path.join(archiveDir, item), { recursive: true, force: true });
       }
    }
  }
}
