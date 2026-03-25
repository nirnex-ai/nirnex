// Command: nirnex update
// Checks npm for a newer version of @nirnex/cli and installs it if one exists.

import https from 'node:https';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const PACKAGE_NAME = '@nirnex/cli';

function getCurrentVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../../package.json') as { version: string };
  return pkg.version;
}

function fetchLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
    https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { version?: string };
          if (!parsed.version) {
            reject(new Error('Unexpected registry response — no version field'));
          } else {
            resolve(parsed.version);
          }
        } catch {
          reject(new Error('Failed to parse registry response'));
        }
      });
    }).on('error', reject);
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function updateCommand(_args: string[]): Promise<void> {
  const current = getCurrentVersion();
  process.stdout.write(`  Current version : ${current}\n`);
  process.stdout.write(`  Checking npm for latest ${PACKAGE_NAME}...\n`);

  let latest: string;
  try {
    latest = await fetchLatestVersion();
  } catch (e) {
    process.stderr.write(`  \x1b[31m✖\x1b[0m Could not reach npm registry: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }

  process.stdout.write(`  Latest version  : ${latest}\n\n`);

  if (compareVersions(latest, current) <= 0) {
    process.stdout.write(`  \x1b[32m✔\x1b[0m Already up to date.\n\n`);
    return;
  }

  process.stdout.write(`  \x1b[33m↑\x1b[0m New version available: \x1b[1m${current}\x1b[0m → \x1b[1m${latest}\x1b[0m\n`);
  process.stdout.write(`  Running: npm install -g ${PACKAGE_NAME}@${latest}\n\n`);

  try {
    execSync(`npm install -g ${PACKAGE_NAME}@${latest}`, { stdio: 'inherit' });
    process.stdout.write(`\n  \x1b[32m✔\x1b[0m Updated to \x1b[1m${latest}\x1b[0m\n\n`);
  } catch {
    process.stderr.write(`  \x1b[31m✖\x1b[0m Update failed. Try manually:\n`);
    process.stderr.write(`    npm install -g ${PACKAGE_NAME}@latest\n\n`);
    process.exit(1);
  }
}
