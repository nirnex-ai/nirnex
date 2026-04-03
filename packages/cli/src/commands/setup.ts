// Command: nirnex setup
// Fully Nirnex-enables a repository: creates .ai/, nirnex.config.json,
// initializes the index, and optionally installs the git post-commit hook.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

// ─── Default file templates ───────────────────────────────────────────────

const DEFAULT_ANALYST_MD = `# Analyst Persona

## Role
You are the Analyst agent in the Nirnex pipeline. Your job is to
**understand the codebase** and produce structured knowledge for the Implementer.

## Responsibilities
1. Parse the module graph and identify architectural patterns.
2. Detect hot-spots: high complexity, high coupling, circular dependencies.
3. Summarise each module in ≤ 120 tokens.
4. Identify critical paths from \`critical-paths.txt\` and flag changes that touch them.
5. Output gate results for the \`patterns\` and \`gate_results\` tables.

## Output Contract
- \`modules\` rows updated with \`content_hash\` and \`loc\`.
- \`patterns\` rows inserted for any detected smell.
- \`summaries\` rows upserted per module.
- Return a JSON status: \`{ ok: boolean, warnings: string[] }\`.

## Constraints
- Do not modify source files.
- Do not write to \`hub_summaries\` — that is the Implementer's job.
- Budget: ≤ 2 minutes wall-clock per invocation.
`;

const DEFAULT_IMPLEMENTER_MD = `# Implementer Persona

## Role
You are the Implementer agent in the Nirnex pipeline. Your job is to
**plan and execute changes** using the knowledge produced by the Analyst.

## Responsibilities
1. Read \`summaries\` and \`hub_summaries\` to understand the impact radius of a change.
2. Check \`gate_results\` before starting — do not proceed if any critical gate is failing.
3. Produce a delivery plan: ordered list of files to change, with rationale.
4. After changes, trigger re-analysis and confirm gates pass.
5. Write hub summaries for directories you have modified.

## Output Contract
- A markdown delivery plan committed to \`.ai/specs/plan-<date>.md\`.
- \`gate_results\` rows inserted for your run.
- \`hub_summaries\` rows upserted for touched directories.

## Constraints
- Follow the patterns established in \`calibration/\`.
- Prefer minimal diffs; do not refactor outside the task scope.
- Do not write directly to the database — use the \`@nirnex/core\` API.
`;

const DEFAULT_CRITICAL_PATHS = `# Critical Paths
# List architecturally critical files or directories here.
# Changes touching these paths are flagged and escalated to Lane C.
# One path per line. Wildcards supported.
#
# Examples:
#   src/auth/
#   packages/core/src/schema.sql
#   src/state/paymentMachine.ts
`;

const DEFAULT_CALIBRATION_README = `# Calibration

Project-specific calibration files for Nirnex. Add markdown files here
to teach agents about your codebase conventions.

Suggested files:
- \`naming.md\`    — naming conventions for modules, functions, types
- \`patterns.md\`  — architectural patterns used in this project
- \`boundaries.md\` — module ownership and cross-boundary rules
- \`gates.md\`     — gate check thresholds and escalation policies
`;

const POST_COMMIT_HOOK = `#!/bin/sh
nirnex index
`;

// ─── Claude hook launcher templates ──────────────────────────────────────

/**
 * Resolve the absolute path to the `nirnex` binary at setup time so hook
 * scripts never rely on the shell's PATH.
 *
 * Claude Code runs hooks via `/bin/sh` with a stripped PATH (`/usr/bin:/bin`).
 * The `nirnex` binary is typically at `/usr/local/bin/nirnex` — outside that
 * restricted PATH. Without an absolute path every hook silently fails and
 * nothing is ever written to hook-events.jsonl or the ledger.
 *
 * Resolution order:
 *   1. Co-located with the running Node binary (standard `npm -g` layout)
 *   2. `command -v nirnex` via child_process (inherits the user's full PATH)
 *   3. Known well-known absolute locations (Homebrew, Volta)
 *   4. Bare 'nirnex' fallback (works if /usr/local/bin is somehow in PATH)
 */
