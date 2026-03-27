/**
 * Runtime Ledger — Public API
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
  type TraceAdapterRecord,
  type StageReplayRecord,
  type StageRejectionRecord,
  type CorrectionRecord,
  type ConfidenceSnapshotRecord,
} from './types.js';

export {
  getLedgerDbPath,
  LEDGER_TABLE_SQL,
} from './schema.js';

export {
  validateLedgerEntry,
  validatePayload,
  validateDecisionRecord,
  validateOverrideRecord,
  validateOutcomeRecord,
  validateRefusalRecord,
  validateDeviationRecord,
  type ValidationResult,
} from './validators.js';

export {
  initLedgerDb,
  appendLedgerEntry,
  appendLedgerEntryAsync,
  LedgerValidationError,
} from './writer.js';

export { LedgerReader } from './reader.js';

export {
  fromBoundTrace,
  fromDimensionScoringTrace,
  fromConflictEvents,
  fromRefusal,
  fromOrchestratorResult,
  fromStageReplay,
  fromStageRejection,
  fromConfidenceSnapshot,
  fromReplayMaterial,
  fromTraceJson,
} from './mappers.js';
