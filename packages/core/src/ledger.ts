/**
 * @nirnex/core — Ledger public surface
 *
 * Top-level re-export so CLI can import via:
 *   import { ... } from '@nirnex/core/dist/ledger.js'
 *
 * Mirrors the pattern used by trace.ts for the trace command.
 */

export {
  LEDGER_SCHEMA_VERSION,
  type LedgerEntry,
  type LedgerStage,
  type LedgerRecordType,
  type LedgerActor,
  type LedgerPayload,
  type DecisionRecord,
  type OverrideRecord,
  type OutcomeRecord,
  type RefusalRecord,
  type DeviationRecord,
} from './runtime/ledger/types.js';

export {
  getLedgerDbPath,
} from './runtime/ledger/schema.js';

export {
  initLedgerDb,
  appendLedgerEntry,
  appendLedgerEntryAsync,
  LedgerValidationError,
} from './runtime/ledger/writer.js';

export { LedgerReader } from './runtime/ledger/reader.js';
