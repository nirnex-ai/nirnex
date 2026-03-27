/**
 * Runtime Ledger — Read Path
 *
 * Provides query helpers for audit, debug, and timeline reconstruction.
 *
 * Design constraints:
 *   - Read-only: no mutations
 *   - All results are fully deserialized (payload_json → payload object)
 *   - fetchOutcome returns latest by timestamp (multiple outcomes allowed — latest wins)
 *   - Superseded outcomes remain in the ledger (append-only policy)
 *   - buildTimeline is ordered ASC by timestamp (authoritative audit order)
 */

import Database from 'better-sqlite3';
import type { LedgerEntry, LedgerStage } from './types.js';

// ─── Row → LedgerEntry deserialization ────────────────────────────────────────

interface LedgerRow {
  ledger_id:           string;
  request_id:          string;
  trace_id:            string;
  parent_ledger_id:    string | null;
  tee_id:              string | null;
  stage:               string;
  record_type:         string;
  actor:               string;
  timestamp:           string;
  schema_version:      string;
  payload_json:        string;
  supersedes_entry_id: string | null;
}

function deserializeRow(row: LedgerRow): LedgerEntry {
  return {
    schema_version:      row.schema_version as LedgerEntry['schema_version'],
    ledger_id:           row.ledger_id,
    trace_id:            row.trace_id,
    request_id:          row.request_id,
    parent_ledger_id:    row.parent_ledger_id ?? undefined,
    tee_id:              row.tee_id ?? undefined,
    stage:               row.stage as LedgerStage,
    record_type:         row.record_type as LedgerEntry['record_type'],
    actor:               row.actor as LedgerEntry['actor'],
    timestamp:           row.timestamp,
    payload:             JSON.parse(row.payload_json),
    supersedes_entry_id: row.supersedes_entry_id ?? undefined,
  };
}

// ─── LedgerReader ─────────────────────────────────────────────────────────────

export class LedgerReader {
  constructor(private readonly db: Database.Database) {}

  /**
   * All records for a trace, ordered by timestamp ASC.
   * Use this to reconstruct what happened during a single execution.
   */
  fetchByTraceId(traceId: string): LedgerEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM ledger_entries WHERE trace_id = ? ORDER BY timestamp ASC`)
      .all(traceId) as LedgerRow[];
    return rows.map(deserializeRow);
  }

  /**
   * All override records for a request_id, across all traces.
   * Overrides span traces (a retry may carry overrides from the original request).
   */
  fetchOverrides(requestId: string): LedgerEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM ledger_entries WHERE request_id = ? AND record_type = 'override' ORDER BY timestamp ASC`)
      .all(requestId) as LedgerRow[];
    return rows.map(deserializeRow);
  }

  /**
   * Terminal outcome record for a trace.
   *
   * Policy: multiple outcomes are allowed per trace (e.g. a retry supersedes a prior
   * outcome). Returns the latest by timestamp. Superseded records remain in the ledger.
   *
   * Returns null if no outcome record exists for the trace.
   */
  fetchOutcome(traceId: string): LedgerEntry | null {
    const row = this.db
      .prepare(
        `SELECT * FROM ledger_entries WHERE trace_id = ? AND record_type = 'outcome'
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get(traceId) as LedgerRow | undefined;
    return row ? deserializeRow(row) : null;
  }

  /**
   * Ordered audit timeline for a trace — all records sorted by timestamp ASC.
   * Equivalent to fetchByTraceId but semantically scoped to audit reconstruction.
   */
  buildTimeline(traceId: string): LedgerEntry[] {
    return this.fetchByTraceId(traceId);
  }

  /**
   * All records for a specific stage within a trace, ordered by timestamp ASC.
   */
  fetchByStage(traceId: string, stage: LedgerStage): LedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ledger_entries WHERE trace_id = ? AND stage = ? ORDER BY timestamp ASC`
      )
      .all(traceId, stage) as LedgerRow[];
    return rows.map(deserializeRow);
  }

  /**
   * All refusal records for a request_id (across all traces).
   */
  fetchRefusals(requestId: string): LedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ledger_entries WHERE request_id = ? AND record_type = 'refusal' ORDER BY timestamp ASC`
      )
      .all(requestId) as LedgerRow[];
    return rows.map(deserializeRow);
  }

  /**
   * All confidence_snapshot records for a trace, ordered by snapshot_index ASC.
   *
   * Returns only 'confidence_snapshot' record_type entries.
   * Use this to reconstruct the full confidence evolution timeline for a trace.
   */
  fetchConfidenceTimeline(traceId: string): LedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ledger_entries WHERE trace_id = ? AND record_type = 'confidence_snapshot'
         ORDER BY CAST(json_extract(payload_json, '$.snapshot_index') AS INTEGER) ASC`
      )
      .all(traceId) as LedgerRow[];
    return rows.map(deserializeRow);
  }

  /**
   * The most recent confidence_snapshot for a trace (highest snapshot_index).
   *
   * Returns null if no confidence snapshots exist for the trace.
   */
  fetchLatestConfidenceSnapshot(traceId: string): LedgerEntry | null {
    const row = this.db
      .prepare(
        `SELECT * FROM ledger_entries WHERE trace_id = ? AND record_type = 'confidence_snapshot'
         ORDER BY CAST(json_extract(payload_json, '$.snapshot_index') AS INTEGER) DESC LIMIT 1`
      )
      .get(traceId) as LedgerRow | undefined;
    return row ? deserializeRow(row) : null;
  }

  /**
   * All replay_material entries for a trace, ordered by timestamp ASC.
   *
   * Returns only 'replay_material' record_type entries.
   * Use this to load the captured stage materials needed for run reconstruction.
   */
  fetchReplayMaterials(traceId: string): LedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ledger_entries WHERE trace_id = ? AND record_type = 'replay_material'
         ORDER BY timestamp ASC`
      )
      .all(traceId) as LedgerRow[];
    return rows.map(deserializeRow);
  }
}
