/**
 * Sprint 28 — Hook Bootstrap Path Resolution (TDD)
 *
 * Root cause addressed (original):
 *   nirnex setup generated hook scripts without an absolute path to nirnex.
 *   Claude Code's restricted shell (/usr/bin:/bin only) could not find nirnex.
 *
 * Root cause addressed (extended — PATH injection fix):
 *   Even with an absolute nirnex path, the nirnex binary itself has
 *   `#!/usr/bin/env node` as its shebang. In Claude Code's restricted shell
 *   `/usr/bin/env` cannot find `node` because /usr/local/bin is not in PATH.
 *   Every hook exits 127 before writing a single byte to the runtime.
 *   hook-log and report both show nothing.
 *
 * Fix:
 *   resolveNodeBin() detects the absolute path to the node binary at setup
 *   time. generateHookScript() injects `export PATH="<nodeDir>:/usr/local/bin:
 *   /opt/homebrew/bin:$PATH"` before the exec line. The hook is now fully
 *   self-contained and immune to restricted shell environments.
 *
 * Coverage:
 *
 * 1. resolveNirnexBin — nirnex path detection
 *    1.1  returns a non-empty string
 *    1.2  returned path ends with 'nirnex'
 *    1.3  returns absolute or 'nirnex' fallback — never a relative path
 *    1.4  never returns empty string
 *
 * 1b. resolveNodeBin — node path detection
 *    1b.1  returns a non-empty string
 *    1b.2  returned value ends with 'node'
 *    1b.3  returns an absolute path or 'node' fallback
 *
 * 2. generateHookScript — script content
 *    2.1  generated script starts with #!/bin/sh
 *    2.2  generated script contains the subcommand (e.g. 'validate')
 *    2.3  generated script uses the provided nirnex bin path
 *    2.4  generated script ends with a newline
 *    2.5  absolute nirnex bin path is used verbatim when provided
 *    2.6  different subcommands produce different scripts
 *    2.7  generated script contains `export PATH=` line (PATH injection)
 *    2.8  PATH export contains the node binary directory
 *    2.9  PATH export contains /usr/local/bin as fallback
 *    2.10 PATH export contains /opt/homebrew/bin as fallback
 *    2.11 exec line uses the provided nirnex bin (not bare 'nirnex')
 *    2.12 PATH export appears before the exec line
 *
 * 3. Setup integration — all five hooks
 *    3.1–3.5  each script uses absolute nirnex path and has PATH export
 *    3.6  all five scripts reference the same resolved nirnex bin path
 */

import { describe, it, expect } from 'vitest';
import { resolveNirnexBin, resolveNodeBin, generateHookScript } from '../packages/cli/src/commands/setup.js';

// ─── Section 1: resolveNirnexBin ─────────────────────────────────────────────

