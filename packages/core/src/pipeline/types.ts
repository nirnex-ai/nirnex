/**
 * Pipeline Types — Stage Machine Contracts
 *
 * Defines the canonical STAGES tuple (immutable), StageId union,
 * StageResult<T>, FailureMode, and all I/O types per stage.
 *
 * Design constraints:
 *   - STAGES is frozen (readonly + Object.freeze) — no mutation possible
 *   - StageResult carries a trace record on every execution
 *   - FailureMode drives downstream behavior: BLOCK | ESCALATE | DEGRADE
 */

// ─── Stage Registry ───────────────────────────────────────────────────────────

/**
 * Canonical stage ordering. Frozen at module load — immutable at runtime.
 * Any attempt to write to this array will throw in strict mode.
 */
export const STAGES = Object.freeze([
  "INTENT_DETECT",
  "ECO_BUILD",
  "SUFFICIENCY_GATE",
  "TEE_BUILD",
  "CLASSIFY_LANE",
] as const);

export type StageId = (typeof STAGES)[number];

// ─── Failure Modes ────────────────────────────────────────────────────────────

/**
 * BLOCK   — hard stop; pipeline halts immediately after this stage
 * ESCALATE — soft failure; pipeline continues but sets escalation flag
 * DEGRADE  — soft failure; pipeline continues with fallback output
 */
export type FailureMode = "BLOCK" | "ESCALATE" | "DEGRADE";

// ─── Stage Result ─────────────────────────────────────────────────────────────

export interface BoundTrace {
  stage: StageId;
  status: "ok" | "blocked" | "escalated" | "degraded";
  inputHash: string;
  timestamp: string;
  durationMs: number;
  input: unknown;
  output: unknown;
  errorMessage?: string;
  // Sprint 15: populated by orchestrator when a stage times out
  timedOut?: boolean;
  timeoutMs?: number;
  failureClass?: 'timeout' | 'error' | null;
  fallbackApplied?: boolean;
}

export interface StageResult<T = unknown> {
  stage: StageId;
  status: "ok" | "blocked" | "escalated" | "degraded";
  output?: T;
  error?: Error;
  trace: BoundTrace;
}

// ─── Validation Result ────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ─── Per-Stage I/O types ──────────────────────────────────────────────────────

// INTENT_DETECT
export interface IntentDetectInput {
  specPath: string | null;
  query?: string;
}

export interface IntentDetectOutput {
  primary: string;
  composite: boolean;
  secondary?: string;
  confidence?: string;
  retrieval_strategy?: string[];
  constraint_rule?: string;
  error?: string;
}

// ECO_BUILD
export interface EcoBuildInput {
  intent: IntentDetectOutput;
  specPath: string | null;
  targetRoot?: string;
}

export interface EcoDimensions {
  coverage: { severity: string; detail?: string };
  freshness: { severity: string; detail?: string };
  mapping: { severity: string; detail?: string };
  conflict: { severity: string; detail?: string; conflict_payload?: unknown };
  graph: { severity: string; detail?: string };
}

export interface EcoBuildOutput {
  intent: IntentDetectOutput;
  eco_dimensions: EcoDimensions;
  confidence_score: number;
  [key: string]: unknown;
}

// SUFFICIENCY_GATE
export type SufficiencyGateInput = EcoBuildOutput;

export interface SufficiencyGateOutput {
  behavior: "pass" | "block" | "ask" | "explore";
  lane: string;
  reason: string;
}

// TEE_BUILD
export interface TeeBuildInput {
  eco: EcoBuildOutput;
  gate: SufficiencyGateOutput;
}

export interface TeeBuildOutput {
  blocked_paths: string[];
  blocked_symbols: string[];
  clarification_questions: string[];
  proceed_warnings: string[];
}

// CLASSIFY_LANE
export interface ClassifyLaneInput {
  eco: EcoBuildOutput & {
    forced_lane_minimum?: string;
    forced_unknown?: boolean;
    critical_path_hit?: boolean;
    boundary_warnings?: string[];
  };
  tee: TeeBuildOutput;
}

export interface ClassifyLaneOutput {
  lane: string;
  set_by: "P1" | "P2" | "P3" | "P4";
  reason: string;
}

// ─── Orchestrator version ─────────────────────────────────────────────────────

/**
 * Increment when orchestrator logic changes in a way that could affect outputs.
 * Changing this version invalidates all cached stage executions.
 */
export const ORCHESTRATOR_VERSION = '1.0.0' as const;

// ─── Stage contract versions ──────────────────────────────────────────────────

/**
 * Per-stage I/O contract versions. Increment a stage's version when its
 * input or output schema changes in a semantically significant way.
 * A version bump forces re-execution even for previously cached inputs.
 */
export const STAGE_CONTRACT_VERSIONS: Record<StageId, string> = {
  INTENT_DETECT:    '1.0.0',
  ECO_BUILD:        '1.0.0',
  SUFFICIENCY_GATE: '1.0.0',
  TEE_BUILD:        '1.0.0',
  CLASSIFY_LANE:    '1.0.0',
} as const;

// ─── Stage idempotency metadata ───────────────────────────────────────────────

export interface StageIdempotencyMeta {
  mode: 'required' | 'none';
  side_effect_class: 'pure' | 'external_mutation';
}

/**
 * Idempotency configuration for each pipeline stage.
 * All current stages are pure — they produce no external side effects.
 */
export const STAGE_IDEMPOTENCY: Record<StageId, StageIdempotencyMeta> = {
  INTENT_DETECT:    { mode: 'required', side_effect_class: 'pure' },
  ECO_BUILD:        { mode: 'required', side_effect_class: 'pure' },
  SUFFICIENCY_GATE: { mode: 'required', side_effect_class: 'pure' },
  TEE_BUILD:        { mode: 'required', side_effect_class: 'pure' },
  CLASSIFY_LANE:    { mode: 'required', side_effect_class: 'pure' },
} as const;

// ─── StageIOMap — associates each StageId with its I/O types ─────────────────

export interface StageIOMap {
  INTENT_DETECT:   { input: IntentDetectInput;    output: IntentDetectOutput };
  ECO_BUILD:       { input: EcoBuildInput;         output: EcoBuildOutput };
  SUFFICIENCY_GATE: { input: SufficiencyGateInput; output: SufficiencyGateOutput };
  TEE_BUILD:       { input: TeeBuildInput;         output: TeeBuildOutput };
  CLASSIFY_LANE:   { input: ClassifyLaneInput;     output: ClassifyLaneOutput };
}
