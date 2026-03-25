// UserPromptSubmit hook handler.
// Called before Claude processes each user prompt.
// Builds ECO from the prompt, creates a task envelope, writes session state,
// and returns additionalContext so Claude sees the envelope before acting.

import fs from 'node:fs';
import path from 'node:path';
import { buildEnvelope, formatEnvelopeContext } from './envelope.js';
import { loadSession, saveSession, saveEnvelope, generateTaskId } from './session.js';
import { HookPromptSubmit, ContextOutput } from './types.js';

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
  });
}

export async function runEntry(): Promise<void> {
  const raw = await readStdin();

  let hookData: HookPromptSubmit = {
    session_id: 'unknown',
    hook_event_name: 'UserPromptSubmit',
    prompt: '',
  };

  try {
    hookData = JSON.parse(raw || '{}') as HookPromptSubmit;
  } catch {
    // Non-fatal: proceed with empty prompt
  }

  const repoRoot = process.env.NIRNEX_REPO_ROOT ?? process.cwd();
  const sessionId = hookData.session_id ?? process.env.NIRNEX_SESSION_ID ?? `sess_${Date.now().toString(36)}`;
  const prompt = hookData.prompt ?? '';

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

  // Block if ECO says blocked
  if (eco.blocked) {
    const output: ContextOutput = {
      blockMessage: `[Nirnex] Task blocked by ECO. Reasons: ${(eco.escalation_reasons ?? []).join('; ') || 'unknown'}. Please revise the spec or run nirnex plan for details.`,
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  // Return envelope context to Claude
  const contextText = formatEnvelopeContext(envelope);
  const output: ContextOutput = { additionalContext: contextText };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}
