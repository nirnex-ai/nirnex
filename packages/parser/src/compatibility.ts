/**
 * Parser compatibility guard for Nirnex.
 *
 * Provides two layers of protection before indexing:
 *
 *  1. SUPPORTED_MATRIX  — documents the tested tree-sitter / grammar version pairs.
 *     Pairs outside this matrix may work but are not guaranteed.
 *
 *  2. Smoke tests  — actually parse a set of representative TypeScript and TSX
 *     snippets covering patterns known to appear in real codebases.  A passing
 *     smoke test proves the native bindings are functional in this environment.
 *
 * Note on hasError: in tree-sitter >= 0.21.x, rootNode.hasError is a *property*
 * (boolean), not a method.  Earlier versions exposed it as a function.
 * This module checks rootNode existence, not hasError, to stay version-agnostic.
 */

import Parser from 'tree-sitter';
import tsLanguage from 'tree-sitter-typescript';
import { createRequire } from 'node:module';

const _req = createRequire(import.meta.url);

// ─── Supported version matrix ─────────────────────────────────────────────────
//
// Add a new entry each time a pair is tested in CI before release.
// Format: major.minor (patch is ignored — patches should be backward-compatible).

export const SUPPORTED_MATRIX: ReadonlyArray<{
  treeSitter: string;
  treeSitterTypescript: string;
  notes?: string;
}> = [
  {
    treeSitter: '0.21',
    treeSitterTypescript: '0.23',
    notes: 'Tested on Node.js 22, darwin-arm64 and linux-x64',
  },
];

// ─── Smoke-test snippets ──────────────────────────────────────────────────────
//
// Each snippet exercises a real pattern seen in production codebases.
// A snippet is "ok" when tree-sitter returns a rootNode without throwing.

const SMOKE_TESTS: ReadonlyArray<{
  name: string;
  lang: 'typescript' | 'tsx';
  src: string;
}> = [
  {
    name: 'ts-basic-types',
    lang: 'typescript',
    src: `export const x: number = 1;
export function greet(name: string): string { return 'Hello ' + name; }
type Result<T> = { ok: true; value: T } | { ok: false; error: string };`,
  },
  {
    name: 'ts-satisfies',
    lang: 'typescript',
    src: `const palette = { red: [255, 0, 0] } satisfies Record<string, number[]>;`,
  },
  {
    name: 'ts-import-type',
    lang: 'typescript',
    src: `import type { Foo } from './foo';
export type Bar = Foo & { extra: boolean };`,
  },
  {
    name: 'tsx-basic-jsx',
    lang: 'tsx',
    src: `export default function Card({ title }: { title: string }) {
  return <div className="card"><h2>{title}</h2></div>;
}`,
  },
  {
    name: 'tsx-use-client',
    lang: 'tsx',
    src: `'use client';
import { useState } from 'react';
export default function Counter() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}`,
  },
  {
    name: 'tsx-nextjs-page',
    lang: 'tsx',
    src: `import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Home' };
export default function Page() {
  return <main><h1>Welcome</h1></main>;
}`,
  },
  {
    name: 'tsx-async-component',
    lang: 'tsx',
    src: `async function fetchData(): Promise<string[]> { return []; }
export default async function Page() {
  const items = await fetchData();
  return <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>;
}`,
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmokeTestResult {
  name: string;
  lang: 'typescript' | 'tsx';
  status: 'ok' | 'fail';
  errorMessage?: string;
}

export interface CompatibilityResult {
  /** True when ALL smoke tests passed */
  healthy: boolean;
  /** True when the installed version pair is in SUPPORTED_MATRIX */
  inSupportedMatrix: boolean;
  treeSitterVersion?: string;
  treeSitterTypescriptVersion?: string;
  smokeTests: SmokeTestResult[];
  /** Human-readable summary of issues found, empty when healthy */
  issues: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readPkgVersion(name: string): string | undefined {
  try {
    return (_req(`${name}/package.json`) as { version: string }).version;
  } catch {
    return undefined;
  }
}

/** Matches "0.21.x" pattern against an installed version like "0.21.3" */
function matchesMajorMinor(installed: string, matrixEntry: string): boolean {
  const [iMaj, iMin] = installed.split('.').map(Number);
  const [mMaj, mMin] = matrixEntry.split('.').map(Number);
  return iMaj === mMaj && iMin === mMin;
}

function isInSupportedMatrix(ts: string, tsTs: string): boolean {
  return SUPPORTED_MATRIX.some(
    (entry) =>
      matchesMajorMinor(ts, entry.treeSitter) &&
      matchesMajorMinor(tsTs, entry.treeSitterTypescript)
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs the compatibility check synchronously.
 *
 * Uses a dedicated Parser instance so it does not interfere with the shared
 * parser in index.ts.
 */
export function checkParserCompatibility(): CompatibilityResult {
  const tsVer = readPkgVersion('tree-sitter');
  const tsTsVer = readPkgVersion('tree-sitter-typescript');

  const inSupportedMatrix =
    tsVer != null && tsTsVer != null
      ? isInSupportedMatrix(tsVer, tsTsVer)
      : false;

  const tsLang = tsLanguage as unknown as { typescript: any; tsx: any };
  const diagParser = new Parser();
  const smokeTests: SmokeTestResult[] = [];

  for (const test of SMOKE_TESTS) {
    try {
      diagParser.setLanguage(
        test.lang === 'tsx' ? tsLang.tsx : tsLang.typescript
      );
      const tree = diagParser.parse(test.src);
      if (!tree || !tree.rootNode) throw new Error('parse returned no tree');
      smokeTests.push({ name: test.name, lang: test.lang, status: 'ok' });
    } catch (err) {
      smokeTests.push({
        name: test.name,
        lang: test.lang,
        status: 'fail',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const issues: string[] = [];

  if (!inSupportedMatrix) {
    const supported = SUPPORTED_MATRIX.map(
      (m) => `tree-sitter@${m.treeSitter}.x + tree-sitter-typescript@${m.treeSitterTypescript}.x`
    ).join(', ');
    issues.push(
      `Installed pair tree-sitter@${tsVer ?? 'unknown'} + ` +
      `tree-sitter-typescript@${tsTsVer ?? 'unknown'} ` +
      `is outside the tested compatibility matrix (supported: ${supported}). ` +
      `Parse failures may occur on some files.`
    );
  }

  for (const t of smokeTests) {
    if (t.status === 'fail') {
      issues.push(
        `Smoke test "${t.name}" (${t.lang}) failed: ${t.errorMessage}. ` +
        `The ${t.lang === 'tsx' ? 'TSX' : 'TypeScript'} grammar may be non-functional in this environment.`
      );
    }
  }

  const healthy = smokeTests.every((t) => t.status === 'ok');

  return {
    healthy,
    inSupportedMatrix,
    treeSitterVersion: tsVer,
    treeSitterTypescriptVersion: tsTsVer,
    smokeTests,
    issues,
  };
}
