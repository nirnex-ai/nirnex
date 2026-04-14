// PostToolUse hook handler.
// Called after each tool execution. Appends a trace event, detects deviation,
// and optionally injects context back to Claude if drift is found.

import fs from 'node:fs';
import path from 'node:path';
import { loadActiveEnvelope, appendTraceEvent, appendHookEvent, generateEventId, generateRunId, saveVerificationReceipt } from './session.js';
import { HookPostToolUse, TraceEvent, ContextOutput, HookInvocationStartedEvent, VerificationReceipt } from './types.js';
import { buildTraceStageCompleted } from './stage-completion.js';
import { attestBashExecution, isBashVerificationCommand } from './attestation.js';

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
  });
}

function extractAffectedFiles(toolName: string, toolInput: Record<string, unknown>): string[] {
  const files: string[] = [];
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') {
    const f = toolInput.file_path ?? toolInput.path;
    if (typeof f === 'string') files.push(f);
  } else if (toolName === 'MultiEdit') {
    const edits = toolInput.edits as Array<{ file_path?: string }> | undefined;
    for (const e of edits ?? []) {
      if (e.file_path) files.push(e.file_path);
    }
  } else if (toolName === 'Bash') {
    // Cannot reliably extract files from arbitrary commands
  }
  return files;
}

function detectDeviations(
  affectedFiles: string[],
  toolName: string,
  toolInput: Record<string, unknown>,
  allowedPaths: string[],
  blockedPaths: string[],
  lane: string,
): string[] {
  const flags: string[] = [];

  for (const f of affectedFiles) {
    for (const blocked of blockedPaths) {
      if (f.includes(blocked)) {
        flags.push(`file_in_blocked_path:${f}`);
      }
    }
    if (lane === 'C' && allowedPaths.length > 0) {
      const inScope = allowedPaths.some(p => f.includes(p));
      if (!inScope) {
        flags.push(`file_out_of_scope:${f}`);
      }
    }
  }

  return flags;
}

export async function runTraceHook(): Promise<void> {
  const runId = generateRunId();
  const raw = await readStdin();

  let hookData: HookPostToolUse = {
    session_id: 'unknown',
    hook_event_name: 'PostToolUse',
    tool_name: '',
    tool_input: {},
    tool_result: {},
  };

  try {
    hookData = JSON.parse(raw || '{}') as HookPostToolUse;
  } catch {
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
    hook_stage: 'trace',
    event_type: 'HookInvocationStarted',
    payload: { stage: 'trace', cwd: process.cwd(), repo_root: repoRoot, pid: process.pid },
  };
  appendHookEvent(repoRoot, sessionId, invocationEvent);

  if (!fs.existsSync(path.join(repoRoot, 'nirnex.config.json'))) {
    process.exit(0);
  }

  const envelope = loadActiveEnvelope(repoRoot, sessionId);

  const affectedFiles = extractAffectedFiles(hookData.tool_name, hookData.tool_input);
  const deviationFlags = envelope
    ? detectDeviations(
        affectedFiles,
        hookData.tool_name,
        hookData.tool_input,
        envelope.scope.allowed_paths,
        envelope.scope.blocked_paths,
        envelope.lane,
      )
    : [];

  const toolResult = hookData.tool_response ?? hookData.tool_result;

  // Execution Attestation Layer (Zero-Trust): freeze exit code at capture time
  // for Bash events so validate.ts never needs to re-infer it from tool_result.
  const attestation = hookData.tool_name === 'Bash' && toolResult
    ? attestBashExecution(
        String((hookData.tool_input as Record<string, unknown>)?.command ?? ''),
        toolResult,
      )
    : undefined;

  const event: TraceEvent = {
    event_id: generateEventId(),
    session_id: sessionId,
    task_id: envelope?.task_id ?? 'none',
    timestamp: new Date().toISOString(),
    tool: hookData.tool_name,
    tool_input: hookData.tool_input,
    tool_result: toolResult,
    affected_files: affectedFiles,
    deviation_flags: deviationFlags,
    ...(attestation ? { attestation } : {}),
  };

  try {
    appendTraceEvent(repoRoot, sessionId, event);
  } catch {
    // Non-fatal
  }

  // ── Canonical VerificationReceipt ─────────────────────────────────────────
  // Write a task-scoped receipt whenever a Bash command matches the verification
  // pattern. This is the primary source of truth for validate.ts — it survives
  // task_id binding failures in events.jsonl (which occur when loadActiveEnvelope()
  // returns null, causing all trace events to carry task_id='none').
  //
  // Guard: only written when task_id is known (envelope was loaded). Without a
  // task_id we cannot scope the receipt, so we omit it and rely on the trace event.
  //
  // Rule 4: saveVerificationReceipt() is a no-op when a receipt already exists —
  // only the FIRST verification command for a task is captured.
  if (
    hookData.tool_name === 'Bash' &&
    attestation !== undefined &&
    event.task_id !== 'none'
  ) {
    const cmd = String((hookData.tool_input as Record<string, unknown>)?.command ?? '');
    // Use pattern-only matching in the trace hook — storedVerificationCommands
    // live in hook-events.jsonl which the trace hook does not read to avoid I/O
    // overhead on every PostToolUse. validate.ts applies the stored-command check
    // on top of the receipt to confirm alignment with the obligation event.
    if (isBashVerificationCommand(cmd, [])) {
      const exitCode = attestation.exit_code;
      const receiptStatus: 'pass' | 'fail' | 'unknown' =
        exitCode === 0 ? 'pass' : exitCode !== null ? 'fail' : 'unknown';
      const receipt: VerificationReceipt = {
        receipt_id:         generateEventId(),
        session_id:         sessionId,
        task_id:            event.task_id,
        run_id:             runId,
        command:            cmd,
        normalized_command: cmd.trim(),
        command_hash:       attestation.command_hash,
        started_at:         null,
        finished_at:        attestation.capture_timestamp,
        exit_code:          exitCode,
        status:             receiptStatus,
        source_stage:       'trace-hook',
        captured_at:        new Date().toISOString(),
      };
      try {
        saveVerificationReceipt(repoRoot, receipt);
      } catch {
        // Non-fatal: trace event in events.jsonl remains as the fallback path
      }
    }
  }

  const sc = buildTraceStageCompleted({
    sessionId,
    taskId: envelope?.task_id ?? 'none',
    runId,
    deviationFlags,
  });
  appendHookEvent(repoRoot, sessionId, sc);

  // If deviation detected, inject context back to Claude
  if (deviationFlags.length > 0) {
    const output: ContextOutput = {
      additionalContext: `[Nirnex Trace] Deviation detected in ${hookData.tool_name}: ${deviationFlags.join(', ')}. Verify this is intentional.`,
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}
