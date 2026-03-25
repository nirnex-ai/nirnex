// Command: nirnex runtime <subcommand>
// Machine-facing runtime pipeline commands called by Claude hook scripts.
//
// Subcommands:
//   bootstrap  — SessionStart: hydrate env, create session state
//   entry      — UserPromptSubmit: build ECO, create envelope, inject context
//   guard      — PreToolUse: evaluate tool against lane policy
//   trace      — PostToolUse: append trace event, detect deviation
//   validate   — Stop: validate ACs, block or allow completion

const RUNTIME_USAGE = `
nirnex runtime <subcommand>

Subcommands (called by Claude hook scripts):
  bootstrap   SessionStart handler — hydrates session state and env vars
  entry       UserPromptSubmit handler — builds ECO and creates task envelope
  guard       PreToolUse handler — evaluates tool against lane policy
  trace       PostToolUse handler — appends trace event and detects deviation
  validate    Stop handler — validates acceptance criteria and completion

These commands read JSON from stdin and write JSON to stdout.
They are not intended for direct user invocation.
`.trimStart();

export async function runtimeCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'bootstrap': {
      const { runBootstrap } = await import('../runtime/bootstrap.js');
      await runBootstrap();
      break;
    }
    case 'entry': {
      const { runEntry } = await import('../runtime/entry.js');
      await runEntry();
      break;
    }
    case 'guard': {
      const { runGuard } = await import('../runtime/guard.js');
      await runGuard();
      break;
    }
    case 'trace': {
      const { runTraceHook } = await import('../runtime/trace-hook.js');
      await runTraceHook();
      break;
    }
    case 'validate': {
      const { runValidate } = await import('../runtime/validate.js');
      await runValidate();
      break;
    }
    default:
      console.log(RUNTIME_USAGE);
      if (sub && sub !== '--help' && sub !== '-h') {
        console.error(`Unknown runtime subcommand: "${sub}"`);
        process.exit(1);
      }
      break;
  }
}
