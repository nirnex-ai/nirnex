// Converts an ECO (Execution Context Object) into a TaskEnvelope (TEE).
// The envelope is the actionable, policy-bearing runtime representation.

import { TaskEnvelope, Lane } from './types.js';
import { generateTaskId } from './session.js';
import { getConfidenceLabel } from '@nirnex/core/dist/confidence.js';
import type { TEEConflictSection } from '@nirnex/core/dist/knowledge/conflict/types.js';

const LANE_TOOL_POLICY: Record<Lane, TaskEnvelope['tool_policy']> = {
  A: {
    allowed_tools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
    requires_guard: [],
    denied_patterns: [],
  },
  B: {
    allowed_tools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
    requires_guard: ['Edit', 'Write', 'MultiEdit'],
    denied_patterns: ['rm -rf', 'git reset --hard', 'git push --force', 'git push -f'],
  },
  C: {
    allowed_tools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
    requires_guard: ['Bash', 'Edit', 'Write', 'MultiEdit'],
    denied_patterns: [
      'rm -rf', 'git reset --hard', 'git push --force', 'git push -f',
      'DROP TABLE', 'ALTER TABLE', 'truncate', '> /dev/null 2>&1 &',
    ],
  },
};

export function buildEnvelope(eco: Record<string, any>, prompt: string, sessionId: string): TaskEnvelope {
  const lane = (eco.recommended_lane ?? eco.forced_lane_minimum ?? 'A') as Lane;
  const taskId = generateTaskId();

  // Derive scope from ECO
  const modulesTouched: string[] = eco.modules_touched ?? [];

  // Merge conflict-detected blocked paths with boundary warning paths
  const conflictTEE: TEEConflictSection | null = eco.tee_conflict ?? null;
  const conflictBlockedPaths: string[] = conflictTEE?.blocked_paths ?? [];
  const blockedPaths: string[] = [
    ...conflictBlockedPaths,
    ...(eco.boundary_warnings ?? []).map((w: string) => w.split(':')[0]).filter(Boolean),
  ].filter((v, i, a) => a.indexOf(v) === i);

  // Derive acceptance criteria from evidence checkpoints
  const checkpoints = eco.evidence_checkpoints ?? {};
  const acceptanceCriteria: string[] = Object.keys(checkpoints).map(k => `checkpoint:${k}`);

  // Derive constraints from dimension severities
  const constraints: string[] = [];
  const dims = eco.eco_dimensions ?? {};
  for (const [dim, val] of Object.entries(dims)) {
    const v = val as { severity: string; detail: string };
    if (v.severity === 'warn' || v.severity === 'escalate') {
      constraints.push(`dimension:${dim}:${v.severity}${v.detail ? ' — ' + v.detail : ''}`);
    } else if (v.severity === 'block') {
      constraints.push(`dimension:${dim}:blocked${v.detail ? ' — ' + v.detail : ''}`);
    }
  }
  for (const r of (eco.escalation_reasons ?? [])) {
    constraints.push(`escalation:${r}`);
  }

  // Inject conflict clarification questions as constraints
  for (const q of (conflictTEE?.clarification_questions ?? [])) {
    constraints.push(`conflict_clarification:${q}`);
  }
  // Inject conflict warnings as constraints
  for (const w of (conflictTEE?.proceed_warnings ?? [])) {
    constraints.push(`conflict_warning:${w}`);
  }

  const penalties = eco.penalties ?? [];
  const confidenceScore: number = eco.confidence_score ?? 100;

  const envelope: TaskEnvelope = {
    task_id: taskId,
    session_id: sessionId,
    created_at: new Date().toISOString(),
    prompt,
    lane,
    scope: {
      allowed_paths: modulesTouched,
      blocked_paths: blockedPaths,
      modules_expected: modulesTouched,
    },
    constraints,
    acceptance_criteria: acceptanceCriteria,
    tool_policy: LANE_TOOL_POLICY[lane],
    stop_conditions: {
      required_validations: acceptanceCriteria,
      forbidden_files: blockedPaths,
    },
    confidence: {
      score: confidenceScore,
      label: getConfidenceLabel(confidenceScore),
      penalties,
    },
    eco_summary: {
      intent: eco.intent?.primary ?? 'unknown',
      recommended_lane: eco.recommended_lane ?? 'A',
      forced_unknown: eco.forced_unknown ?? false,
      blocked: eco.blocked ?? false,
      escalation_reasons: eco.escalation_reasons ?? [],
      boundary_warnings: eco.boundary_warnings ?? [],
    },
    ...(conflictTEE ? { conflict: conflictTEE } : {}),
    status: 'active',
  };

  return envelope;
}

export function formatEnvelopeContext(envelope: TaskEnvelope): string {
  const lines: string[] = [
    `[Nirnex] Task ${envelope.task_id} · Lane ${envelope.lane} · Confidence ${envelope.confidence.score}% (${envelope.confidence.label})`,
    `Intent: ${envelope.eco_summary.intent}`,
  ];

  if (envelope.eco_summary.forced_unknown) {
    lines.push(`⚠ ECO forced unknown — proceed with caution`);
  }
  if (envelope.eco_summary.blocked) {
    lines.push(`✘ Task blocked by ECO — do not proceed with implementation`);
  }
  if (envelope.scope.allowed_paths.length > 0) {
    lines.push(`Scope: ${envelope.scope.allowed_paths.join(', ')}`);
  }
  if (envelope.constraints.length > 0) {
    lines.push(`Constraints: ${envelope.constraints.slice(0, 3).join('; ')}`);
  }
  if (envelope.tool_policy.requires_guard.length > 0) {
    lines.push(`Guarded tools (Lane ${envelope.lane}): ${envelope.tool_policy.requires_guard.join(', ')}`);
  }
  if (envelope.eco_summary.escalation_reasons.length > 0) {
    lines.push(`Escalation: ${envelope.eco_summary.escalation_reasons.join('; ')}`);
  }

  // Surface conflict findings
  if (envelope.conflict) {
    const c = envelope.conflict;
    if (c.blocked_paths.length > 0) {
      lines.push(`Conflict-blocked paths: ${c.blocked_paths.join(', ')}`);
    }
    if (c.clarification_questions.length > 0) {
      lines.push(`Clarification required: ${c.clarification_questions[0]}`);
    }
    if (c.proceed_warnings.length > 0) {
      lines.push(`Conflict warnings: ${c.proceed_warnings.slice(0, 2).join('; ')}`);
    }
  }

  return lines.join('\n');
}
