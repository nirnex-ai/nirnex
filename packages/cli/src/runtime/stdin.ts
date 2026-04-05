// Stdin transport helper for the validate (Stop) hook handler.
//
// readStdinWithTimeout() replaces the original bare readStdin() to address two
// failure modes identified in production:
//
//   1. Never-EOF hang — when invoked outside the Claude hook transport (manual
//      invocation, debugging), stdin never closes and the process blocks forever.
//      The timeout bounds this to a configurable window and resolves with null.
//
//   2. Broken-pipe — if the hook runner crashes before closing the write-end of
//      the pipe, the stream emits 'error'. The error handler resolves with null
//      so the caller can emit a structured STDIN_READ_TIMEOUT event rather than
//      crashing silently.
//
// Both null paths produce an explicit STDIN_READ_TIMEOUT block decision in
// validate.ts — distinguishable from a real governance block by reason code.

/** Default stdin read timeout — matches the Stop hook's configured timeout (30s). */
export const STDIN_READ_TIMEOUT_MS = 30_000;

/**
 * Stderr message written before blocking on stdin.
 * Visible to any operator watching the process, making "waiting for input"
 * immediately distinguishable from a silent hang or validator deadlock.
 */
export const STDIN_WAITING_MESSAGE =
  '[nirnex validate] Waiting for hook payload on stdin (30s timeout)...\n';

/**
 * Minimal interface covering the event API used internally.
 * Using a local interface instead of the full `Readable | NodeJS.ReadableStream`
 * union avoids TypeScript's inability to reconcile their incompatible `.on()`
 * overload signatures — both concrete types satisfy this interface at runtime.
 */
interface StdinLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  setEncoding?: (encoding: BufferEncoding) => void;
}

export interface StdinOpts {
  /** Read timeout in milliseconds. Defaults to STDIN_READ_TIMEOUT_MS (30s). */
  timeoutMs?: number;
  /**
   * Readable stream to consume. Defaults to process.stdin.
   * Inject a mock stream in tests to avoid consuming the real stdin.
   */
  stream?: StdinLike;
  /**
   * When true, suppresses the stderr waiting diagnostic.
   * Set to true in tests that don't want stderr noise.
   */
  silent?: boolean;
}

/**
 * Reads a stream to completion with a timeout.
 *
 * Returns the accumulated UTF-8 string on success (including empty string for
 * an immediately-closed stream — valid empty hook payload).
 *
 * Returns null on:
 *   - timeout (stream never emitted 'end' within timeoutMs)
 *   - stream error (broken pipe, ECONNRESET, etc.)
 *
 * The caller is responsible for treating null as an unsupported invocation mode
 * and emitting a structured STDIN_READ_TIMEOUT event.
 */
export function readStdinWithTimeout(opts: StdinOpts = {}): Promise<string | null> {
  const {
    timeoutMs = STDIN_READ_TIMEOUT_MS,
    stream = process.stdin as StdinLike,
    silent = false,
  } = opts;

  return new Promise<string | null>(resolve => {
    if (!silent) {
      const seconds = Math.round(timeoutMs / 1000);
      process.stderr.write(
        `[nirnex validate] Waiting for hook payload on stdin (${seconds}s timeout)...\n`,
      );
    }

    let buf = '';
    let settled = false;

    const settle = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      resolve(value);
    };

    const timer = setTimeout(() => settle(null), timeoutMs);

    const onData = (chunk: string | Buffer): void => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    };

    const onEnd = (): void => settle(buf);

    const onError = (): void => settle(null);

    stream.setEncoding?.('utf8');
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}
