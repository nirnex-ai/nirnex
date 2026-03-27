/**
 * Pipeline Idempotency — Execution Store
 *
 * SQLite-backed store for stage execution records.
 * The PRIMARY KEY constraint on execution_key provides atomic claim semantics:
 * exactly one orchestrator instance can claim a given execution key.
 *
 * Design constraints:
 *   - Uses better-sqlite3 (synchronous) for atomic claim/complete/fail
 *   - WAL mode should be enabled on the Database before use for concurrent access
 *   - No I/O other than SQLite — pure persistence layer
 *   - claim() is the atomic gate: returns true on success, false on conflict
 */

import type Database from 'better-sqlite3';
import type { StageExecutionRecord, StageExecutionStatus } from './types.js';

// ─── StageExecutionStore ──────────────────────────────────────────────────────

export class StageExecutionStore {
  constructor(private readonly db: InstanceType<typeof Database>) {}

  // ── Schema ───────────────────────────────────────────────────────────────

  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stage_executions (
        execution_key   TEXT PRIMARY KEY,
        stage_id        TEXT NOT NULL,
        contract_version TEXT NOT NULL,
        input_hash      TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'in_progress',
        trace_id        TEXT NOT NULL,
        request_id      TEXT NOT NULL,
        started_at      TEXT NOT NULL,
        completed_at    TEXT,
        output_json     TEXT,
        result_hash     TEXT
      );
    `);
  }

  // ── Write operations ─────────────────────────────────────────────────────

  /**
   * Atomically claim an execution key.
   * Returns true if this caller claimed the key (INSERT succeeded).
   * Returns false if the key already exists (PRIMARY KEY conflict).
   */
  claim(key: string, record: StageExecutionRecord): boolean {
    try {
      this.db.prepare(`
        INSERT INTO stage_executions
          (execution_key, stage_id, contract_version, input_hash, status,
           trace_id, request_id, started_at)
        VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?)
      `).run(
        key,
        record.stage_id,
        record.contract_version,
        record.input_hash,
        record.trace_id,
        record.request_id,
        record.started_at,
      );
      return true;
    } catch {
      // PRIMARY KEY conflict — key already claimed
      return false;
    }
  }

  /**
   * Mark a claimed execution as completed and store its output.
   */
  complete(key: string, output: unknown, resultHash: string): void {
    this.db.prepare(`
      UPDATE stage_executions
      SET status = 'completed', completed_at = ?, output_json = ?, result_hash = ?
      WHERE execution_key = ?
    `).run(new Date().toISOString(), JSON.stringify(output), resultHash, key);
  }

  /**
   * Mark a claimed execution as failed.
   */
  fail(key: string): void {
    this.db.prepare(`
      UPDATE stage_executions
      SET status = 'failed', completed_at = ?
      WHERE execution_key = ?
    `).run(new Date().toISOString(), key);
  }

  // ── Read operations ──────────────────────────────────────────────────────

  /**
   * Get any record for this key regardless of status.
   * Returns null if no record exists.
   */
  get(key: string): StageExecutionRecord | null {
    const row = this.db.prepare(
      `SELECT * FROM stage_executions WHERE execution_key = ?`,
    ).get(key) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  /**
   * Get a record only if it is in 'completed' status.
   * Returns null for missing, in_progress, or failed records.
   */
  getCompleted(key: string): StageExecutionRecord | null {
    const row = this.db.prepare(
      `SELECT * FROM stage_executions WHERE execution_key = ? AND status = 'completed'`,
    ).get(key) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): StageExecutionRecord {
  return {
    execution_key:    row['execution_key']    as string,
    stage_id:         row['stage_id']         as string,
    contract_version: row['contract_version'] as string,
    input_hash:       row['input_hash']       as string,
    status:           row['status']           as StageExecutionStatus,
    trace_id:         row['trace_id']         as string,
    request_id:       row['request_id']       as string,
    started_at:       row['started_at']       as string,
    completed_at:     row['completed_at']     as string | undefined,
    output_json:      row['output_json']      as string | undefined,
    result_hash:      row['result_hash']      as string | undefined,
  };
}
