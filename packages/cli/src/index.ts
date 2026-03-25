#!/usr/bin/env node
// Nirnex CLI — Decision Intelligence for software delivery
// Usage: nirnex <command> [args]

import { planCommand }    from './commands/plan.js';
import { queryCommand }   from './commands/query.js';
import { statusCommand }  from './commands/status.js';
import { replayCommand }  from './commands/replay.js';
import { indexCommand }   from './commands/index.js';
import { traceCommand }   from './commands/trace.js';
import { setupCommand }   from './commands/setup.js';
import { removeCommand }  from './commands/remove.js';
import { runtimeCommand } from './commands/runtime.js';

const [, , command = '', ...rest] = process.argv;

const USAGE = `
Nirnex — Decision Intelligence for software delivery

Usage:
  nirnex setup    [options]   Initialize Nirnex in this repository
  nirnex remove   [options]   Safely detach Nirnex from this repository
  nirnex index    [options]   Index the codebase into the knowledge graph
  nirnex plan     [options]   Generate a delivery plan from a spec or query
  nirnex query    [options]   Query the knowledge graph
  nirnex status   [options]   Show index and project health
  nirnex trace    [options]   View execution traces
  nirnex replay   [options]   Replay a past analysis run
  nirnex runtime  <sub>       Claude hook pipeline commands (machine-facing)

Run \`nirnex setup\` to get started.
`.trimStart();

switch (command) {
  case 'setup':
    setupCommand(rest).catch(console.error);
    break;
  case 'remove':
    removeCommand(rest).catch(console.error);
    break;
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
  case 'runtime':
    runtimeCommand(rest).catch(console.error);
    break;
  default:
    console.log(USAGE);
    if (command && command !== '--help' && command !== '-h') {
      console.error(`Unknown command: "${command}"`);
      process.exit(1);
    }
    break;
}
