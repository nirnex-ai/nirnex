/**
 * TraceBinder — Deterministic trace records for each stage execution
 *
 * Design constraints:
 *   - hashInputs must be deterministic: same input → same hash
 *   - Timestamps are ISO 8601 strings
 *   - durationMs is measured from execution start
 *   - No filesystem I/O — trace records are plain objects returned to caller
 */

import type { StageId, BoundTrace } from "./types.js";

// ─── hashInputs ───────────────────────────────────────────────────────────────

/**
 * Produces a deterministic hex-like hash string from an arbitrary input.
 * Uses JSON serialisation + a simple djb2-inspired hash for zero dependencies.
 * Same input → same output, always.
 */
export function hashInputs(input: unknown): string {
  const serialised = stableStringify(input);
  return djb2Hash(serialised);
}

// ─── bindTrace ────────────────────────────────────────────────────────────────

/**
 * Create a BoundTrace record for a stage execution.
 *
 * @param stage   - which stage produced this trace
 * @param input   - the input passed to the stage handler (may be undefined on failure)
 * @param output  - the output from the handler (may be undefined on failure)
 * @param status  - result status
 * @param error   - optional error when status is not 'ok'
 * @param startAt - optional high-res timestamp to compute duration (Date.now() ms)
 */
export function bindTrace(
  stage: StageId,
  input: unknown,
  output: unknown,
  status: BoundTrace["status"],
  error?: Error,
  startAt?: number,
): BoundTrace {
  const now = Date.now();
  const durationMs = startAt !== undefined ? Math.max(0, now - startAt) : 0;

  const trace: BoundTrace = {
    stage,
    status,
    inputHash: hashInputs(input),
    timestamp: new Date(now).toISOString(),
    durationMs,
    input,
    output,
  };

  if (error) {
    trace.errorMessage = error.message;
  }

  return trace;
}

// Re-export BoundTrace type for convenience
export type { BoundTrace };

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Stable JSON stringify — sorts object keys so that { b:1, a:2 } and { a:2, b:1 }
 * produce the same string. Arrays preserve order.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value as object).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]));
  return "{" + pairs.join(",") + "}";
}

/**
 * djb2-inspired 32-bit hash, returned as a zero-padded 8-char hex string.
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}
