/**
 * @nirnex/core — Reporting public surface
 *
 * Top-level re-export so CLI can import via:
 *   import { ... } from '@nirnex/core/dist/reporting.js'
 *
 * Mirrors the pattern used by trace.ts for the trace command.
 */

export {
  REPORT_SCHEMA_VERSION,
  type FailureSeverity,
  type FailureClass,
  type CausalRelationship,
  type ReportEvent,
  type StageRecord,
  type FailureRecord,
  type CausalNode,
  type CausalEdge,
  type CausalChain,
  type CausalGraph,
  type ConfidenceCheckpoint,
  type ConfidencePenalty,
  type ConfidenceReportSnapshot,
  type EvidenceItem,
  type KnowledgeHealthSnapshot,
  type OptimisationHint,
  type Delta,
  type RunComparison,
  type ReportValidationIssue,
  type ReportIntegrityResult,
  type RunSummary,
  type RunEvidenceBundle,
} from './runtime/reporting/types.js';

export {
  type TaxonomyEntry,
  FAILURE_TAXONOMY,
  lookupFailureCode,
  getAllFailureCodes,
} from './runtime/reporting/failure-taxonomy.js';

export {
  buildCausalGraph,
  findPrimaryChains,
  buildCausalChain,
  extractCausalContext,
} from './runtime/reporting/causality.js';

export {
  validateBundle,
  computeIntegrityStatus,
} from './runtime/reporting/validators.js';

export {
  type AssemblerOptions,
  assembleReport,
} from './runtime/reporting/assembler.js';

export { generateOptimisationHints } from './runtime/reporting/optimization-rules.js';

export { renderHtml } from './runtime/reporting/renderer/html.js';

export { compareRuns } from './runtime/reporting/index.js';