export function resolveNirnexBin(): string {
  // 1. Standard npm -g install: node and nirnex live in the same directory
  const adjacent = path.join(path.dirname(process.execPath), 'nirnex');
  if (fs.existsSync(adjacent)) return adjacent;

  // 2. Ask the shell — this process inherits the user's PATH at setup time
  try {
    const found = execSync('command -v nirnex', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (found) return found;
  } catch { /* not in PATH — continue */ }

  // 3. Well-known absolute locations (Homebrew ARM, Volta)
  for (const candidate of [
    '/usr/local/bin/nirnex',
    '/opt/homebrew/bin/nirnex',
    `${process.env.HOME ?? ''}/.volta/bin/nirnex`,
  ]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  // 4. Fallback — relies on PATH; may not work inside restricted /bin/sh
  return 'nirnex';
}

/**
 * Resolve the absolute path to the `node` binary at setup time.
 *
 * This is needed because `nirnex` itself starts with `#!/usr/bin/env node`.
 * Even when the hook script uses an absolute path to `nirnex`, the nirnex
 * binary's own shebang calls `/usr/bin/env node` — and that fails in Claude
 * Code's restricted shell where `/usr/local/bin` is not in PATH.
 *
 * Resolution order:
 *   1. `process.execPath` — the node that is running `nirnex setup` right now
 *      (most reliable: always the correct version that can run nirnex)
 *   2. Well-known absolute locations (Homebrew x64, Homebrew ARM, Volta, nvm)
 *   3. Bare 'node' fallback
 */
export function resolveNodeBin(): string {
  // 1. The currently running node process — most reliable at setup time
  if (process.execPath && process.execPath !== 'node' && fs.existsSync(process.execPath)) {
    return process.execPath;
  }

  // 2. Well-known absolute locations
  for (const candidate of [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    `${process.env.HOME ?? ''}/.volta/bin/node`,
  ]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  // 3. Fallback
  return 'node';
}

/**
 * Generate a self-contained hook launcher script.
 *
 * Injects `export PATH=` before the exec so that `/usr/bin/env node` (used
 * in the nirnex binary's shebang) succeeds even in Claude Code's restricted
 * shell environment where PATH is typically just `/usr/bin:/bin`.
 *
 * PATH is constructed as:
 *   <node-binary-dir> : /usr/local/bin : /opt/homebrew/bin : $PATH
 *
 * The node binary's directory comes first (highest priority) to ensure the
 * exact version used at setup time is preferred over any system fallback.
 * Duplicate entries are removed while preserving order.
 *
 * @param subcommand  - runtime subcommand: bootstrap | entry | guard | trace | validate
 * @param nirnexBin   - absolute path to the nirnex binary (from resolveNirnexBin)
 * @param nodeBin     - absolute path to the node binary (from resolveNodeBin).
 *                      Defaults to process.execPath (the running node at setup time).
 */
export function generateHookScript(
  subcommand: string,
  nirnexBin:  string,
  nodeBin?:   string,
): string {
  const resolvedNode = nodeBin ?? process.execPath;

  // Build a deduplicated, ordered list of directories to prepend to PATH.
  // We include the node binary's own directory first (exact version match),
  // then well-known install locations as fallbacks for any environment.
  const dirs: string[] = [];
  if (resolvedNode.startsWith('/')) {
    dirs.push(path.dirname(resolvedNode));
  }
  dirs.push('/usr/local/bin', '/opt/homebrew/bin');

  // Deduplicate while preserving insertion order
  const uniqueDirs = [...new Set(dirs)];
  const pathExport = `export PATH="${uniqueDirs.join(':')}:$PATH"`;

  return `#!/bin/sh\n${pathExport}\nexec ${nirnexBin} runtime ${subcommand}\n`;
}

const CLAUDE_SETTINGS_HOOKS = {
  hooks: {
    SessionStart: [
      {
        hooks: [{ type: 'command', command: '.claude/hooks/nirnex-bootstrap.sh', timeout: 30 }],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [{ type: 'command', command: '.claude/hooks/nirnex-entry.sh', timeout: 30 }],
      },
    ],
    PreToolUse: [
      {
        matcher: 'Bash|Edit|Write|MultiEdit',
        hooks: [{ type: 'command', command: '.claude/hooks/nirnex-guard.sh', timeout: 10 }],
      },
    ],
    PostToolUse: [
      {
        hooks: [{ type: 'command', command: '.claude/hooks/nirnex-trace.sh', timeout: 10 }],
      },
    ],
    Stop: [
      {
        hooks: [{ type: 'command', command: '.claude/hooks/nirnex-validate.sh', timeout: 10 }],
      },
    ],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function tick(msg: string) {
  process.stdout.write(`  \x1b[32m✔\x1b[0m ${msg}\n`);
}

function info(msg: string) {
  process.stdout.write(`  \x1b[90m·\x1b[0m ${msg}\n`);
}

function warn(msg: string) {
  process.stdout.write(`  \x1b[33m!\x1b[0m ${msg}\n`);
}

function mkdirSafe(p: string) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function writeFileSafe(p: string, content: string, label: string) {
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, content, 'utf8');
    tick(label);
  } else {
    info(`${label} (already exists, skipped)`);
  }
}

function detectSourceRoots(cwd: string): string[] {
  const candidates = ['src', 'apps', 'packages', 'lib'];
  return candidates.filter(d => fs.existsSync(path.join(cwd, d)));
}

function detectProjectName(cwd: string): string {
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return pkg.name;
    } catch {}
  }
  return path.basename(cwd);
}

function isNodeProject(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, 'package.json'));
}

