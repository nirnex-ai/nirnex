// PreToolUse hook handler.
// Called before Claude executes each tool call.
// Loads the active task envelope and evaluates the tool against lane policy.

import fs from 'node:fs';
import path from 'node:path';
import { loadActiveEnvelope, appendHookEvent, generateEventId, generateRunId } from './session.js';
import { HookPreToolUse, GuardDecision, TaskEnvelope, HookInvocationStartedEvent } from './types.js';

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
  });
}

function extractAffectedFile(toolName: string, toolInput: Record<string, unknown>): string | null {
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') {
    return (toolInput.file_path ?? toolInput.path ?? null) as string | null;
  }
  if (toolName === 'MultiEdit') {
    const edits = toolInput.edits as Array<{ file_path?: string }> | undefined;
    return edits?.[0]?.file_path ?? null;
  }
  return null;
}

function matchesDeniedPattern(command: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    if (command.includes(pattern)) return pattern;
  }
  return null;
}

function evaluateGuard(envelope: TaskEnvelope, toolName: string, toolInput: Record<string, unknown>): GuardDecision {
  const policy = envelope.tool_policy;

  // If tool doesn't require guarding for this lane, allow immediately
  if (!policy.requires_guard.includes(toolName)) {
    return { decision: 'allow' };
  }

  // Bash: check denylist
  if (toolName === 'Bash') {
    const command = (toolInput.command ?? '') as string;
    const matched = matchesDeniedPattern(command, policy.denied_patterns);
    if (matched) {
      return {
        decision: 'deny',
        reason: `[Nirnex Guard] Command contains denied pattern "${matched}" (Lane ${envelope.lane} policy).`,
      };
    }
    // For Lane C, ask for commands that touch git or system state
    if (envelope.lane === 'C' && /\b(git|rm|mv|chmod|chown)\b/.test(command)) {
      return {
        decision: 'ask',
        message: `[Nirnex Guard] Lane C task — confirm this command is within scope:\n  ${command}`,
      };
    }
    return { decision: 'allow' };
  }

  // Edit / Write / MultiEdit: check scope
  const filePath = extractAffectedFile(toolName, toolInput);
  if (filePath && envelope.scope.blocked_paths.length > 0) {
    for (const blocked of envelope.scope.blocked_paths) {
      if (filePath.includes(blocked)) {
        return {
          decision: 'deny',
          reason: `[Nirnex Guard] File "${filePath}" is in a blocked path "${blocked}" for this task.`,
        };
      }
    }
  }

  // Lane C: require file to be within expected scope
  if (envelope.lane === 'C' && filePath && envelope.scope.allowed_paths.length > 0) {
    const inScope = envelope.scope.allowed_paths.some(p => filePath.includes(p));
    if (!inScope) {
      return {
        decision: 'ask',
        message: `[Nirnex Guard] Lane C — "${filePath}" is outside the expected scope [${envelope.scope.allowed_paths.join(', ')}]. Proceed?`,
      };
    }
  }

  return { decision: 'allow' };
}

export async function runGuard(): Promise<void> {
  const runId = generateRunId();
  const raw = await readStdin();

  let hookData: HookPreToolUse = {
    session_id: 'unknown',
    hook_event_name: 'PreToolUse',
    tool_name: '',
    tool_input: {},
  };

  try {
    hookData = JSON.parse(raw || '{}') as HookPreToolUse;
  } catch {
    // Non-fatal: allow on parse failure
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const repoRoot = process.env.NIRNEX_REPO_ROOT ?? process.cwd();
  const sessionId = hookData.session_id ?? process.env.NIRNEX_SESSION_ID ?? '';

  const invocationEvent: HookInvocationStartedEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: 'none',
    run_id: runId,
    hook_stage: 'guard',
    event_type: 'HookInvocationStarted',
    payload: { stage: 'guard', cwd: process.cwd(), repo_root: repoRoot, pid: process.pid },
  };
  appendHookEvent(repoRoot, sessionId, invocationEvent);

  // Allow if not in a Nirnex project
  if (!fs.existsSync(path.join(repoRoot, 'nirnex.config.json'))) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const envelope = loadActiveEnvelope(repoRoot, sessionId);

  // No active envelope → allow (not in a guarded task context)
  if (!envelope) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const decision = evaluateGuard(envelope, hookData.tool_name, hookData.tool_input);
  process.stdout.write(JSON.stringify(decision));
  process.exit(0);
}
