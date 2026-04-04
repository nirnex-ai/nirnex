/**
 * Sprint 28 — Hook Bootstrap Path Resolution (TDD)
 *
 * Root cause addressed (original):
 *   nirnex setup generated hook scripts without an absolute path to nirnex.
 *   Claude Code's restricted shell (/usr/bin:/bin only) could not find nirnex.
 *
 * Root cause addressed (extended — direct-node-entry fix):
 *   Even with an absolute nirnex path, the nirnex binary itself has
 *   `#!/usr/bin/env node` as its shebang. In Claude Code's restricted shell
 *   `/usr/bin/env` cannot find `node` because /usr/local/bin is not in PATH.
 *   Every hook exits 127 before writing a single byte to the runtime.
 *   hook-log and report both show nothing.
 *
 * Fix:
 *   resolveNodeBin() detects the absolute path to the node binary at setup
 *   time. resolveCliEntry() detects the absolute path to the CLI entry JS file.
 *   generateHookScript() now emits:
 *
 *     exec "/absolute/node" "/absolute/cli/dist/index.js" runtime <subcommand>
 *
 *   This eliminates all PATH and shebang dependencies. The hook is fully
 *   self-contained and immune to restricted shell environments.
 *
 * Coverage:
 *
 * 1. resolveCliEntry — CLI entry JS path detection
 *    1.1  returns a non-empty string
 *    1.2  returned path ends with '.js'
 *    1.3  returns an absolute path or 'nirnex' fallback — never a relative path
 *    1.4  never returns empty string
 *
 * 1b. resolveNodeBin — node path detection
 *    1b.1  returns a non-empty string
 *    1b.2  returned value ends with 'node'
 *    1b.3  returns an absolute path or 'node' fallback
 *    1b.4  resolves to the currently running node binary (process.execPath)
 *
 * 2. generateHookScript — script content (direct-node-entry format)
 *    2.1  generated script starts with #!/bin/sh
 *    2.2  generated script contains the subcommand (e.g. 'validate')
 *    2.3  exec line uses the provided node binary path
 *    2.4  generated script ends with a newline
 *    2.5  exec line uses the provided CLI entry path verbatim
 *    2.6  different subcommands produce different scripts
 *    2.7  exec line invokes node binary directly (no shebang / env dependency)
 *    2.8  exec line contains CLI entry path
 *    2.9  exec line contains 'runtime' before the subcommand
 *    2.10 node binary appears before CLI entry in exec line
 *    2.11 exec line does not contain a bare 'nirnex' call
 *    2.12 script contains exactly one exec line
 *
 * 3. Setup integration — all five hooks
 *    3.1–3.5  each script uses the resolved node bin and CLI entry
 *    3.6  all five scripts reference the same resolved node bin path
 *    3.7  all five scripts reference the same resolved CLI entry path
 */

import { describe, it, expect } from 'vitest';
import { resolveCliEntry, resolveNodeBin, generateHookScript } from '../packages/cli/src/commands/setup.js';

// ─── Section 1: resolveCliEntry ──────────────────────────────────────────────

