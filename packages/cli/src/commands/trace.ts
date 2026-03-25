// Command: nirnex trace
// View execution traces from .ai-index/traces/

import path from 'node:path';
import { existsSync } from 'node:fs';
import { listTraces, readTrace } from '@nirnex/core/dist/trace.js';

function tick(msg: string) {
  process.stdout.write(`  \x1b[32m✔\x1b[0m ${msg}\n`);
}

function info(msg: string) {
  process.stdout.write(`  \x1b[90m·\x1b[0m ${msg}\n`);
}

function warn(msg: string) {
  process.stdout.write(`  \x1b[33m!\x1b[0m ${msg}\n`);
}

const TRACE_USAGE = `
nirnex trace [options]

Options:
  --last            Show the most recent trace in full
  --list            List recent traces (default)
  --id <trace_id>   Show a specific trace by ID
  --limit <n>       Number of traces to list (default: 20)
`.trimStart();

export function traceCommand(args: string[]): void {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'nirnex.config.json');

  if (!existsSync(configPath)) {
    warn('Not a Nirnex project. Run nirnex setup first.');
    process.exit(1);
  }

  // Parse flags
  const showLast = args.includes('--last');
  const idIdx = args.indexOf('--id');
  const traceId = idIdx !== -1 ? args[idIdx + 1] : undefined;
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) || 20 : 20;
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    process.stdout.write(TRACE_USAGE + '\n');
    return;
  }

  // Show specific trace by ID
  if (traceId) {
    const trace = readTrace(cwd, traceId);
    if (!trace) {
      warn(`Trace not found: ${traceId}`);
      process.exit(1);
    }
    console.log(JSON.stringify(trace, null, 2));
    return;
  }

  // List traces
  const traces = listTraces(cwd, showLast ? 1 : limit);

  if (traces.length === 0) {
    info('No traces found in .ai-index/traces/');
    info('Traces are written by nirnex plan and the runtime entry hook.');
    return;
  }

  if (showLast) {
    // Print full JSON of most recent trace
    const full = readTrace(cwd, traces[0].trace_id);
    console.log(JSON.stringify(full ?? traces[0], null, 2));
    return;
  }

  // Print table
  console.log('\n\x1b[1mNirnex Traces\x1b[0m\n');
  console.log(
    `  ${'Trace ID'.padEnd(34)} ${'Date'.padEnd(12)} ${'Intent'.padEnd(20)} ${'Conf'.padEnd(6)} ${'Lane'}`,
  );
  console.log('  ' + '─'.repeat(80));

  for (const t of traces) {
    const intent = (t.intent ?? 'unknown').slice(0, 18);
    const score = t.confidence_score != null ? String(t.confidence_score) : '—';
    const lane = t.lane ?? '—';
    console.log(
      `  ${t.trace_id.padEnd(34)} ${t.date.padEnd(12)} ${intent.padEnd(20)} ${score.padEnd(6)} ${lane}`,
    );
  }
  console.log('');
}