function isMonorepo(cwd: string): boolean {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0;
  } catch {}
  return false;
}

// ─── Interactive prompt helper ────────────────────────────────────────────

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await prompt(rl, `  ${question} ${hint}: `);
  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return defaultYes;
  return trimmed === 'y' || trimmed === 'yes';
}

// ─── Hook refresh (--refresh-hooks) ──────────────────────────────────────────

/**
 * Regenerate all five Claude hook scripts in place.
 *
 * Safe to run on any project — re-resolves nirnex and node binary paths at the
 * time of invocation, then overwrites hook scripts with the latest template.
 * Use this after a `nirnex` upgrade or a Node.js version change.
 */
async function refreshHooksOnly(cwd: string): Promise<void> {
  console.log('\n\x1b[1mNirnex — Refresh Claude Hooks\x1b[0m\n');

  const configPath = path.join(cwd, 'nirnex.config.json');
  if (!fs.existsSync(configPath)) {
    process.stderr.write(
      '  \x1b[31m✘\x1b[0m nirnex.config.json not found — run \x1b[1mnirnex setup\x1b[0m first\n\n'
    );
    process.exit(1);
  }

  const claudeDir  = path.join(cwd, '.claude');
  const hooksDir   = path.join(claudeDir, 'hooks');

  if (!fs.existsSync(hooksDir)) {
    process.stderr.write(
      '  \x1b[31m✘\x1b[0m .claude/hooks/ not found — run \x1b[1mnirnex setup\x1b[0m first\n\n'
    );
    process.exit(1);
  }

  const nirnexBin = resolveNirnexBin();
  const nodeBin   = resolveNodeBin();

  info(`nirnex binary : ${nirnexBin}`);
  info(`node binary   : ${nodeBin}`);
  console.log('');

  const hookFiles: [string, string][] = [
    ['nirnex-bootstrap.sh', generateHookScript('bootstrap', nirnexBin, nodeBin)],
    ['nirnex-entry.sh',     generateHookScript('entry',     nirnexBin, nodeBin)],
    ['nirnex-guard.sh',     generateHookScript('guard',     nirnexBin, nodeBin)],
    ['nirnex-trace.sh',     generateHookScript('trace',     nirnexBin, nodeBin)],
    ['nirnex-validate.sh',  generateHookScript('validate',  nirnexBin, nodeBin)],
  ];

  for (const [name, content] of hookFiles) {
    const p = path.join(hooksDir, name);
    fs.writeFileSync(p, content, { mode: 0o755 });
    tick(`Updated .claude/hooks/${name}`);
  }

  console.log('\n\x1b[32m\x1b[1mHooks refreshed.\x1b[0m\n');
  console.log('All five scripts now embed:');
  console.log(`  export PATH="${[
    ...(nodeBin.startsWith('/') ? [path.dirname(nodeBin)] : []),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ].filter((v, i, a) => a.indexOf(v) === i).join(':')}:$PATH"`);
  console.log('');
}

// ─── Main setup logic ─────────────────────────────────────────────────────

