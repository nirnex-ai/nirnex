/**
 * OrchestratorRunner — Runs the planning pipeline in canonical stage order
 *
 * Enforces deterministic stage ordering via STAGES const.
 * BLOCK failures halt the pipeline immediately.
 * ESCALATE/DEGRADE failures continue with fallback output and set flags.
 *
 * Sprint 15 additions:
 *   - Per-stage timeout enforcement via runStageWithTimeout
 *   - OrchestratorInput.stageTimeoutOverrides — caller-supplied budget overrides
 *   - OrchestratorResult.stageTimeouts  — all StageTimeoutEvents emitted
 *   - OrchestratorResult.degradedStages — stages degraded due to timeout
 *   - OrchestratorResult.executionWarnings — human-readable timeout warnings
 *
 * Sprint 19 additions:
 *   - OrchestratorInput.enableIdempotency — opt-in idempotency per run
 *   - OrchestratorInput.contractVersionOverrides — override per-stage contract versions
 *   - OrchestratorResult.replayedStages — stages whose results were replayed from store
 *   - OrchestratorResult.rejectedDuplicateStages — stages rejected as in-flight duplicates
 *   - StageExecutionStore backed by SQLite at {targetRoot}/.aidos-idempotency.db
 *
 * Design constraints:
 *   - STAGES order is authoritative — no handler may reorder stages
 *   - Each stage receives the output of previous stages as its input context
 *   - OrchestratorResult includes per-stage StageResults and a final lane
 *   - No filesystem I/O outside of idempotency store (when enabled)
 */

import {
  STAGES,
  ORCHESTRATOR_VERSION,
  STAGE_CONTRACT_VERSIONS,
  STAGE_IDEMPOTENCY,
  type StageId,
  type StageResult,
  type IntentDetectInput,
  type IntentDetectOutput,
  type EcoBuildOutput,
  type SufficiencyGateOutput,
  type TeeBuildOutput,
  type ClassifyLaneOutput,
} from "./types.js";

import {
  validateIntentDetectInput,
  validateIntentDetectOutput,
  validateEcoBuildInput,
  validateEcoBuildOutput,
  validateSufficiencyGateInput,
  validateSufficiencyGateOutput,
  validateTeeBuildInput,
  validateTeeBuildOutput,
  validateClassifyLaneInput,
  validateClassifyLaneOutput,
} from "./validators.js";

import { StageExecutor } from "./stage-executor.js";
import { FAILURE_POLICY, applyFailureMode } from "./failure-policy.js";
import type { LedgerEntry } from "../runtime/ledger/types.js";
import {
  fromBoundTrace,
  fromOrchestratorResult,
  fromRefusal,
  fromStageReplay,
  fromStageRejection,
  fromConfidenceSnapshot,
} from "../runtime/ledger/mappers.js";
import {
  buildConfidenceSnapshot,
  ecoDimensionsToConfidence,
  type ConfidenceSnapshotRecord,
} from "../runtime/confidence/index.js";
import {
  buildReplayMaterial,
} from "../runtime/replay/capture.js";
import { fromReplayMaterial } from "../runtime/ledger/mappers.js";
import { randomUUID, createHash } from "crypto";
import { runStageWithTimeout, type StageTimeoutEvent } from "./timeout.js";
import { getStageTimeoutConfig } from "../config/stageTimeouts.js";
import {
  StageExecutionStore,
  normalizeStageInput,
  computeStageExecutionKey,
  resolveIdempotencyAction,
  type StageExecutionRecord,
} from "./idempotency/index.js";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  specPath: string | null;
  query?: string;
  targetRoot?: string;
  /**
   * Optional ledger entry callback. Called after each stage completes and once
   * after the final terminal OutcomeRecord is emitted.
   *
   * Backward compatible: if absent, no ledger writes occur and pipeline behavior
   * is unchanged.
   */
  onLedgerEntry?: (entry: LedgerEntry) => void;
  /**
   * Optional per-stage timeout overrides (milliseconds).
   * Unspecified stages use DEFAULT_STAGE_TIMEOUTS.
   * Backward compatible: if absent, all stages use their default budgets.
   */
  stageTimeoutOverrides?: Partial<Record<StageId, number>>;
  /**
   * Sprint 19: opt-in stage idempotency.
   * Requires targetRoot to be set (store is file-based).
   * Backward compatible: false/undefined → no idempotency, same behavior as before.
   */
  enableIdempotency?: boolean;
  /**
   * Sprint 19: override contract versions for specific stages.
   * Bumping a stage's contract version forces re-execution even if input is unchanged.
   */
  contractVersionOverrides?: Partial<Record<StageId, string>>;
  /**
   * Sprint 21: opt-in confidence evolution tracking.
   * When true, emits ConfidenceSnapshotRecord ledger entries at 4 pipeline checkpoints.
   * Backward compatible: false/undefined → no confidence snapshots emitted.
   */
  enableConfidenceTracking?: boolean;
  /**
   * Sprint 22: opt-in replay material capture.
   * When true, emits replay_material ledger entries after each stage completes.
   * These materials are the foundation for deterministic run reconstruction.
   * Backward compatible: false/undefined → no replay materials emitted.
   *
   * NOTE: replay ≠ re_run. Materials captured here enable ledger-backed replay
   * (deterministic reconstruction), not fresh re-execution against live dependencies.
   */
  enableReplayCapture?: boolean;
}

