#!/usr/bin/env node
// ai-delivery-os dev CLI
// Usage: dev <command> [args]
// Commands: plan | query | status | replay

import { planCommand }   from './commands/plan.js';
import { queryCommand }  from './commands/query.js';
import { statusCommand } from './commands/status.js';
import { replayCommand } from './commands/replay.js';
import { indexCommand }  from './commands/index.js';
import { traceCommand }  from './commands/trace.js';

const [, , command = '', ...rest] = process.argv;

const USAGE = `
ai-delivery-os dev CLI

Usage:
  dev index   [options]   Run the indexer
  dev plan    [options]   Generate / update a delivery plan
  dev query   [options]   Query the knowledge index
  dev status  [options]   Show index status
  dev replay  [options]   Replay a past analysis run
  dev trace   [options]   Capture or view traces
`.trimStart();

switch (command) {
  case 'index':
    indexCommand(rest);
    break;
  case 'plan':
    planCommand(rest).catch(console.error);
    break;
  case 'query':
    queryCommand(rest).catch(console.error);
    break;
  case 'status':
    statusCommand(rest);
    break;
  case 'replay':
    replayCommand(rest);
    break;
  case 'trace':
    traceCommand(rest);
    break;
  default:
    console.log(USAGE);
    if (command && command !== '--help' && command !== '-h') {
      console.error(`Unknown command: "${command}"`);
      process.exit(1);
    }
    break;
}
