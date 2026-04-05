/**
 * Stdin Transport — Unit Tests
 *
 * Tests for packages/cli/src/runtime/stdin.ts
 *
 * All tests inject a mock stream via the `stream` option — process.stdin is
 * never consumed. This keeps the test suite safe under vitest's singleFork
 * pool where stdin is shared across test files.
 *
 * Coverage:
 *   T1 — empty EOF resolves immediately with ''
 *   T2 — JSON payload with EOF resolves with the full string
 *   T3 — multi-chunk stream concatenated correctly
 *   T4 — never-EOF stream times out and resolves with null
 *   T5 — broken-pipe (stream error event) resolves with null before timeout
 *   T6 — stderr diagnostic written while waiting (silent=false)
 *   T7 — silent option suppresses stderr diagnostic
 *   T8 — parsePayloadArg extracts value after --payload flag
 *   T9 — parsePayloadArg returns null when flag is absent
 *   T10 — parsePayloadArg returns null when --payload has no following value
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import {
  readStdinWithTimeout,
  STDIN_READ_TIMEOUT_MS,
  STDIN_WAITING_MESSAGE,
} from '../packages/cli/src/runtime/stdin.js';
import { parsePayloadArg } from '../packages/cli/src/runtime/validate.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Stream that emits a list of chunks then ends immediately. */
function makeStream(chunks: string[]): Readable {
  return Readable.from(chunks);
}

/** Stream that never pushes null — simulates a process whose stdin is open forever. */
function makeHangingStream(): Readable {
  return new Readable({ read() {} });
}

// ─── T1–T3: Normal resolution ─────────────────────────────────────────────────

describe('readStdinWithTimeout — normal resolution', () => {
  it('T1: resolves with empty string when stream ends immediately with no data (empty EOF)', async () => {
    const stream = makeStream([]);
    const result = await readStdinWithTimeout({ stream, silent: true });
    expect(result).toBe('');
  });

  it('T2: resolves with JSON payload when stream sends a single chunk and closes', async () => {
    const payload = JSON.stringify({ session_id: 'sess_abc123', stop_hook_active: true });
    const stream = makeStream([payload]);
    const result = await readStdinWithTimeout({ stream, silent: true });
    expect(result).toBe(payload);
  });

  it('T3: concatenates multiple chunks into a single string before resolving', async () => {
    const stream = makeStream(['{"session', '_id":"sess_', 'split123"}']);
    const result = await readStdinWithTimeout({ stream, silent: true });
    expect(result).toBe('{"session_id":"sess_split123"}');
  });
});

// ─── T4: Never-EOF timeout ────────────────────────────────────────────────────

describe('readStdinWithTimeout — never-EOF timeout', () => {
  it('T4: resolves with null when stream never ends within the timeout window', async () => {
    const stream = makeHangingStream();
    // Use a very short timeout (50 ms) to keep the test fast.
    const result = await readStdinWithTimeout({ stream, timeoutMs: 50, silent: true });
    expect(result).toBeNull();
  });

  it('T4b: resolves with null even when stream has sent partial data before hanging', async () => {
    const stream = makeHangingStream();
    // Push some data but never end
    setImmediate(() => stream.push('{"partial":'));
    const result = await readStdinWithTimeout({ stream, timeoutMs: 50, silent: true });
    expect(result).toBeNull();
  });
});

// ─── T5: Broken-pipe / stream error ──────────────────────────────────────────

describe('readStdinWithTimeout — broken-pipe (stream error)', () => {
  it('T5: resolves with null when stream emits an EPIPE error', async () => {
    const stream = makeHangingStream();
    setImmediate(() => stream.destroy(new Error('EPIPE: broken pipe, write')));
    const result = await readStdinWithTimeout({ stream, timeoutMs: 5000, silent: true });
    expect(result).toBeNull();
  });

  it('T5b: resolves with null for any stream error, not just EPIPE', async () => {
    const stream = makeHangingStream();
    setImmediate(() => stream.destroy(new Error('read ECONNRESET')));
    const result = await readStdinWithTimeout({ stream, timeoutMs: 5000, silent: true });
    expect(result).toBeNull();
  });

  it('T5c: resolves with null before timeout fires when error is emitted early', async () => {
    const stream = makeHangingStream();
    const start = Date.now();
    // Error fires after 20 ms; timeout is 2000 ms — must resolve well before timeout.
    setTimeout(() => stream.destroy(new Error('EPIPE')), 20);
    const result = await readStdinWithTimeout({ stream, timeoutMs: 2000, silent: true });
    expect(result).toBeNull();
    expect(Date.now() - start).toBeLessThan(500);
  });
});

// ─── T6–T7: Stderr diagnostic ────────────────────────────────────────────────

describe('readStdinWithTimeout — stderr diagnostic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T6: writes a waiting message to stderr when silent is false (default)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stream = makeStream([]);
    await readStdinWithTimeout({ stream }); // silent defaults to false
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(written).toContain('[nirnex validate]');
    expect(written).toContain('stdin');
  });

  it('T7: does not write to stderr when silent is true', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stream = makeStream([]);
    await readStdinWithTimeout({ stream, silent: true });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('T6b: waiting message references the timeout duration', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stream = makeStream([]);
    await readStdinWithTimeout({ stream, timeoutMs: 5000 });
    const written = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(written).toContain('5s');
  });
});

// ─── T8–T10: parsePayloadArg ──────────────────────────────────────────────────

describe('parsePayloadArg', () => {
  it('T8: extracts the JSON string immediately following --payload', () => {
    const json = '{"session_id":"test-sess"}';
    expect(parsePayloadArg(['--payload', json])).toBe(json);
  });

  it('T8b: works when --payload is preceded by other flags', () => {
    const json = '{"session_id":"x"}';
    expect(parsePayloadArg(['--some-flag', '--payload', json])).toBe(json);
  });

  it('T9: returns null when --payload flag is absent', () => {
    expect(parsePayloadArg([])).toBeNull();
    expect(parsePayloadArg(['--other'])).toBeNull();
    expect(parsePayloadArg(['--payload-like'])).toBeNull();
  });

  it('T10: returns null when --payload is the last argument with no value following it', () => {
    expect(parsePayloadArg(['--payload'])).toBeNull();
  });

  it('T10b: treats empty-string value after --payload as null (no useful payload)', () => {
    expect(parsePayloadArg(['--payload', ''])).toBeNull();
  });
});

// ─── STDIN_READ_TIMEOUT_MS and STDIN_WAITING_MESSAGE exports ─────────────────

describe('module constants', () => {
  it('STDIN_READ_TIMEOUT_MS is a positive integer (default hook timeout)', () => {
    expect(typeof STDIN_READ_TIMEOUT_MS).toBe('number');
    expect(STDIN_READ_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(STDIN_READ_TIMEOUT_MS)).toBe(true);
  });

  it('STDIN_WAITING_MESSAGE is a non-empty string containing nirnex branding', () => {
    expect(typeof STDIN_WAITING_MESSAGE).toBe('string');
    expect(STDIN_WAITING_MESSAGE.length).toBeGreaterThan(0);
    expect(STDIN_WAITING_MESSAGE).toContain('[nirnex');
  });
});