export interface OrchestratorResult {
  /** true when all stages ran to completion (even with escalation/degradation) */
  completed: boolean;
  /** true when a BLOCK failure halted the pipeline */
  blocked: boolean;
  /** which stage triggered the BLOCK halt, if any */
  blockedAt?: StageId;
  /** true when any ESCALATE failure occurred */
  escalated: boolean;
  /** true when any DEGRADE failure occurred (including timeout-degraded stages) */
  degraded: boolean;
  /** per-stage results in execution order */
  stageResults: Array<StageResult & { stage: StageId }>;
  /** final lane from CLASSIFY_LANE, or undefined if pipeline was blocked before */
  finalLane?: string;
  /** StageTimeoutEvents emitted during this run (empty when all stages completed on time) */
  stageTimeouts: StageTimeoutEvent[];
  /** stages that timed out and were handled with a degraded fallback */
  degradedStages: StageId[];
  /** human-readable warnings for each timeout event */
  executionWarnings: string[];
  /** Sprint 19: stages whose output was replayed from the idempotency store */
  replayedStages: StageId[];
  /** Sprint 19: stages rejected because another in-flight execution holds the key */
  rejectedDuplicateStages: StageId[];
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run the full planning pipeline for a given input.
 *
 * @param input    - initial pipeline input (spec path + optional query)
 * @param handlers - map of stage ID → async handler function (injected for testability)
 */
export async function runOrchestrator(
  input: OrchestratorInput,
  handlers: Record<string, (input: unknown) => Promise<unknown>>,
): Promise<OrchestratorResult> {
  const executor = new StageExecutor();
  const stageResults: Array<StageResult & { stage: StageId }> = [];
  let escalated = false;
  let degraded = false;

  // Sprint 15: accumulated timeout tracking
  const stageTimeouts: StageTimeoutEvent[] = [];
  const degradedStages: StageId[] = [];
  const executionWarnings: string[] = [];

  // Sprint 19: idempotency tracking
  const replayedStages: StageId[] = [];
  const rejectedDuplicateStages: StageId[] = [];

  // Sprint 21: confidence evolution tracking
  let confidenceSnapshotIndex = 0;
  let prevConfidenceSnapshot: ConfidenceSnapshotRecord | undefined = undefined;

  function emitConfidenceSnapshot(snapshot: ConfidenceSnapshotRecord): void {
    if (!input.onLedgerEntry) return;
    try {
      const entry = fromConfidenceSnapshot(snapshot, {
        trace_id: traceId,
        request_id: requestId,
      });
      input.onLedgerEntry(entry);
      prevConfidenceSnapshot = snapshot;
    } catch { /* confidence tracking must not crash the pipeline */ }
  }

  // Sprint 19: idempotency store (file-based when targetRoot is available)
  let store: StageExecutionStore | null = null;
  if (input.enableIdempotency && input.targetRoot) {
    const Database = (await import('better-sqlite3')).default;
    const dbPath = path.join(input.targetRoot, '.aidos-idempotency.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    store = new StageExecutionStore(db);
    store.ensureSchema();
  }

  // Effective contract versions (base + overrides)
  const effectiveContractVersions: Record<StageId, string> = { ...STAGE_CONTRACT_VERSIONS };
  if (input.contractVersionOverrides) {
    for (const [stageId, version] of Object.entries(input.contractVersionOverrides)) {
      if (version !== undefined) {
        effectiveContractVersions[stageId as StageId] = version;
      }
    }
  }

  // Ledger correlation IDs — stable for this orchestrator invocation
  const traceId   = `tr_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  // Chain tracking: ledger_id of the previous stage entry (for parent_ledger_id)
  let prevLedgerId: string | undefined = undefined;

  // Pipeline context — accumulates outputs from each stage
  let intentOutput: IntentDetectOutput | undefined;
  let ecoOutput: EcoBuildOutput | undefined;
  let gateOutput: SufficiencyGateOutput | undefined;
  let teeOutput: TeeBuildOutput | undefined;
  let laneOutput: ClassifyLaneOutput | undefined;

  // Sprint 19: execution keys accumulated per stage for upstream chaining
  const stageExecutionKeys: Partial<Record<StageId, string>> = {};

  for (const stage of STAGES) {
    const handler = handlers[stage];
    if (!handler) {
      // No handler provided — apply failure policy
      const error = new Error(`No handler registered for stage: ${stage}`);
      const result = applyFailureMode(FAILURE_POLICY[stage], stage, error);
      stageResults.push(result as StageResult & { stage: StageId });
      if (result.status === "blocked") {
        return buildBlockedResult(stage, stageResults, escalated, degraded, stageTimeouts, degradedStages, executionWarnings, replayedStages, rejectedDuplicateStages, input, traceId, requestId, prevLedgerId);
      }
      if (result.status === "escalated") escalated = true;
      if (result.status === "degraded") degraded = true;
      continue;
    }

    // ── Build timeout-wrapped handler ──────────────────────────────────────
    const timeoutConfig = getStageTimeoutConfig(stage, input.stageTimeoutOverrides);
    let pendingTimeoutEvent: StageTimeoutEvent | undefined;

    const wrappedHandler = async (executorInput: unknown): Promise<unknown> => {
      const execResult = await runStageWithTimeout(
        stage,
        (_signal) => (handler as (i: unknown) => Promise<unknown>)(executorInput),
        timeoutConfig,
      );
      pendingTimeoutEvent = execResult.timeoutEvent;
      if (execResult.status === 'success') return execResult.output;
      throw execResult.error ?? new Error(
        execResult.timedOut
          ? `Stage ${stage} timed out after ${timeoutConfig.timeoutMs}ms`
          : `Stage ${stage} failed`,
      );
    };

    let result: StageResult;
    let isReplayed = false;
    let isRejected = false;
    let currentExecutionKey: string | undefined;

    // Build stage-specific input from accumulated context
    switch (stage) {
      case "INTENT_DETECT": {
        const stageInput: IntentDetectInput = { specPath: input.specPath, query: input.query };

        // Sprint 19: check idempotency before executing
        if (store) {
          const upstreamKeys: string[] = [];
          const normalized = normalizeStageInput(stageInput);
          currentExecutionKey = computeStageExecutionKey({
            orchestratorVersion: ORCHESTRATOR_VERSION,
            stageId: stage,
            contractVersion: effectiveContractVersions[stage],
            normalizedInput: normalized,
            upstreamKeys,
          });

          const decision = resolveIdempotencyAction(store, currentExecutionKey, STAGE_IDEMPOTENCY[stage]);

          if (decision.action === 'replay' && decision.record?.output_json) {
            const storedOutput = JSON.parse(decision.record.output_json) as IntentDetectOutput;
            result = makeReplayResult(stage, storedOutput, decision.record);
            intentOutput = storedOutput;
            replayedStages.push(stage);
            isReplayed = true;
          } else if (decision.action === 'reject_duplicate_inflight') {
            result = makeRejectedResult(stage);
            rejectedDuplicateStages.push(stage);
            isRejected = true;
            emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
          } else {
            // Execute — claim first
            const claimRecord = makeClaimRecord(stage, currentExecutionKey, effectiveContractVersions[stage], normalized, traceId, requestId);
            const claimed = store.claim(currentExecutionKey, claimRecord);
            if (!claimed) {
              result = makeRejectedResult(stage);
              rejectedDuplicateStages.push(stage);
              isRejected = true;
              emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
            } else {
              result = await executor.execute(
                stage,
                wrappedHandler as (i: IntentDetectInput) => Promise<IntentDetectOutput>,
                stageInput, validateIntentDetectInput, validateIntentDetectOutput,
              );
              finalizeStore(store, currentExecutionKey, result);
              if (result.status === "ok") intentOutput = result.output as IntentDetectOutput;
            }
          }
        } else {
          result = await executor.execute(
            stage,
            wrappedHandler as (i: IntentDetectInput) => Promise<IntentDetectOutput>,
            stageInput, validateIntentDetectInput, validateIntentDetectOutput,
          );
          if (result.status === "ok") intentOutput = result.output as IntentDetectOutput;
        }
        break;
      }

      case "ECO_BUILD": {
        const stageInput = {
          intent: intentOutput ?? { primary: "unknown", composite: false },
          specPath: input.specPath,
          targetRoot: input.targetRoot,
        };

        if (store) {
          const upstreamKeys = filterKeys([stageExecutionKeys['INTENT_DETECT']]);
          const normalized = normalizeStageInput(stageInput);
          currentExecutionKey = computeStageExecutionKey({
            orchestratorVersion: ORCHESTRATOR_VERSION,
            stageId: stage,
            contractVersion: effectiveContractVersions[stage],
            normalizedInput: normalized,
            upstreamKeys,
          });

          const decision = resolveIdempotencyAction(store, currentExecutionKey, STAGE_IDEMPOTENCY[stage]);

          if (decision.action === 'replay' && decision.record?.output_json) {
            const storedOutput = JSON.parse(decision.record.output_json) as EcoBuildOutput;
            result = makeReplayResult(stage, storedOutput, decision.record);
            ecoOutput = storedOutput;
            replayedStages.push(stage);
            isReplayed = true;
          } else if (decision.action === 'reject_duplicate_inflight') {
            result = makeRejectedResult(stage);
            rejectedDuplicateStages.push(stage);
            isRejected = true;
            emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
          } else {
            const claimRecord = makeClaimRecord(stage, currentExecutionKey, effectiveContractVersions[stage], normalized, traceId, requestId);
            const claimed = store.claim(currentExecutionKey, claimRecord);
            if (!claimed) {
              result = makeRejectedResult(stage);
              rejectedDuplicateStages.push(stage);
              isRejected = true;
              emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
            } else {
              result = await executor.execute(
                stage,
                wrappedHandler as (i: typeof stageInput) => Promise<EcoBuildOutput>,
                stageInput, validateEcoBuildInput, validateEcoBuildOutput,
              );
              finalizeStore(store, currentExecutionKey, result);
              if (result.status === "ok") ecoOutput = result.output as EcoBuildOutput;
              else if (result.output) ecoOutput = result.output as EcoBuildOutput;
            }
          }
        } else {
          result = await executor.execute(
            stage,
            wrappedHandler as (i: typeof stageInput) => Promise<EcoBuildOutput>,
            stageInput, validateEcoBuildInput, validateEcoBuildOutput,
          );
          if (result.status === "ok") ecoOutput = result.output as EcoBuildOutput;
          else if (result.output) ecoOutput = result.output as EcoBuildOutput;
        }
        break;
      }

      case "SUFFICIENCY_GATE": {
        const stageInput = ecoOutput ?? { confidence_score: 0, eco_dimensions: makePassDimensions(), intent: { primary: "unknown", composite: false } };

        if (store) {
          const upstreamKeys = filterKeys([stageExecutionKeys['ECO_BUILD']]);
          const normalized = normalizeStageInput(stageInput);
          currentExecutionKey = computeStageExecutionKey({
            orchestratorVersion: ORCHESTRATOR_VERSION,
            stageId: stage,
            contractVersion: effectiveContractVersions[stage],
            normalizedInput: normalized,
            upstreamKeys,
          });

          const decision = resolveIdempotencyAction(store, currentExecutionKey, STAGE_IDEMPOTENCY[stage]);

          if (decision.action === 'replay' && decision.record?.output_json) {
            const storedOutput = JSON.parse(decision.record.output_json) as SufficiencyGateOutput;
            result = makeReplayResult(stage, storedOutput, decision.record);
            gateOutput = storedOutput;
            replayedStages.push(stage);
            isReplayed = true;
          } else if (decision.action === 'reject_duplicate_inflight') {
            result = makeRejectedResult(stage);
            rejectedDuplicateStages.push(stage);
            isRejected = true;
            emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
          } else {
            const claimRecord = makeClaimRecord(stage, currentExecutionKey, effectiveContractVersions[stage], normalized, traceId, requestId);
            const claimed = store.claim(currentExecutionKey, claimRecord);
            if (!claimed) {
              result = makeRejectedResult(stage);
              rejectedDuplicateStages.push(stage);
              isRejected = true;
              emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
            } else {
              result = await executor.execute(
                stage,
                wrappedHandler as (i: typeof stageInput) => Promise<SufficiencyGateOutput>,
                stageInput, validateSufficiencyGateInput, validateSufficiencyGateOutput,
              );
              finalizeStore(store, currentExecutionKey, result);
              if (result.status === "ok") gateOutput = result.output as SufficiencyGateOutput;
            }
          }
        } else {
          result = await executor.execute(
            stage,
            wrappedHandler as (i: typeof stageInput) => Promise<SufficiencyGateOutput>,
            stageInput, validateSufficiencyGateInput, validateSufficiencyGateOutput,
          );
          if (result.status === "ok") gateOutput = result.output as SufficiencyGateOutput;
        }
        break;
      }

      case "TEE_BUILD": {
        const stageInput = {
          eco: ecoOutput ?? { intent: { primary: "unknown", composite: false }, eco_dimensions: makePassDimensions(), confidence_score: 0 },
          gate: gateOutput ?? { behavior: "pass" as const, lane: "A", reason: "fallback" },
        };

        if (store) {
          const upstreamKeys = filterKeys([stageExecutionKeys['ECO_BUILD'], stageExecutionKeys['SUFFICIENCY_GATE']]);
          const normalized = normalizeStageInput(stageInput);
          currentExecutionKey = computeStageExecutionKey({
            orchestratorVersion: ORCHESTRATOR_VERSION,
            stageId: stage,
            contractVersion: effectiveContractVersions[stage],
            normalizedInput: normalized,
            upstreamKeys,
          });

          const decision = resolveIdempotencyAction(store, currentExecutionKey, STAGE_IDEMPOTENCY[stage]);

          if (decision.action === 'replay' && decision.record?.output_json) {
            const storedOutput = JSON.parse(decision.record.output_json) as TeeBuildOutput;
            result = makeReplayResult(stage, storedOutput, decision.record);
            teeOutput = storedOutput;
            replayedStages.push(stage);
            isReplayed = true;
          } else if (decision.action === 'reject_duplicate_inflight') {
            result = makeRejectedResult(stage);
            rejectedDuplicateStages.push(stage);
            isRejected = true;
            emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
          } else {
            const claimRecord = makeClaimRecord(stage, currentExecutionKey, effectiveContractVersions[stage], normalized, traceId, requestId);
            const claimed = store.claim(currentExecutionKey, claimRecord);
            if (!claimed) {
              result = makeRejectedResult(stage);
              rejectedDuplicateStages.push(stage);
              isRejected = true;
              emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
            } else {
              result = await executor.execute(
                stage,
                wrappedHandler as (i: typeof stageInput) => Promise<TeeBuildOutput>,
                stageInput, validateTeeBuildInput, validateTeeBuildOutput,
              );
              finalizeStore(store, currentExecutionKey, result);
              if (result.status === "ok") teeOutput = result.output as TeeBuildOutput;
              else if (result.output) teeOutput = result.output as TeeBuildOutput;
            }
          }
        } else {
          result = await executor.execute(
            stage,
            wrappedHandler as (i: typeof stageInput) => Promise<TeeBuildOutput>,
            stageInput, validateTeeBuildInput, validateTeeBuildOutput,
          );
          if (result.status === "ok") teeOutput = result.output as TeeBuildOutput;
          else if (result.output) teeOutput = result.output as TeeBuildOutput;
        }
        break;
      }

      case "CLASSIFY_LANE": {
        const stageInput = {
          eco: ecoOutput ?? { intent: { primary: "unknown", composite: false }, eco_dimensions: makePassDimensions(), confidence_score: 0 },
          tee: teeOutput ?? { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] },
        };

        if (store) {
          const upstreamKeys = filterKeys([stageExecutionKeys['ECO_BUILD'], stageExecutionKeys['TEE_BUILD']]);
          const normalized = normalizeStageInput(stageInput);
          currentExecutionKey = computeStageExecutionKey({
            orchestratorVersion: ORCHESTRATOR_VERSION,
            stageId: stage,
            contractVersion: effectiveContractVersions[stage],
            normalizedInput: normalized,
            upstreamKeys,
          });

          const decision = resolveIdempotencyAction(store, currentExecutionKey, STAGE_IDEMPOTENCY[stage]);

          if (decision.action === 'replay' && decision.record?.output_json) {
            const storedOutput = JSON.parse(decision.record.output_json) as ClassifyLaneOutput;
            result = makeReplayResult(stage, storedOutput, decision.record);
            laneOutput = storedOutput;
            replayedStages.push(stage);
            isReplayed = true;
          } else if (decision.action === 'reject_duplicate_inflight') {
            result = makeRejectedResult(stage);
            rejectedDuplicateStages.push(stage);
            isRejected = true;
            emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
          } else {
            const claimRecord = makeClaimRecord(stage, currentExecutionKey, effectiveContractVersions[stage], normalized, traceId, requestId);
            const claimed = store.claim(currentExecutionKey, claimRecord);
            if (!claimed) {
              result = makeRejectedResult(stage);
              rejectedDuplicateStages.push(stage);
              isRejected = true;
              emitRejectionLedger(stage, currentExecutionKey, traceId, requestId, prevLedgerId, input.onLedgerEntry);
            } else {
              result = await executor.execute(
                stage,
                wrappedHandler as (i: typeof stageInput) => Promise<ClassifyLaneOutput>,
                stageInput, validateClassifyLaneInput, validateClassifyLaneOutput,
              );
              finalizeStore(store, currentExecutionKey, result);
              if (result.status === "ok") laneOutput = result.output as ClassifyLaneOutput;
              else if (result.output) laneOutput = result.output as ClassifyLaneOutput;
            }
          }
        } else {
          result = await executor.execute(
            stage,
            wrappedHandler as (i: typeof stageInput) => Promise<ClassifyLaneOutput>,
            stageInput, validateClassifyLaneInput, validateClassifyLaneOutput,
          );
          if (result.status === "ok") laneOutput = result.output as ClassifyLaneOutput;
          else if (result.output) laneOutput = result.output as ClassifyLaneOutput;
        }
        break;
      }

      default: {
        // Should never happen — STAGES is exhaustive
        const error = new Error(`Unknown stage: ${stage}`);
        result = applyFailureMode("BLOCK", stage as StageId, error);
        break;
      }
    }

    // Track execution key for downstream upstream-chaining
    if (currentExecutionKey) {
      stageExecutionKeys[stage] = currentExecutionKey;
    }

    stageResults.push(result as StageResult & { stage: StageId });

    // ── Emit ledger entry for this stage ───────────────────────────────────
    if (input.onLedgerEntry) {
      try {
        if (isReplayed && currentExecutionKey) {
          // Emit stage_replay ledger entry
          const completedRecord = store?.getCompleted(currentExecutionKey);
          const replayEntry = fromStageReplay(
            {
              stageId:               stage,
              replayOfExecutionKey:  currentExecutionKey,
              originalTraceId:       completedRecord?.trace_id ?? traceId,
              resultHash:            completedRecord?.result_hash,
            },
            { trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId },
          );
          prevLedgerId = replayEntry.ledger_id;
          input.onLedgerEntry(replayEntry);
        } else if (!isRejected) {
          // Normal execution — emit decision record
          const stageEntry = fromBoundTrace(
            result.trace,
            { trace_id: traceId, request_id: requestId, stage: 'knowledge', parent_ledger_id: prevLedgerId },
          );
          prevLedgerId = stageEntry.ledger_id;
          input.onLedgerEntry(stageEntry);
        }
        // Rejected stages emit their ledger entry inline (in emitRejectionLedger)
      } catch {
        // Ledger emission failure must never crash the pipeline
      }
    }

    // ── Sprint 22: Replay material capture ─────────────────────────────────
    if (input.enableReplayCapture && input.onLedgerEntry && !isRejected && !isReplayed) {
      try {
        const material = buildReplayMaterial(result.trace);
        const materialEntry = fromReplayMaterial(material, {
          trace_id: traceId,
          request_id: requestId,
        });
        input.onLedgerEntry(materialEntry);
      } catch { /* replay capture must not crash the pipeline */ }
    }

    // ── Sprint 21: Confidence snapshot checkpoints ─────────────────────────
    if (input.enableConfidenceTracking && ecoOutput && !isRejected) {
      if (stage === 'ECO_BUILD' && ecoOutput) {
        const eco = ecoOutput as EcoBuildOutput & { forced_unknown?: boolean; forced_lane_minimum?: string };
        confidenceSnapshotIndex++;
        const snapshot = buildConfidenceSnapshot({
          snapshot_index: confidenceSnapshotIndex,
          computed_confidence: eco.confidence_score,
          stage_name: 'ECO_BUILD',
          trigger_type: 'eco_initialized',
          dimensions: ecoDimensionsToConfidence(eco.eco_dimensions),
          forced_unknown: eco.forced_unknown,
          effective_lane: eco.forced_lane_minimum,
          previous: prevConfidenceSnapshot,
        });
        emitConfidenceSnapshot(snapshot);
      } else if (stage === 'SUFFICIENCY_GATE' && gateOutput) {
        const eco = ecoOutput as EcoBuildOutput;
        confidenceSnapshotIndex++;
        const snapshot = buildConfidenceSnapshot({
          snapshot_index: confidenceSnapshotIndex,
          computed_confidence: eco.confidence_score,
          stage_name: 'SUFFICIENCY_GATE',
          trigger_type: 'evidence_gate_evaluated',
          dimensions: ecoDimensionsToConfidence(eco.eco_dimensions),
          gates: { sufficiency_gate_verdict: gateOutput.behavior, lane: gateOutput.lane },
          previous: prevConfidenceSnapshot,
        });
        emitConfidenceSnapshot(snapshot);
      } else if (stage === 'CLASSIFY_LANE' && laneOutput) {
        const eco = ecoOutput as EcoBuildOutput;
        confidenceSnapshotIndex++;
        const snapshot = buildConfidenceSnapshot({
          snapshot_index: confidenceSnapshotIndex,
          computed_confidence: eco.confidence_score,
          stage_name: 'CLASSIFY_LANE',
          trigger_type: 'lane_classified',
          dimensions: ecoDimensionsToConfidence(eco.eco_dimensions),
          effective_lane: laneOutput.lane,
          gates: { lane: laneOutput.lane },
          previous: prevConfidenceSnapshot,
        });
        emitConfidenceSnapshot(snapshot);
      }
    }

    // ── Sprint 15: Timeout post-processing ────────────────────────────────
    if (!isReplayed && !isRejected && pendingTimeoutEvent?.timed_out) {
      stageTimeouts.push(pendingTimeoutEvent);
      executionWarnings.push(`Stage ${stage} timed out after ${timeoutConfig.timeoutMs}ms`);

      result.trace.timedOut        = true;
      result.trace.timeoutMs       = timeoutConfig.timeoutMs;
      result.trace.failureClass    = 'timeout';
      result.trace.fallbackApplied = pendingTimeoutEvent.fallback_applied;

      if (!timeoutConfig.isCritical) {
        degradedStages.push(stage);
        degraded = true;
      }
    }

    // ── Check for BLOCK ────────────────────────────────────────────────────
    if (result.status === "blocked") {
      const blockedResult = buildBlockedResult(
        stage, stageResults, escalated, degraded, stageTimeouts, degradedStages, executionWarnings,
        replayedStages, rejectedDuplicateStages, input, traceId, requestId, prevLedgerId,
      );
      return blockedResult;
    }

    if (result.status === "escalated") escalated = true;
    if (result.status === "degraded") degraded = true;

    // ── SUFFICIENCY_GATE special: block/ask behavior from output ──────────
    if (stage === "SUFFICIENCY_GATE" && result.status === "ok" && !isReplayed && !isRejected) {
      const gate = result.output as SufficiencyGateOutput;
      if (gate.behavior === "block" || gate.behavior === "ask") {
        const gateBlockResult: OrchestratorResult = {
          completed: false,
          blocked: true,
          blockedAt: stage,
          escalated,
          degraded,
          stageResults,
          finalLane: undefined,
          stageTimeouts,
          degradedStages,
          executionWarnings,
          replayedStages,
          rejectedDuplicateStages,
        };
        if (input.onLedgerEntry) {
          try {
            const refusalCode = gate.behavior === "block" ? "EVIDENCE_GATE_REFUSED" : "EVIDENCE_GATE_CLARIFY";
            const refusalEntry = fromRefusal(
              'classification', refusalCode, gate.reason,
              { trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId },
            );
            prevLedgerId = refusalEntry.ledger_id;
            input.onLedgerEntry(refusalEntry);

            const outcomeEntry = fromOrchestratorResult(gateBlockResult, {
              trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId,
            });
            input.onLedgerEntry(outcomeEntry);
          } catch { /* ledger failure must not crash pipeline */ }
        }
        return gateBlockResult;
      }
    }
  }

  const finalResult: OrchestratorResult = {
    completed: true,
    blocked: false,
    escalated,
    degraded,
    stageResults,
    finalLane: laneOutput?.lane,
    stageTimeouts,
    degradedStages,
    executionWarnings,
    replayedStages,
    rejectedDuplicateStages,
  };

  // Emit terminal outcome for completed pipeline
  if (input.onLedgerEntry) {
    try {
      // Sprint 21: emit final_outcome_sealed confidence snapshot
      if (input.enableConfidenceTracking && ecoOutput) {
        const eco = ecoOutput as EcoBuildOutput & { forced_unknown?: boolean };
        confidenceSnapshotIndex++;
        const finalSnapshot = buildConfidenceSnapshot({
          snapshot_index: confidenceSnapshotIndex,
          computed_confidence: eco.confidence_score,
          stage_name: 'OUTCOME',
          trigger_type: 'final_outcome_sealed',
          dimensions: ecoDimensionsToConfidence(eco.eco_dimensions),
          forced_unknown: eco.forced_unknown,
          effective_lane: laneOutput?.lane,
          gates: laneOutput ? { lane: laneOutput.lane } : undefined,
          previous: prevConfidenceSnapshot,
        });
        emitConfidenceSnapshot(finalSnapshot);
      }

      const outcomeEntry = fromOrchestratorResult(finalResult, {
        trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId,
      });
      input.onLedgerEntry(outcomeEntry);
    } catch { /* ledger failure must not crash pipeline */ }
  }

  return finalResult;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function makePassDimensions() {
  return {
    coverage:  { severity: "pass", detail: "" },
    freshness: { severity: "pass", detail: "" },
    mapping:   { severity: "pass", detail: "" },
    conflict:  { severity: "pass", detail: "", conflict_payload: null },
    graph:     { severity: "pass", detail: "" },
  };
}

function filterKeys(keys: Array<string | undefined>): string[] {
  return keys.filter((k): k is string => k !== undefined);
}

function hashOutput(output: unknown): string {
  return createHash('sha256').update(JSON.stringify(output)).digest('hex');
}

function makeClaimRecord(
  stage: StageId,
  executionKey: string,
  contractVersion: string,
  normalizedInput: unknown,
  traceId: string,
  requestId: string,
): StageExecutionRecord {
  return {
    execution_key:    executionKey,
    stage_id:         stage,
    contract_version: contractVersion,
    input_hash:       createHash('sha256').update(JSON.stringify(normalizedInput)).digest('hex'),
    status:           'in_progress',
    trace_id:         traceId,
    request_id:       requestId,
    started_at:       new Date().toISOString(),
  };
}

function finalizeStore(
  store: StageExecutionStore,
  executionKey: string,
  result: StageResult,
): void {
  if (result.status === 'ok' || result.status === 'degraded') {
    store.complete(executionKey, result.output, hashOutput(result.output));
  } else {
    store.fail(executionKey);
  }
}

function makeReplayResult(
  stage: StageId,
  output: unknown,
  record: StageExecutionRecord,
): StageResult {
  return {
    stage,
    status: 'ok',
    output,
    trace: {
      stage,
      status:     'ok',
      inputHash:  record.input_hash,
      timestamp:  new Date().toISOString(),
      durationMs: 0,
      input:      null,
      output,
    },
  };
}

function makeRejectedResult(stage: StageId): StageResult {
  return {
    stage,
    status: 'degraded',
    output: undefined,
    trace: {
      stage,
      status:     'degraded',
      inputHash:  '',
      timestamp:  new Date().toISOString(),
      durationMs: 0,
      input:      null,
      output:     undefined,
      errorMessage: 'Stage rejected: duplicate in-flight execution',
      failureClass: 'error',
    },
  };
}

function emitRejectionLedger(
  stage: StageId,
  executionKey: string,
  traceId: string,
  requestId: string,
  prevLedgerId: string | undefined,
  onLedgerEntry: ((entry: LedgerEntry) => void) | undefined,
): void {
  if (!onLedgerEntry) return;
  try {
    const rejectionEntry = fromStageRejection(
      {
        stageId:         stage,
        executionKey,
        rejectionReason: 'duplicate_inflight: another orchestrator instance is executing this stage',
      },
      { trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId },
    );
    onLedgerEntry(rejectionEntry);
  } catch { /* ledger failure must not crash pipeline */ }
}

function buildBlockedResult(
  stage: StageId,
  stageResults: Array<StageResult & { stage: StageId }>,
  escalated: boolean,
  degraded: boolean,
  stageTimeouts: StageTimeoutEvent[],
  degradedStages: StageId[],
  executionWarnings: string[],
  replayedStages: StageId[],
  rejectedDuplicateStages: StageId[],
  input: OrchestratorInput,
  traceId: string,
  requestId: string,
  prevLedgerId: string | undefined,
): OrchestratorResult {
  const blockedResult: OrchestratorResult = {
    completed: false,
    blocked: true,
    blockedAt: stage,
    escalated,
    degraded,
    stageResults,
    finalLane: undefined,
    stageTimeouts,
    degradedStages,
    executionWarnings,
    replayedStages,
    rejectedDuplicateStages,
  };
  if (input.onLedgerEntry) {
    try {
      const outcomeEntry = fromOrchestratorResult(blockedResult, {
        trace_id: traceId, request_id: requestId, parent_ledger_id: prevLedgerId,
      });
      input.onLedgerEntry(outcomeEntry);
    } catch { /* ledger failure must not crash pipeline */ }
  }
  return blockedResult;
}