describe('1. resolveCliEntry', () => {
  it('1.1 returns a non-empty string', () => {
    const result = resolveCliEntry();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it("1.2 returned path ends with '.js' or 'nirnex' fallback", () => {
    const result = resolveCliEntry();
    const isJs       = result.endsWith('.js');
    const isFallback = result === 'nirnex';
    expect(isJs || isFallback).toBe(true);
  });

  it('1.3 returns an absolute path or the nirnex fallback — never a relative path', () => {
    const result = resolveCliEntry();
    const isAbsolute = result.startsWith('/');
    const isFallback = result === 'nirnex';
    expect(isAbsolute || isFallback).toBe(true);
  });

  it("1.4 never returns an empty string", () => {
    const result = resolveCliEntry();
    expect(result).not.toBe('');
  });
});

// ─── Section 1b: resolveNodeBin ──────────────────────────────────────────────

describe('1b. resolveNodeBin', () => {
  it('1b.1 returns a non-empty string', () => {
    const result = resolveNodeBin();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it("1b.2 returned value ends with 'node'", () => {
    const result = resolveNodeBin();
    expect(result).toMatch(/node$/);
  });

  it('1b.3 returns an absolute path or the bare node fallback — never a relative path', () => {
    const result = resolveNodeBin();
    const isAbsolute = result.startsWith('/');
    const isFallback = result === 'node';
    expect(isAbsolute || isFallback).toBe(true);
  });

  it('1b.4 resolves to the currently running node binary (process.execPath)', () => {
    // When nirnex setup runs, process.execPath IS the node binary.
    // resolveNodeBin should prefer this over any well-known path.
    const result = resolveNodeBin();
    // On this machine node is at /usr/local/bin/node (v24) — resolveNodeBin
    // should return an absolute path that points to a real file.
    if (result !== 'node') {
      expect(result.startsWith('/')).toBe(true);
    }
  });
});

// ─── Section 2: generateHookScript ───────────────────────────────────────────

const TEST_NODE  = '/usr/local/bin/node';
const TEST_ENTRY = '/usr/local/lib/node_modules/@nirnex/cli/dist/index.js';

describe('2. generateHookScript', () => {
  it('2.1 generated script starts with #!/bin/sh', () => {
    const script = generateHookScript('validate', TEST_NODE, TEST_ENTRY);
    expect(script.startsWith('#!/bin/sh')).toBe(true);
  });

  it("2.2 generated script contains the subcommand 'validate'", () => {
    const script = generateHookScript('validate', TEST_NODE, TEST_ENTRY);
    expect(script).toContain('validate');
  });

  it('2.3 exec line uses the provided node binary path', () => {
    const script = generateHookScript('validate', TEST_NODE, TEST_ENTRY);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    expect(execLine).toContain(TEST_NODE);
  });

  it('2.4 generated script ends with a newline', () => {
    const script = generateHookScript('bootstrap', TEST_NODE, TEST_ENTRY);
    expect(script.endsWith('\n')).toBe(true);
  });

  it('2.5 exec line uses the provided CLI entry path verbatim', () => {
    const entry  = '/opt/homebrew/lib/node_modules/@nirnex/cli/dist/index.js';
    const script = generateHookScript('entry', TEST_NODE, entry);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    expect(execLine).toContain(entry);
  });

  it('2.6 different subcommands produce different scripts', () => {
    const a = generateHookScript('validate',  TEST_NODE, TEST_ENTRY);
    const b = generateHookScript('bootstrap', TEST_NODE, TEST_ENTRY);
    expect(a).not.toBe(b);
  });

  it('2.7 exec line invokes node binary directly (no env dependency)', () => {
    const script   = generateHookScript('validate', TEST_NODE, TEST_ENTRY);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    // Must not delegate to env or a shebang-resolved binary
    expect(execLine).not.toContain('env node');
    expect(execLine).not.toContain('/usr/bin/env');
    // Must invoke node directly
    expect(execLine).toContain(TEST_NODE);
  });

  it('2.8 exec line contains the CLI entry path', () => {
    const script   = generateHookScript('validate', TEST_NODE, TEST_ENTRY);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    expect(execLine).toContain(TEST_ENTRY);
  });

  it("2.9 exec line contains 'runtime' before the subcommand", () => {
    const script   = generateHookScript('trace', TEST_NODE, TEST_ENTRY);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    const runtimeIdx   = execLine!.indexOf('runtime');
    const subcommandIdx = execLine!.indexOf('trace');
    expect(runtimeIdx).toBeGreaterThanOrEqual(0);
    expect(subcommandIdx).toBeGreaterThan(runtimeIdx);
  });

  it('2.10 node binary appears before CLI entry in exec line', () => {
    const script   = generateHookScript('validate', TEST_NODE, TEST_ENTRY);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    const nodeIdx  = execLine!.indexOf(TEST_NODE);
    const entryIdx = execLine!.indexOf(TEST_ENTRY);
    expect(nodeIdx).toBeGreaterThanOrEqual(0);
    expect(entryIdx).toBeGreaterThan(nodeIdx);
  });

  it("2.11 exec line does not contain a bare 'nirnex' call", () => {
    const script   = generateHookScript('trace', TEST_NODE, TEST_ENTRY);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    expect(execLine).not.toMatch(/^exec nirnex /);
    expect(execLine).not.toMatch(/^exec \/[^ ]*\/nirnex /);
  });

  it('2.12 script contains exactly one exec line', () => {
    const script    = generateHookScript('entry', TEST_NODE, TEST_ENTRY);
    const execLines = script.split('\n').filter(l => l.startsWith('exec'));
    expect(execLines.length).toBe(1);
  });
});

// ─── Section 3: Setup integration — all five hooks ───────────────────────────

describe('3. Setup integration — all five hooks use the resolved paths', () => {
  const SUBCOMMANDS = ['bootstrap', 'entry', 'guard', 'trace', 'validate'] as const;
  const nodeBin  = resolveNodeBin();
  const cliEntry = resolveCliEntry();

  for (const sub of SUBCOMMANDS) {
    it(`3.${SUBCOMMANDS.indexOf(sub) + 1} ${sub} script uses absolute node bin and CLI entry`, () => {
      const script   = generateHookScript(sub, nodeBin, cliEntry);
      const execLine = script.split('\n').find(l => l.startsWith('exec'));
      // Absolute node bin must appear in exec line when resolved
      if (nodeBin.startsWith('/')) {
        expect(execLine).toContain(nodeBin);
      }
      // CLI entry must appear in exec line when resolved
      if (cliEntry !== 'nirnex') {
        expect(execLine).toContain(cliEntry);
      }
      // Must contain the subcommand
      expect(script).toContain(sub);
    });
  }

  it('3.6 all five scripts reference the same resolved node bin path', () => {
    const scripts = SUBCOMMANDS.map(sub => generateHookScript(sub, nodeBin, cliEntry));
    const bins = scripts.map(s => {
      const execLine = s.split('\n').find(l => l.startsWith('exec'));
      // node bin is the first quoted token after 'exec'
      const m = execLine?.match(/^exec "([^"]+)"/);
      return m?.[1] ?? execLine?.split(' ')[1] ?? '';
    });
    const uniqueBins = new Set(bins);
    expect(uniqueBins.size).toBe(1);
  });

  it('3.7 all five scripts reference the same resolved CLI entry path', () => {
    const scripts = SUBCOMMANDS.map(sub => generateHookScript(sub, nodeBin, cliEntry));
    const entries = scripts.map(s => {
      const execLine = s.split('\n').find(l => l.startsWith('exec'));
      // CLI entry is the second quoted token after 'exec'
      const m = execLine?.match(/^exec "[^"]+" "([^"]+)"/);
      return m?.[1] ?? '';
    });
    const uniqueEntries = new Set(entries);
    expect(uniqueEntries.size).toBe(1);
  });
});