async function runSetup(cwd: string, opts: { yes: boolean; refreshHooks: boolean }): Promise<void> {
  // ── --refresh-hooks: regenerate hook scripts only ──────────────────────────
  if (opts.refreshHooks) {
    await refreshHooksOnly(cwd);
    return;
  }

  console.log('\n\x1b[1mNirnex Setup\x1b[0m\n');

  // Detect environment
  const projectName = detectProjectName(cwd);
  const sourceRoots = detectSourceRoots(cwd);
  const isNode = isNodeProject(cwd);
  const mono = isMonorepo(cwd);

  if (isNode) {
    info(`Detected project: \x1b[1m${projectName}\x1b[0m${mono ? ' (monorepo)' : ''}`);
  }
  if (sourceRoots.length > 0) {
    info(`Source roots found: ${sourceRoots.join(', ')}`);
  }
  console.log('');

  // Check if already initialized
  const configPath = path.join(cwd, 'nirnex.config.json');
  if (fs.existsSync(configPath)) {
    console.log('\x1b[33mThis project is already Nirnex-enabled.\x1b[0m');
    console.log('Run \x1b[1mnirnex status\x1b[0m to check the current state.');
    console.log('Run \x1b[1mnirnex setup --refresh-hooks\x1b[0m to regenerate Claude hook scripts.\n');
    return;
  }

  let installHook = true;
  let runIndex = true;

  if (!opts.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      installHook = await askYesNo(rl, 'Install git post-commit hook for automatic index refresh?', true);
      runIndex = await askYesNo(rl, 'Initialize index now?', true);
    } finally {
      rl.close();
    }
    console.log('');
  }

  // Create .ai/ structure
  const aiDir = path.join(cwd, '.ai');
  const promptsDir = path.join(aiDir, 'prompts');
  const specsDir = path.join(aiDir, 'specs');
  const calibrationDir = path.join(aiDir, 'calibration');
  const aiIndexDir = path.join(cwd, '.ai-index');
  const tracesDir = path.join(aiIndexDir, 'traces');

  mkdirSafe(aiDir);
  tick('Created .ai/');

  mkdirSafe(promptsDir);
  tick('Created .ai/prompts/');

  mkdirSafe(specsDir);
  tick('Created .ai/specs/');

  mkdirSafe(calibrationDir);
  writeFileSafe(path.join(calibrationDir, 'README.md'), DEFAULT_CALIBRATION_README, 'Created .ai/calibration/README.md');

  writeFileSafe(path.join(aiDir, 'critical-paths.txt'), DEFAULT_CRITICAL_PATHS, 'Created .ai/critical-paths.txt');
  writeFileSafe(path.join(promptsDir, 'analyst.md'), DEFAULT_ANALYST_MD, 'Created .ai/prompts/analyst.md');
  writeFileSafe(path.join(promptsDir, 'implementer.md'), DEFAULT_IMPLEMENTER_MD, 'Created .ai/prompts/implementer.md');

  mkdirSafe(aiIndexDir);
  mkdirSafe(tracesDir);
  tick('Created .ai-index/');

  // Write nirnex.config.json
  const config = {
    projectName,
    sourceRoots: sourceRoots.length > 0 ? sourceRoots : ['src'],
    specDirectory: '.ai/specs',
    criticalPathsFile: '.ai/critical-paths.txt',
    prompts: {
      analyst: '.ai/prompts/analyst.md',
      implementer: '.ai/prompts/implementer.md',
    },
    index: {
      path: '.ai-index',
      db: '.aidos.db',
      autoRefresh: installHook,
    },
    git: {
      installPostCommitHook: installHook,
    },
    llm: {
      provider: 'anthropic',
    },
    hooks: {
      enabled: true,
      policyMode: 'standard',
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  tick('Created nirnex.config.json');

  // Install git hook
  if (installHook) {
    const hooksDir = path.join(cwd, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'post-commit');
    if (fs.existsSync(hooksDir)) {
      if (!fs.existsSync(hookPath)) {
        fs.writeFileSync(hookPath, POST_COMMIT_HOOK, { mode: 0o755 });
        tick('Installed git post-commit hook');
      } else {
        info('Git post-commit hook already exists, skipped');
      }
    } else {
      warn('Not a git repo — skipping post-commit hook');
    }
  }

  // Install Claude hooks
  {
    const claudeDir = path.join(cwd, '.claude');
    const hooksDir = path.join(claudeDir, 'hooks');
    const settingsPath = path.join(claudeDir, 'settings.json');

    mkdirSafe(claudeDir);
    mkdirSafe(hooksDir);

    // Resolve the absolute nirnex path once — all five scripts use it.
    // Resolve both the nirnex binary and the node binary at setup time so every
    // generated hook script carries an explicit PATH that works in Claude Code's
    // restricted shell (PATH = /usr/bin:/bin only).
    const nirnexBin = resolveNirnexBin();
    const nodeBin   = resolveNodeBin();
    if (nirnexBin !== 'nirnex') {
      info(`Resolved nirnex binary: ${nirnexBin}`);
    } else {
      warn('Could not resolve absolute nirnex path — hooks will rely on shell PATH (may fail in restricted environments)');
    }

    const hookFiles: [string, string][] = [
      ['nirnex-bootstrap.sh', generateHookScript('bootstrap', nirnexBin, nodeBin)],
      ['nirnex-entry.sh',     generateHookScript('entry',     nirnexBin, nodeBin)],
      ['nirnex-guard.sh',     generateHookScript('guard',     nirnexBin, nodeBin)],
      ['nirnex-trace.sh',     generateHookScript('trace',     nirnexBin, nodeBin)],
      ['nirnex-validate.sh',  generateHookScript('validate',  nirnexBin, nodeBin)],
    ];

    for (const [name, content] of hookFiles) {
      const p = path.join(hooksDir, name);
      if (!fs.existsSync(p)) {
        fs.writeFileSync(p, content, { mode: 0o755 });
        tick(`Created .claude/hooks/${name}`);
      } else {
        info(`.claude/hooks/${name} (already exists, skipped)`);
      }
    }

    // Merge hook config into .claude/settings.json
    let existing: Record<string, any> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {}
    }

    // Only write if hooks section is not already present
    if (!existing.hooks) {
      const merged = { ...existing, ...CLAUDE_SETTINGS_HOOKS };
      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      tick('Wrote Claude hook bindings to .claude/settings.json');
    } else {
      info('.claude/settings.json hooks already configured, skipped');
    }
  }

  // Run initial index
  if (runIndex) {
    process.stdout.write(`  \x1b[90m·\x1b[0m Indexing project...\n`);
    try {
      const { indexCommand } = await import('./index.js');
      const result = indexCommand(['--rebuild']);
      if (result.failed === 0) {
        tick(`Indexed ${result.succeeded} TypeScript file(s)`);
      } else {
        warn(
          `Indexed ${result.succeeded}/${result.succeeded + result.failed} TypeScript file(s) ` +
          `— ${result.failed} file(s) failed to parse (degraded coverage)`
        );
        for (const f of result.failedFiles) {
          process.stderr.write(`      \x1b[31m✖\x1b[0m ${path.relative(cwd, f)}\n`);
        }
        process.stderr.write(
          `\n  \x1b[33m⚠\x1b[0m  Run \x1b[1mnirnex index --rebuild\x1b[0m after fixing parse errors\n`
        );
      }
    } catch (e) {
      warn(`Indexing failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Success summary
  console.log('\n\x1b[32m\x1b[1mSetup complete.\x1b[0m\n');
  console.log('Next steps:');
  console.log('  \x1b[1mnirnex status\x1b[0m              — verify project is ready');
  console.log('  \x1b[1mnirnex plan "your task"\x1b[0m     — generate your first plan');
  console.log('  \x1b[1mnirnex plan .ai/specs/foo.md\x1b[0m — plan from a spec file');
  console.log('');
  console.log('Claude hooks installed:');
  console.log('  SessionStart    → .claude/hooks/nirnex-bootstrap.sh');
  console.log('  UserPromptSubmit → .claude/hooks/nirnex-entry.sh');
  console.log('  PreToolUse      → .claude/hooks/nirnex-guard.sh');
  console.log('  PostToolUse     → .claude/hooks/nirnex-trace.sh');
  console.log('  Stop            → .claude/hooks/nirnex-validate.sh');
  console.log('');
}

// ─── Exported command ─────────────────────────────────────────────────────

export { runSetup };

export async function setupCommand(args: string[]): Promise<void> {
  const yes          = args.includes('--yes') || args.includes('-y');
  const refreshHooks = args.includes('--refresh-hooks');
  const cwd          = process.cwd();

  await runSetup(cwd, { yes, refreshHooks });
}
