#!/usr/bin/env node
// Nirnex CLI — Decision Intelligence for software delivery
// Usage: nirnex <command> [args]

import { createRequire } from 'node:module';
import { planCommand }    from './commands/plan.js';
import { queryCommand }   from './commands/query.js';
import { statusCommand }  from './commands/status.js';
import { replayCommand }  from './commands/replay.js';
import { indexCommand }   from './commands/index.js';
import { traceCommand }   from './commands/trace.js';
import { setupCommand }   from './commands/setup.js';
import { removeCommand }  from './commands/remove.js';
import { updateCommand }  from './commands/update.js';
import { runtimeCommand } from './commands/runtime.js';
import { reportCommand }  from './commands/report.js';
import { hookLogCommand } from './commands/hook-log.js';
import { doctorCommand }  from './commands/doctor.js';

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
  nirnex doctor   [options]   Validate hook runtime contract and Claude hook scripts
  nirnex trace    [options]   View execution traces
  nirnex report   [options]   Generate a static HTML report from a run
  nirnex replay   [options]   Replay a past analysis run
  nirnex hook-log [options]   Inspect hook lifecycle events and contract violations
  nirnex runtime  <sub>       Claude hook pipeline commands (machine-facing)
  nirnex version              Print the installed version
  nirnex update               Update to the latest version

Run \`nirnex setup\` to get started.
`.trimStart();

switch (command) {
  case 'version':
  case '--version':
  case '-v': {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    console.log(pkg.version);
    break;
  }
  case 'update':
    updateCommand(rest).catch(console.error);
    break;
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
  case 'doctor':
    doctorCommand(rest);
    break;
  case 'report':
    reportCommand(rest);
    break;
  case 'replay':
    replayCommand(rest);
    break;
  case 'trace':
    traceCommand(rest);
    break;
  case 'hook-log':
    hookLogCommand(rest);
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
