// UserPromptSubmit hook handler.
// Called before Claude processes each user prompt.
// Builds ECO from the prompt, creates a task envelope, writes session state,
// and returns additionalContext so Claude sees the envelope before acting.

import fs from 'node:fs';
import path from 'node:path';
import { buildEnvelope, formatEnvelopeContext } from './envelope.js';
import { loadSession, saveSession, saveEnvelope, generateTaskId, appendHookEvent, generateEventId, generateRunId } from './session.js';
import {
  HookPromptSubmit,
  ContextOutput,
  HookInvocationStartedEvent,
  InputEnvelopeCapturedEvent,
  StageCompletedEvent,
  VerificationRequirementSource,
} from './types.js';

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
  });
}

// Extract explicit verification commands from the user prompt.
// Looks for patterns like "run npm test", "verify with pytest", etc.
function extractVerificationCommands(prompt: string): string[] {
  const commands: string[] = [];
  const patterns = [
    /run\s+(npm\s+test|yarn\s+test|pnpm\s+test|pytest|cargo\s+test|go\s+test|make\s+test|jest|mocha|vitest)/gi,
    /verify\s+(?:with\s+|by\s+running\s+)?([a-z][\w\s-]{2,40})/gi,
    /check\s+(?:that\s+)?(?:tests?\s+pass|build\s+succeeds|lint\s+passes)/gi,
    /ensure\s+(?:tests?\s+pass|all\s+tests?\s+green|no\s+lint\s+errors?)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      const cmd = (m[1] ?? m[0]).trim().toLowerCase();
      if (!commands.includes(cmd)) commands.push(cmd);
    }
  }
  return commands;
}

// Determine why verification is mandatory, in priority order.
function deriveVerificationRequirementSource(
  prompt: string,
  acceptanceCriteria: string[],
  lane: string,
  verificationCommands: string[],
): VerificationRequirementSource {
  // Explicit instruction takes highest priority
  if (
    verificationCommands.length > 0 ||
    /\b(verify|run tests?|make sure tests? pass|ensure tests? pass|check that tests?)\b/i.test(prompt)
  ) {
    return 'explicit_user_instruction';
  }
  if (acceptanceCriteria.length > 0) {
    return 'acceptance_criteria';
  }
  if (lane === 'B' || lane === 'C') {
    return 'lane_policy';
  }
  return 'none';
}

export async function runEntry(): Promise<void> {
  const runId = generateRunId();

  let hookData: HookPromptSubmit = {
    session_id: 'unknown',
    hook_event_name: 'UserPromptSubmit',
    prompt: '',
  };

  const raw = await readStdin();

  try {
    hookData = JSON.parse(raw || '{}') as HookPromptSubmit;
  } catch {
    // Non-fatal: proceed with empty prompt
  }

  const repoRoot = process.env.NIRNEX_REPO_ROOT ?? process.cwd();
  const sessionId = hookData.session_id ?? process.env.NIRNEX_SESSION_ID ?? `sess_${Date.now().toString(36)}`;
  const prompt = hookData.prompt ?? '';

  // Emit invocation evidence before any early exits
  const invocationEvent: HookInvocationStartedEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: 'none',
    run_id: runId,
    hook_stage: 'entry',
    event_type: 'HookInvocationStarted',
    payload: { stage: 'entry', cwd: process.cwd(), repo_root: repoRoot, pid: process.pid },
  };
  appendHookEvent(repoRoot, sessionId, invocationEvent);

  // Skip if not a Nirnex project
  if (!fs.existsSync(path.join(repoRoot, 'nirnex.config.json'))) {
    process.exit(0);
  }

  // Skip very short or empty prompts (e.g. clarifications, single words)
  if (prompt.trim().length < 10) {
    process.exit(0);
  }

  let eco: Record<string, any> = {};
  try {
    const { buildECO } = await import('@nirnex/core/dist/eco.js');
    eco = buildECO(null, repoRoot, { query: prompt });
  } catch {
    // Degraded mode: use a minimal ECO
    eco = {
      recommended_lane: 'A',
      forced_lane_minimum: 'A',
      confidence_score: 50,
      forced_unknown: false,
      blocked: false,
      intent: { primary: 'unknown' },
      modules_touched: [],
      penalties: [],
      escalation_reasons: [],
      boundary_warnings: [],
      eco_dimensions: {},
      evidence_checkpoints: {},
    };
  }

  const envelope = buildEnvelope(eco, prompt, sessionId);

  // Persist envelope and link to session
  saveEnvelope(repoRoot, envelope);

  const session = loadSession(repoRoot, sessionId);
  if (session) {
    session.active_task_id = envelope.task_id;
    session.tasks.push(envelope.task_id);
    saveSession(repoRoot, session);
  }

  // Emit obligation record — proves the system knew what was required at task start
  const verificationCommands = extractVerificationCommands(prompt);
  const verificationRequirementSource = deriveVerificationRequirementSource(
    prompt,
    envelope.acceptance_criteria,
    envelope.lane,
    verificationCommands,
  );
  const mandatoryVerificationRequired =
    verificationRequirementSource === 'explicit_user_instruction' ||
    verificationRequirementSource === 'acceptance_criteria' ||
    (verificationRequirementSource === 'lane_policy' && (envelope.lane === 'B' || envelope.lane === 'C'));

  const obligationEvent: InputEnvelopeCapturedEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: envelope.task_id,
    run_id: runId,
    hook_stage: 'entry',
    event_type: 'InputEnvelopeCaptured',
    payload: {
      task_id: envelope.task_id,
      lane: envelope.lane,
      blocked: envelope.eco_summary.blocked,
      forced_unknown: envelope.eco_summary.forced_unknown,
      acceptance_criteria_count: envelope.acceptance_criteria.length,
      constraints_count: envelope.constraints.length,
      verification_commands_detected: verificationCommands.length > 0,
      verification_commands: verificationCommands,
      mandatory_verification_required: mandatoryVerificationRequired,
      verification_requirement_source: verificationRequirementSource,
    },
  };
  appendHookEvent(repoRoot, sessionId, obligationEvent);

  // Block if ECO says blocked
  if (eco.blocked) {
    const stageEvent: StageCompletedEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      task_id: envelope.task_id,
      run_id: runId,
      hook_stage: 'entry',
      event_type: 'StageCompleted',
      status: 'fail',
      payload: { stage: 'entry', blocker_count: 1, violation_count: 0, emitted_artifacts: [] },
    };
    appendHookEvent(repoRoot, sessionId, stageEvent);

    const output: ContextOutput = {
      blockMessage: `[Nirnex] Task blocked by ECO. Reasons: ${(eco.escalation_reasons ?? []).join('; ') || 'unknown'}. Please revise the spec or run nirnex plan for details.`,
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  // Emit stage completion
  const stageEvent: StageCompletedEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: envelope.task_id,
    run_id: runId,
    hook_stage: 'entry',
    event_type: 'StageCompleted',
    status: 'pass',
    payload: {
      stage: 'entry',
      blocker_count: 0,
      violation_count: 0,
      emitted_artifacts: [envelope.task_id],
    },
  };
  appendHookEvent(repoRoot, sessionId, stageEvent);

  // Return envelope context to Claude
  const contextText = formatEnvelopeContext(envelope);
  const output: ContextOutput = { additionalContext: contextText };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}
