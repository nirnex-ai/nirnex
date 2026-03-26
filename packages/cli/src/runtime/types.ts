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
