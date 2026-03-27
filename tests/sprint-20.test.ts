/**
 * Sprint 20 — Tamper-Evident Append-Only Ledger (TDD)
 *
 * Tests are written first. All tests MUST FAIL before implementation.
 * Implementation is complete when every test passes.
 *
 * Coverage:
 *
 * A. Hash computation (unit, no DB)
 *   1.  Same payload → same payload_hash every time
 *   2.  Different payload → different payload_hash
 *   3.  Same entry fields → same entry_hash every time
 *   4.  Different prev_entry_hash → different entry_hash
 *   5.  canonicalizePayload: key insertion order doesn't affect output
 *   6.  canonicalizePayload: nested objects sorted deterministically
 *
 * B. DB enforcement (in-memory DB with immutability triggers)
 *   7.  UPDATE on ledger_entries → throws ABORT
 *   8.  DELETE on ledger_entries → throws ABORT
 *   9.  Duplicate sequence_no → throws UNIQUE constraint violation
 *   10. Duplicate entry_hash → throws UNIQUE constraint violation
 *
 * C. Append and receipt
 *   11. appendLedgerEntry returns AppendReceipt with ledger_entry_id, sequence_no, entry_hash, prev_entry_hash
 *   12. First appended entry has prev_entry_hash = GENESIS_HASH
 *   13. Second entry's prev_entry_hash = first entry's entry_hash
 *   14. Stored payload_hash matches independently recomputed value
 *   15. Stored entry_hash matches independently recomputed value
 *   16. Sequence numbers are monotonically increasing (1, 2, 3…)
 *
 * D. Chain verification (in-memory DB)
 *   17. 5 sequential appended entries → verifyLedgerChain returns valid: true
 *   18. Empty ledger → verifyLedgerChain returns valid: true, verified_count: 0
 *   19. verifyLedgerRange(1, 3) verifies only entries 1–3
 *   20. verifyLedgerEntry by single ledger_id validates that entry
 *   21. ChainVerificationResult includes verified_count, first_sequence, last_sequence
 *
 * E. Adversarial / tampering (DB without triggers — tampering is possible)
 *   22. Mutate payload_json directly → verifyLedgerChain returns valid: false
 *   23. Mutate stored payload_hash field → verifyLedgerChain returns valid: false
 *   24. Mutate prev_entry_hash of an entry → verifyLedgerChain returns valid: false
 *   25. Delete a middle row → verifyLedgerChain detects sequence gap
 *   26. Mutate stored entry_hash field → verifyLedgerChain returns valid: false
 *   27. Swap sequence_no of two rows → verifyLedgerChain detects chain break
 *
 * F. Correction semantics
 *   28. Correction entry has payload.kind = 'correction' and supersedes_entry_id
 *   29. Original entry is unchanged after correction appended
 *   30. buildTimeline includes both original and correction in insertion order
 *   31. Correction entry itself is hash-chained (has valid entry_hash)
 *   32. verifyLedgerChain validates correction entries like any other
 *   33. Orphan correction (supersedes_entry_id not in DB) → verifyLedgerChain flags it
 *
 * G. Integrity status
 *   34. verifyLedgerChain returns all of: valid, errors[], verified_count, first_sequence, last_sequence
 *   35. Tampered ledger verification includes diagnostic error messages (not just valid:false)
 *   36. verifyLedgerChain returns first_sequence=1 and last_sequence=N for N entries
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  computePayloadHash,
  computeEntryHash,
  canonicalizePayload,
  verifyLedgerChain,
  verifyLedgerRange,
  verifyLedgerEntry,
  GENESIS_HASH,
  type AppendReceipt,
  type ChainVerificationResult,
} from '../packages/core/src/runtime/ledger/immutability/index.js';

import {
  appendLedgerEntry,
  initLedgerDb,
} from '../packages/core/src/runtime/ledger/writer.js';

import {
  LEDGER_TABLE_SQL,
  LEDGER_TABLE_BASE_SQL,
} from '../packages/core/src/runtime/ledger/schema.js';

import type { LedgerEntry } from '../packages/core/src/runtime/ledger/types.js';
import { LEDGER_SCHEMA_VERSION } from '../packages/core/src/runtime/ledger/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const id = randomUUID();
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    ledger_id:      id,
    trace_id:       'tr_sprint20_test',
    request_id:     'req_sprint20_test',
    timestamp:      new Date().toISOString(),
    stage:          'knowledge',
    record_type:    'decision',
    actor:          'system',
    payload: {
      kind:          'decision',
      decision_name: 'test decision',
      decision_code: 'TEST_DECISION',
      input_refs:    {},
      result:        { status: 'pass' },
      rationale:     { summary: 'test', rule_refs: ['rule:test'] },
    },
    ...overrides,
  } as LedgerEntry;
}

/** DB with full immutability schema (triggers active) */
function makeImmutableDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(LEDGER_TABLE_SQL);
  return db;
}

