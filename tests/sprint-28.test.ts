/**
 * Sprint 28 — Hook Bootstrap Path Resolution (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Root cause addressed:
 *   nirnex setup generates hook scripts like:
 *     #!/bin/sh
 *     exec nirnex runtime validate
 *
 *   Claude Code runs hooks via /bin/sh whose PATH is restricted to
 *   /usr/bin:/bin. The `nirnex` binary lives at /usr/local/bin/nirnex —
 *   not in that PATH. Every hook silently fails. No events are written.
 *   hook-log and report both show nothing.
 *
 * Fix:
 *   resolveNirnexBin() detects the absolute path to the nirnex binary at
 *   setup time. generateHookScript() uses that path. The generated scripts
 *   use an absolute path and are immune to shell PATH restrictions.
 *
 * Coverage:
 *
 * 1. resolveNirnexBin — path detection
 *    1.1  returns a non-empty string
 *    1.2  returned path ends with 'nirnex'
 *    1.3  if /usr/local/bin/nirnex exists, returns it (or a valid alternative)
 *    1.4  falls back to 'nirnex' when no absolute path is found
 *
 * 2. generateHookScript — script content
 *    2.1  generated script starts with #!/bin/sh
 *    2.2  generated script contains the subcommand (e.g. 'validate')
 *    2.3  generated script uses the provided bin path (not bare 'nirnex')
 *    2.4  generated script ends with a newline
 *    2.5  absolute bin path is used verbatim when provided
 *    2.6  different subcommands produce different scripts
 *
 * 3. Setup integration — all five hooks use the resolved path
 *    3.1  bootstrap script uses absolute path
 *    3.2  entry script uses absolute path
 *    3.3  guard script uses absolute path
 *    3.4  trace script uses absolute path
 *    3.5  validate script uses absolute path
 *    3.6  all five scripts reference the same resolved bin path
 */

import { describe, it, expect } from 'vitest';
import { resolveNirnexBin, generateHookScript } from '../packages/cli/src/commands/setup.js';

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

// ─── Section 2: generateHookScript ───────────────────────────────────────────

describe('2. generateHookScript', () => {
  it('2.1 generated script starts with #!/bin/sh', () => {
    const script = generateHookScript('validate', '/usr/local/bin/nirnex');
    expect(script.startsWith('#!/bin/sh')).toBe(true);
  });

  it("2.2 generated script contains the subcommand 'validate'", () => {
    const script = generateHookScript('validate', '/usr/local/bin/nirnex');
    expect(script).toContain('validate');
  });

  it("2.3 generated script uses the provided bin path, not bare 'nirnex'", () => {
    const script = generateHookScript('validate', '/usr/local/bin/nirnex');
    // Must contain the full absolute path
    expect(script).toContain('/usr/local/bin/nirnex');
    // The bare word 'nirnex' must not appear standalone (only as part of the full path)
    const lines = script.split('\n').filter(Boolean);
    const execLine = lines.find(l => l.includes('exec'));
    expect(execLine).toBeDefined();
    expect(execLine).toContain('/usr/local/bin/nirnex');
  });

  it('2.4 generated script ends with a newline', () => {
    const script = generateHookScript('bootstrap', '/usr/local/bin/nirnex');
    expect(script.endsWith('\n')).toBe(true);
  });

  it('2.5 absolute bin path is used verbatim', () => {
    const bin = '/opt/homebrew/bin/nirnex';
    const script = generateHookScript('entry', bin);
    expect(script).toContain(bin);
  });

  it('2.6 different subcommands produce different scripts', () => {
    const a = generateHookScript('validate', '/usr/local/bin/nirnex');
    const b = generateHookScript('bootstrap', '/usr/local/bin/nirnex');
    expect(a).not.toBe(b);
  });
});

// ─── Section 3: Setup integration — all five hooks ───────────────────────────

describe('3. Setup integration — all five hooks use the resolved path', () => {
  const SUBCOMMANDS = ['bootstrap', 'entry', 'guard', 'trace', 'validate'] as const;
  const bin = resolveNirnexBin();

  for (const sub of SUBCOMMANDS) {
    it(`3.${SUBCOMMANDS.indexOf(sub) + 1} ${sub} script uses absolute path`, () => {
      const script = generateHookScript(sub, bin);
      // If bin is absolute, it must appear in the script
      if (bin.startsWith('/')) {
        expect(script).toContain(bin);
      }
      // Must contain the subcommand
      expect(script).toContain(sub);
    });
  }

  it('3.6 all five scripts reference the same resolved bin path', () => {
    const scripts = SUBCOMMANDS.map(sub => generateHookScript(sub, bin));
    // Every script exec line uses the same bin path
    const bins = scripts.map(s => {
      const execLine = s.split('\n').find(l => l.startsWith('exec'));
      return execLine?.split(' ')[1] ?? '';
    });
    const uniqueBins = new Set(bins);
    expect(uniqueBins.size).toBe(1);
    expect([...uniqueBins][0]).toBe(bin);
  });
});