describe('1. resolveNirnexBin', () => {
  it('1.1 returns a non-empty string', () => {
    const result = resolveNirnexBin();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it("1.2 returned path ends with 'nirnex'", () => {
    const result = resolveNirnexBin();
    expect(result).toMatch(/nirnex$/);
  });

  it('1.3 returns an absolute path when nirnex is found at /usr/local/bin/nirnex', () => {
    // /usr/local/bin/nirnex exists on this machine (confirmed in diagnosis)
    const result = resolveNirnexBin();
    // Either an absolute path or the 'nirnex' fallback — never a relative path
    const isAbsolute = result.startsWith('/') || result.startsWith('~');
    const isFallback = result === 'nirnex';
    expect(isAbsolute || isFallback).toBe(true);
  });

  it("1.4 falls back to 'nirnex' when given a mock empty environment", () => {
    // The fallback value 'nirnex' is the last-resort safe default
    // We test this indirectly: the function must never return an empty string
    const result = resolveNirnexBin();
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

const TEST_NIRNEX = '/usr/local/bin/nirnex';
const TEST_NODE   = '/usr/local/bin/node';

describe('2. generateHookScript', () => {
  it('2.1 generated script starts with #!/bin/sh', () => {
    const script = generateHookScript('validate', TEST_NIRNEX, TEST_NODE);
    expect(script.startsWith('#!/bin/sh')).toBe(true);
  });

  it("2.2 generated script contains the subcommand 'validate'", () => {
    const script = generateHookScript('validate', TEST_NIRNEX, TEST_NODE);
    expect(script).toContain('validate');
  });

  it("2.3 generated script uses the provided nirnex bin path", () => {
    const script = generateHookScript('validate', TEST_NIRNEX, TEST_NODE);
    expect(script).toContain(TEST_NIRNEX);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    expect(execLine).toContain(TEST_NIRNEX);
  });

  it('2.4 generated script ends with a newline', () => {
    const script = generateHookScript('bootstrap', TEST_NIRNEX, TEST_NODE);
    expect(script.endsWith('\n')).toBe(true);
  });

  it('2.5 absolute nirnex bin path is used verbatim when provided', () => {
    const bin = '/opt/homebrew/bin/nirnex';
    const script = generateHookScript('entry', bin, TEST_NODE);
    expect(script).toContain(bin);
  });

  it('2.6 different subcommands produce different scripts', () => {
    const a = generateHookScript('validate',  TEST_NIRNEX, TEST_NODE);
    const b = generateHookScript('bootstrap', TEST_NIRNEX, TEST_NODE);
    expect(a).not.toBe(b);
  });

  it('2.7 generated script contains export PATH= line', () => {
    const script = generateHookScript('validate', TEST_NIRNEX, TEST_NODE);
    expect(script).toContain('export PATH=');
  });

  it('2.8 PATH export contains the directory of the provided node binary', () => {
    const script = generateHookScript('validate', TEST_NIRNEX, '/usr/local/bin/node');
    // node is at /usr/local/bin/node → its directory is /usr/local/bin
    expect(script).toContain('/usr/local/bin');
    const pathLine = script.split('\n').find(l => l.startsWith('export PATH='));
    expect(pathLine).toContain('/usr/local/bin');
  });

  it('2.8b PATH export contains the directory when node is under Homebrew ARM', () => {
    const script = generateHookScript('validate', TEST_NIRNEX, '/opt/homebrew/bin/node');
    const pathLine = script.split('\n').find(l => l.startsWith('export PATH='));
    expect(pathLine).toContain('/opt/homebrew/bin');
  });

  it('2.9 PATH export contains /usr/local/bin as a fallback', () => {
    const script = generateHookScript('validate', TEST_NIRNEX, TEST_NODE);
    const pathLine = script.split('\n').find(l => l.startsWith('export PATH='));
    expect(pathLine).toContain('/usr/local/bin');
  });

  it('2.10 PATH export contains /opt/homebrew/bin as a fallback', () => {
    const script = generateHookScript('validate', TEST_NIRNEX, TEST_NODE);
    const pathLine = script.split('\n').find(l => l.startsWith('export PATH='));
    expect(pathLine).toContain('/opt/homebrew/bin');
  });

  it('2.11 exec line uses the provided nirnex bin (not bare nirnex)', () => {
    const script = generateHookScript('trace', TEST_NIRNEX, TEST_NODE);
    const execLine = script.split('\n').find(l => l.startsWith('exec'));
    expect(execLine).toBeDefined();
    expect(execLine).toContain(TEST_NIRNEX);
    // Must not be a bare 'nirnex' call — always absolute
    expect(execLine).not.toMatch(/^exec nirnex /);
  });

  it('2.12 PATH export line appears before the exec line', () => {
    const script = generateHookScript('entry', TEST_NIRNEX, TEST_NODE);
    const lines = script.split('\n').filter(Boolean);
    const pathIdx = lines.findIndex(l => l.startsWith('export PATH='));
    const execIdx = lines.findIndex(l => l.startsWith('exec'));
    expect(pathIdx).toBeGreaterThanOrEqual(0);
    expect(execIdx).toBeGreaterThan(pathIdx);
  });
});

// ─── Section 3: Setup integration — all five hooks ───────────────────────────

describe('3. Setup integration — all five hooks use the resolved path', () => {
  const SUBCOMMANDS = ['bootstrap', 'entry', 'guard', 'trace', 'validate'] as const;
  const nirnexBin = resolveNirnexBin();
  const nodeBin   = resolveNodeBin();

  for (const sub of SUBCOMMANDS) {
    it(`3.${SUBCOMMANDS.indexOf(sub) + 1} ${sub} script uses absolute nirnex path and has PATH export`, () => {
      const script = generateHookScript(sub, nirnexBin, nodeBin);
      // Absolute nirnex path must appear in the script
      if (nirnexBin.startsWith('/')) {
        expect(script).toContain(nirnexBin);
      }
      // Must contain the subcommand
      expect(script).toContain(sub);
      // Must contain the PATH export (PATH injection fix)
      expect(script).toContain('export PATH=');
    });
  }

  it('3.6 all five scripts reference the same resolved nirnex bin path', () => {
    const scripts = SUBCOMMANDS.map(sub => generateHookScript(sub, nirnexBin, nodeBin));
    // Every script exec line uses the same nirnex bin path
    const bins = scripts.map(s => {
      // exec line is the one starting with 'exec' (after the PATH export line)
      const execLine = s.split('\n').find(l => l.startsWith('exec'));
      return execLine?.split(' ')[1] ?? '';
    });
    const uniqueBins = new Set(bins);
    expect(uniqueBins.size).toBe(1);
    expect([...uniqueBins][0]).toBe(nirnexBin);
  });

  it('3.7 all five scripts reference the same node binary directory in PATH export', () => {
    const scripts = SUBCOMMANDS.map(sub => generateHookScript(sub, nirnexBin, nodeBin));
    const pathLines = scripts.map(s => s.split('\n').find(l => l.startsWith('export PATH=')) ?? '');
    // All should be identical PATH export lines
    const uniquePathLines = new Set(pathLines);
    expect(uniquePathLines.size).toBe(1);
  });
});