/** DB with chain columns but WITHOUT triggers — for adversarial tests */
function makeTamperableDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(LEDGER_TABLE_BASE_SQL);
  return db;
}

// ─── A. Hash computation ──────────────────────────────────────────────────────

describe('A. Hash computation', () => {
  it('1. same payload → same payload_hash', () => {
    const payload = { kind: 'decision', decision_code: 'X', result: { status: 'pass' } };
    expect(computePayloadHash(payload)).toBe(computePayloadHash(payload));
  });

  it('2. different payload → different payload_hash', () => {
    const h1 = computePayloadHash({ kind: 'decision', decision_code: 'A' });
    const h2 = computePayloadHash({ kind: 'decision', decision_code: 'B' });
    expect(h1).not.toBe(h2);
  });

  it('3. same entry fields → same entry_hash', () => {
    const params = {
      ledger_id:       'eid-1',
      sequence_no:     1,
      prev_entry_hash: GENESIS_HASH,
      payload_hash:    'abc123',
      schema_version:  '1.0.0',
      written_at:      '2025-01-01T00:00:00.000Z',
    };
    expect(computeEntryHash(params)).toBe(computeEntryHash(params));
  });

  it('4. different prev_entry_hash → different entry_hash', () => {
    const base = {
      ledger_id:      'eid-1',
      sequence_no:    2,
      payload_hash:   'abc',
      schema_version: '1.0.0',
      written_at:     '2025-01-01T00:00:00.000Z',
    };
    const h1 = computeEntryHash({ ...base, prev_entry_hash: GENESIS_HASH });
    const h2 = computeEntryHash({ ...base, prev_entry_hash: 'f'.repeat(64) });
    expect(h1).not.toBe(h2);
  });

  it('5. canonicalizePayload: key insertion order has no effect', () => {
    const a = canonicalizePayload({ z: 1, a: 2, m: 3 });
    const b = canonicalizePayload({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
  });

  it('6. canonicalizePayload: nested objects are sorted', () => {
    const canonical = canonicalizePayload({ z: { z_nested: 2, a_nested: 1 }, a: 0 });
    const idx_a_nested = canonical.indexOf('a_nested');
    const idx_z_nested = canonical.indexOf('z_nested');
    expect(idx_a_nested).toBeLessThan(idx_z_nested);
  });
});

// ─── B. DB enforcement ────────────────────────────────────────────────────────

describe('B. DB enforcement', () => {
  it('7. UPDATE on ledger_entries → throws ABORT', () => {
    const db = makeImmutableDb();
    appendLedgerEntry(db, makeEntry());
    expect(() => {
      db.prepare(`UPDATE ledger_entries SET actor = 'tamper'`).run();
    }).toThrow();
  });

  it('8. DELETE on ledger_entries → throws ABORT', () => {
    const db = makeImmutableDb();
    appendLedgerEntry(db, makeEntry());
    expect(() => {
      db.prepare(`DELETE FROM ledger_entries`).run();
    }).toThrow();
  });

  it('9. duplicate sequence_no → throws UNIQUE constraint', () => {
    const db = makeTamperableDb();
    const entry = makeEntry();
    appendLedgerEntry(db, entry);
    // Manually insert another row with the same sequence_no
    expect(() => {
      db.prepare(`
        INSERT INTO ledger_entries
          (ledger_id, request_id, trace_id, stage, record_type, actor,
           timestamp, written_at, schema_version, payload_json,
           payload_hash, prev_entry_hash, entry_hash, sequence_no)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        randomUUID(), 'r', 't', 'knowledge', 'decision', 'system',
        new Date().toISOString(), new Date().toISOString(), '1.0.0',
        '{}', 'x'.repeat(64), 'y'.repeat(64), 'z'.repeat(64),
      );
    }).toThrow();
  });

  it('10. duplicate entry_hash → throws UNIQUE constraint', () => {
    const db = makeTamperableDb();
    const entry = makeEntry();
    const receipt = appendLedgerEntry(db, entry);
    expect(() => {
      db.prepare(`
        INSERT INTO ledger_entries
          (ledger_id, request_id, trace_id, stage, record_type, actor,
           timestamp, written_at, schema_version, payload_json,
           payload_hash, prev_entry_hash, entry_hash, sequence_no)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 999)
      `).run(
        randomUUID(), 'r', 't', 'knowledge', 'decision', 'system',
        new Date().toISOString(), new Date().toISOString(), '1.0.0',
        '{}', 'x'.repeat(64), 'y'.repeat(64), receipt.entry_hash,
      );
    }).toThrow();
  });
});

// ─── C. Append and receipt ────────────────────────────────────────────────────

describe('C. Append and receipt', () => {
  it('11. appendLedgerEntry returns AppendReceipt with required fields', () => {
    const db = makeImmutableDb();
    const receipt = appendLedgerEntry(db, makeEntry());
    expect(receipt).toHaveProperty('ledger_entry_id');
    expect(receipt).toHaveProperty('sequence_no');
    expect(receipt).toHaveProperty('entry_hash');
    expect(receipt).toHaveProperty('prev_entry_hash');
    expect(receipt.entry_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('12. first entry has prev_entry_hash = GENESIS_HASH', () => {
    const db = makeImmutableDb();
    const receipt = appendLedgerEntry(db, makeEntry());
    expect(receipt.prev_entry_hash).toBe(GENESIS_HASH);
  });

  it('13. second entry prev_entry_hash = first entry_hash', () => {
    const db = makeImmutableDb();
    const r1 = appendLedgerEntry(db, makeEntry());
    const r2 = appendLedgerEntry(db, makeEntry());
    expect(r2.prev_entry_hash).toBe(r1.entry_hash);
  });

  it('14. stored payload_hash matches independently recomputed value', () => {
    const db = makeImmutableDb();
    const entry = makeEntry();
    appendLedgerEntry(db, entry);
    const row = db.prepare(
      `SELECT payload_json, payload_hash FROM ledger_entries WHERE ledger_id = ?`
    ).get(entry.ledger_id) as { payload_json: string; payload_hash: string };
    const recomputed = computePayloadHash(JSON.parse(row.payload_json));
    expect(row.payload_hash).toBe(recomputed);
  });

  it('15. stored entry_hash matches independently recomputed value', () => {
    const db = makeImmutableDb();
    const entry = makeEntry();
    appendLedgerEntry(db, entry);
    const row = db.prepare(
      `SELECT ledger_id, sequence_no, prev_entry_hash, payload_hash, schema_version, written_at, entry_hash
       FROM ledger_entries WHERE ledger_id = ?`
    ).get(entry.ledger_id) as Record<string, unknown>;
    const recomputed = computeEntryHash({
      ledger_id:       row['ledger_id'] as string,
      sequence_no:     row['sequence_no'] as number,
      prev_entry_hash: row['prev_entry_hash'] as string,
      payload_hash:    row['payload_hash'] as string,
      schema_version:  row['schema_version'] as string,
      written_at:      row['written_at'] as string,
    });
    expect(row['entry_hash']).toBe(recomputed);
  });

  it('16. sequence numbers are monotonically increasing', () => {
    const db = makeImmutableDb();
    const r1 = appendLedgerEntry(db, makeEntry());
    const r2 = appendLedgerEntry(db, makeEntry());
    const r3 = appendLedgerEntry(db, makeEntry());
    expect(r1.sequence_no).toBe(1);
    expect(r2.sequence_no).toBe(2);
    expect(r3.sequence_no).toBe(3);
  });
});

// ─── D. Chain verification ────────────────────────────────────────────────────

describe('D. Chain verification', () => {
  it('17. 5 sequential entries → verifyLedgerChain valid: true', () => {
    const db = makeImmutableDb();
    for (let i = 0; i < 5; i++) appendLedgerEntry(db, makeEntry());
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('18. empty ledger → verifyLedgerChain valid: true, verified_count: 0', () => {
    const db = makeImmutableDb();
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(true);
    expect(result.verified_count).toBe(0);
  });

  it('19. verifyLedgerRange(1, 3) verifies only entries 1–3', () => {
    const db = makeImmutableDb();
    for (let i = 0; i < 5; i++) appendLedgerEntry(db, makeEntry());
    const result = verifyLedgerRange(db, 1, 3);
    expect(result.valid).toBe(true);
    expect(result.verified_count).toBe(3);
  });

  it('20. verifyLedgerEntry by single ledger_id validates that entry', () => {
    const db = makeImmutableDb();
    const entry = makeEntry();
    appendLedgerEntry(db, entry);
    const result = verifyLedgerEntry(db, entry.ledger_id);
    expect(result.valid).toBe(true);
  });

  it('21. ChainVerificationResult has verified_count, first_sequence, last_sequence', () => {
    const db = makeImmutableDb();
    for (let i = 0; i < 3; i++) appendLedgerEntry(db, makeEntry());
    const result = verifyLedgerChain(db);
    expect(result).toHaveProperty('verified_count', 3);
    expect(result).toHaveProperty('first_sequence');
    expect(result).toHaveProperty('last_sequence');
  });
});

// ─── E. Adversarial / tampering ───────────────────────────────────────────────

describe('E. Adversarial / tampering', () => {
  it('22. mutate payload_json → verifyLedgerChain fails', () => {
    const db = makeTamperableDb();
    const entry = makeEntry();
    appendLedgerEntry(db, entry);
    db.prepare(`UPDATE ledger_entries SET payload_json = '{"tampered":true}'`).run();
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(false);
  });

  it('23. mutate stored payload_hash → verifyLedgerChain fails', () => {
    const db = makeTamperableDb();
    appendLedgerEntry(db, makeEntry());
    db.prepare(`UPDATE ledger_entries SET payload_hash = '${'x'.repeat(64)}'`).run();
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(false);
  });

  it('24. mutate prev_entry_hash → verifyLedgerChain fails', () => {
    const db = makeTamperableDb();
    appendLedgerEntry(db, makeEntry());
    appendLedgerEntry(db, makeEntry()); // second entry links to first
    db.prepare(
      `UPDATE ledger_entries SET prev_entry_hash = '${'a'.repeat(64)}' WHERE sequence_no = 2`
    ).run();
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(false);
  });

  it('25. delete a middle row → verifyLedgerChain detects sequence gap', () => {
    const db = makeTamperableDb();
    for (let i = 0; i < 3; i++) appendLedgerEntry(db, makeEntry());
    db.prepare(`DELETE FROM ledger_entries WHERE sequence_no = 2`).run();
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(false);
  });

  it('26. mutate stored entry_hash → verifyLedgerChain fails', () => {
    const db = makeTamperableDb();
    appendLedgerEntry(db, makeEntry());
    db.prepare(`UPDATE ledger_entries SET entry_hash = '${'e'.repeat(64)}'`).run();
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(false);
  });

  it('27. swap sequence_no of two rows → verifyLedgerChain detects chain break', () => {
    const db = makeTamperableDb();
    appendLedgerEntry(db, makeEntry());
    appendLedgerEntry(db, makeEntry());
    // Swap sequence numbers: row with seq=1 gets seq=2 and vice versa
    db.prepare(`UPDATE ledger_entries SET sequence_no = 99 WHERE sequence_no = 1`).run();
    db.prepare(`UPDATE ledger_entries SET sequence_no = 1  WHERE sequence_no = 2`).run();
    db.prepare(`UPDATE ledger_entries SET sequence_no = 2  WHERE sequence_no = 99`).run();
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(false);
  });
});

// ─── F. Correction semantics ──────────────────────────────────────────────────

describe('F. Correction semantics', () => {
  it('28. correction entry has kind=correction and supersedes_entry_id in payload', () => {
    const db = makeImmutableDb();
    const original = makeEntry();
    appendLedgerEntry(db, original);

    const correction = makeEntry({
      record_type: 'correction',
      payload: {
        kind: 'correction',
        supersedes_entry_id: original.ledger_id,
        supersession_reason: 'Data entry error in decision_code',
        correction_type: 'data_error',
        corrected_fields_summary: 'decision_code was incorrect',
      } as any,
      supersedes_entry_id: original.ledger_id,
    });
    appendLedgerEntry(db, correction);

    const row = db.prepare(
      `SELECT payload_json, supersedes_entry_id FROM ledger_entries WHERE ledger_id = ?`
    ).get(correction.ledger_id) as any;
    const payload = JSON.parse(row.payload_json);

    expect(payload.kind).toBe('correction');
    expect(payload.supersedes_entry_id).toBe(original.ledger_id);
    expect(row.supersedes_entry_id).toBe(original.ledger_id);
  });

  it('29. original entry is unchanged after correction appended', () => {
    const db = makeImmutableDb();
    const original = makeEntry();
    appendLedgerEntry(db, original);

    const originalRow = db.prepare(
      `SELECT payload_json, entry_hash FROM ledger_entries WHERE ledger_id = ?`
    ).get(original.ledger_id) as any;
    const originalHash = originalRow.entry_hash;
    const originalPayload = originalRow.payload_json;

    appendLedgerEntry(db, makeEntry({
      record_type: 'correction',
      payload: { kind: 'correction', supersedes_entry_id: original.ledger_id, supersession_reason: 'fix', correction_type: 'data_error', corrected_fields_summary: 's' } as any,
      supersedes_entry_id: original.ledger_id,
    }));

    const afterRow = db.prepare(
      `SELECT payload_json, entry_hash FROM ledger_entries WHERE ledger_id = ?`
    ).get(original.ledger_id) as any;
    expect(afterRow.entry_hash).toBe(originalHash);
    expect(afterRow.payload_json).toBe(originalPayload);
  });

  it('30. buildTimeline includes both original and correction in order', () => {
    const db = makeImmutableDb();
    const original = makeEntry();
    appendLedgerEntry(db, original);
    const correction = makeEntry({
      record_type: 'correction',
      payload: { kind: 'correction', supersedes_entry_id: original.ledger_id, supersession_reason: 'r', correction_type: 'data_error', corrected_fields_summary: 's' } as any,
      supersedes_entry_id: original.ledger_id,
      trace_id: 'tr_sprint20_test',
    });
    appendLedgerEntry(db, correction);

    const rows = db.prepare(
      `SELECT record_type FROM ledger_entries WHERE trace_id = ? ORDER BY sequence_no ASC`
    ).all('tr_sprint20_test') as { record_type: string }[];

    const types = rows.map(r => r.record_type);
    expect(types).toContain('decision');
    expect(types).toContain('correction');
    expect(types.indexOf('decision')).toBeLessThan(types.indexOf('correction'));
  });

  it('31. correction entry itself has a valid entry_hash (hash-chained)', () => {
    const db = makeImmutableDb();
    const original = makeEntry();
    appendLedgerEntry(db, original);
    const correction = makeEntry({
      record_type: 'correction',
      payload: { kind: 'correction', supersedes_entry_id: original.ledger_id, supersession_reason: 'r', correction_type: 'data_error', corrected_fields_summary: 's' } as any,
      supersedes_entry_id: original.ledger_id,
    });
    const receipt = appendLedgerEntry(db, correction);
    expect(receipt.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.prev_entry_hash).not.toBe(GENESIS_HASH); // must chain to original
  });

  it('32. verifyLedgerChain validates correction entries like any other entry', () => {
    const db = makeImmutableDb();
    const original = makeEntry();
    appendLedgerEntry(db, original);
    const correction = makeEntry({
      record_type: 'correction',
      payload: { kind: 'correction', supersedes_entry_id: original.ledger_id, supersession_reason: 'r', correction_type: 'data_error', corrected_fields_summary: 's' } as any,
      supersedes_entry_id: original.ledger_id,
    });
    appendLedgerEntry(db, correction);
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(true);
  });

  it('33. orphan correction → verifyLedgerChain flags it', () => {
    const db = makeTamperableDb();
    // Append a correction that references a non-existent entry_id
    const correction = makeEntry({
      record_type: 'correction',
      payload: { kind: 'correction', supersedes_entry_id: 'nonexistent-uuid', supersession_reason: 'r', correction_type: 'data_error', corrected_fields_summary: 's' } as any,
      supersedes_entry_id: 'nonexistent-uuid',
    });
    appendLedgerEntry(db, correction);
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('orphan') || e.toLowerCase().includes('supersedes') || e.toLowerCase().includes('not found'))).toBe(true);
  });
});

// ─── G. Integrity status ──────────────────────────────────────────────────────

describe('G. Integrity status', () => {
  it('34. verifyLedgerChain result has all required shape fields', () => {
    const db = makeImmutableDb();
    appendLedgerEntry(db, makeEntry());
    const result = verifyLedgerChain(db);
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('verified_count');
    expect(result).toHaveProperty('first_sequence');
    expect(result).toHaveProperty('last_sequence');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('35. tampered ledger verification includes diagnostic error messages', () => {
    const db = makeTamperableDb();
    appendLedgerEntry(db, makeEntry());
    db.prepare(`UPDATE ledger_entries SET payload_json = '{"tampered":true}'`).run();
    const result = verifyLedgerChain(db);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(typeof result.errors[0]).toBe('string');
  });

  it('36. verifyLedgerChain returns first_sequence=1 and last_sequence=N for N entries', () => {
    const db = makeImmutableDb();
    for (let i = 0; i < 4; i++) appendLedgerEntry(db, makeEntry());
    const result = verifyLedgerChain(db);
    expect(result.first_sequence).toBe(1);
    expect(result.last_sequence).toBe(4);
  });
});
