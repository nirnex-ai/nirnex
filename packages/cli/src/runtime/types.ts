// Shared types for the Nirnex runtime hook pipeline.

export type Lane = 'A' | 'B' | 'C';

// Conflict section surfaced in the TEE — derived from conflict detection subsystem.
export type TEEConflictSection = {
  blocked_paths: string[];
  blocked_symbols: string[];
  clarification_questions: string[];
  proceed_warnings: string[];
};

export interface NirnexSession {
  session_id: string;
  repo_root: string;
  db_path: string;
  index_freshness: 'fresh' | 'stale' | 'unknown';
  current_head: string;
  policy_mode: 'strict' | 'standard' | 'permissive';
  created_at: string;
  tasks: string[];
  active_task_id?: string;
}

export interface TaskEnvelope {
  task_id: string;
  session_id: string;
  created_at: string;
  prompt: string;
  lane: Lane;
  scope: {
    allowed_paths: string[];
    blocked_paths: string[];
    modules_expected: string[];
  };
  constraints: string[];
  acceptance_criteria: string[];
  tool_policy: {
    allowed_tools: string[];
    requires_guard: string[];
    denied_patterns: string[];
  };
  stop_conditions: {
    required_validations: string[];
    forbidden_files: string[];
  };
  confidence: {
    score: number;
    label: string;
    penalties: Array<{ rule: string; deduction: number; detail: string }>;
  };
  eco_summary: {
    intent: string;
    recommended_lane: string;
    forced_unknown: boolean;
    blocked: boolean;
    escalation_reasons: string[];
    boundary_warnings: string[];
  };
  conflict?: TEEConflictSection;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

export interface TraceEvent {
  event_id: string;
  session_id: string;
  task_id: string;
  timestamp: string;
  tool: string;
  tool_input: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
  affected_files: string[];
  deviation_flags: string[];
}

// ─── Hook Audit Trail ──────────────────────────────────────────────────────

export type HookStage = 'bootstrap' | 'entry' | 'guard' | 'trace' | 'validate';

export type HookEventType =
  | 'HookInvocationStarted'
  | 'InputEnvelopeCaptured'
  | 'ContractViolationDetected'
  | 'StageCompleted'
  | 'FinalOutcomeDeclared';

// Never infer missing state from absence of events — always use an explicit status value.
export type VerificationStatus = 'pass' | 'fail' | 'skipped' | 'unknown' | 'not_requested';

export type VerificationRequirementSource =
  | 'explicit_user_instruction'
  | 'acceptance_criteria'
  | 'lane_policy'
  | 'none';

export const ReasonCode = {
  VERIFICATION_NOT_REQUESTED: 'VERIFICATION_NOT_REQUESTED',
  VERIFICATION_REQUIRED_NOT_RUN: 'VERIFICATION_REQUIRED_NOT_RUN',
  COMMAND_EXIT_NONZERO: 'COMMAND_EXIT_NONZERO',
  ACCEPTANCE_NOT_EVALUATED: 'ACCEPTANCE_NOT_EVALUATED',
  SUMMARY_CONTRADICTS_EVIDENCE: 'SUMMARY_CONTRADICTS_EVIDENCE',
  BLOCKED_PATH_DEVIATION: 'BLOCKED_PATH_DEVIATION',
  FORCED_UNKNOWN_NO_VERIFICATION: 'FORCED_UNKNOWN_NO_VERIFICATION',
  LANE_C_EMPTY_TRACE: 'LANE_C_EMPTY_TRACE',
  LANE_C_DEADLOCK: 'LANE_C_DEADLOCK',
  ECO_BLOCKED: 'ECO_BLOCKED',
} as const;

export type ReasonCodeValue = typeof ReasonCode[keyof typeof ReasonCode];

// Universal fields present on every HookEvent
interface HookEventBase {
  event_id: string;
  timestamp: string;
  session_id: string;
  task_id: string;
  run_id: string;
  hook_stage: HookStage;
  event_type: HookEventType;
}

export interface HookInvocationStartedEvent extends HookEventBase {
  event_type: 'HookInvocationStarted';
  payload: {
    stage: HookStage;
    cwd: string;
    repo_root: string;
    pid: number;
    nirnex_version?: string;
  };
}

export interface InputEnvelopeCapturedEvent extends HookEventBase {
  event_type: 'InputEnvelopeCaptured';
  payload: {
    task_id: string;
    lane: string;
    blocked: boolean;
    forced_unknown: boolean;
    acceptance_criteria_count: number;
    constraints_count: number;
    verification_commands_detected: boolean;
    verification_commands: string[];
    mandatory_verification_required: boolean;
    verification_requirement_source: VerificationRequirementSource;
  };
}

export interface ContractViolationDetectedEvent extends HookEventBase {
  event_type: 'ContractViolationDetected';
  status: 'violated';
  payload: {
    reason_code: ReasonCodeValue;
    violated_contract: string;
    expected: string;
    actual: string;
    severity: 'blocking' | 'advisory';
    blocking_action_taken: boolean;
  };
}

export interface StageCompletedEvent extends HookEventBase {
  event_type: 'StageCompleted';
  status: 'pass' | 'fail';
  payload: {
    stage: HookStage;
    blocker_count: number;
    violation_count: number;
    emitted_artifacts?: string[];
  };
}

export interface FinalOutcomeDeclaredEvent extends HookEventBase {
  event_type: 'FinalOutcomeDeclared';
  payload: {
    decision: 'allow' | 'block';
    violation_count: number;
    blocking_violation_count: number;
    advisory_violation_count: number;
    reason_codes: ReasonCodeValue[];
    verification_status: VerificationStatus;
    acceptance_status: VerificationStatus;
    envelope_status: string;
  };
}

export type HookEvent =
  | HookInvocationStartedEvent
  | InputEnvelopeCapturedEvent
  | ContractViolationDetectedEvent
  | StageCompletedEvent
  | FinalOutcomeDeclaredEvent;

// ─── Claude hook I/O shapes ────────────────────────────────────────────────

// Claude hook I/O shapes

export interface HookSessionStart {
  session_id: string;
  transcript_path?: string;
}

export interface HookPromptSubmit {
  session_id: string;
  transcript_path?: string;
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
}

export interface HookPreToolUse {
  session_id: string;
  transcript_path?: string;
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface HookPostToolUse {
  session_id: string;
  transcript_path?: string;
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result: Record<string, unknown>;
}

export interface HookStop {
  session_id: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
}

// Hook output shapes

export interface GuardDecision {
  decision: 'allow' | 'deny' | 'ask';
  reason?: string;
  message?: string;
}

export interface ValidateDecision {
  decision: 'allow' | 'block';
  reason?: string;
}

export interface ContextOutput {
  additionalContext?: string;
  blockMessage?: string;
}
