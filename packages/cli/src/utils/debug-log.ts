/**
 * Structured JSONL debug logger for nirnex parser failures.
 *
 * Writes to .ai-index/nirnex-debug.log (append-only, rotated at 10 MB).
 * Never throws — debug logging must never interrupt indexing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ParseFileDiagnostics } from '@nirnex/parser/dist/index.js';

const _require = createRequire(import.meta.url);

const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Version helpers ─────────────────────────────────────────────────────────

function pkgVersion(name: string): string | undefined {
  try {
    return (_require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return undefined;
  }
}

// ─── Failure classifier ──────────────────────────────────────────────────────

interface Classification {
  suspected_cause: string;
  recommended_actions: string[];
}

function classify(diag: ParseFileDiagnostics): Classification {
  // Grammar set failed — ABI / binding problem
  if (diag.stage === 'set_language') {
    return {
      suspected_cause: 'grammar_binding_problem',
      recommended_actions: [
        'The tree-sitter language could not be set — likely a native ABI or version mismatch',
        'Run: npm ls tree-sitter tree-sitter-typescript',
        'Reinstall: npm install -g @nirnex/cli',
        'Check Node.js version compatibility with the tree-sitter native module',
      ],
    };
  }

  // TSX file got TypeScript grammar — should never happen, but detectable
  if (diag.extension === '.tsx' && diag.selected_language === 'typescript') {
    return {
      suspected_cause: 'wrong_grammar_selected',
      recommended_actions: [
        'A .tsx file was routed to the TypeScript grammar instead of the TSX grammar',
        'This is a Nirnex parser bug — please file a report',
        'Workaround: rename the file to .ts temporarily if it contains no JSX',
      ],
    };
  }

  // Null bytes — binary or incorrectly encoded file
  if (diag.has_null_bytes) {
    return {
      suspected_cause: 'invalid_file_encoding',
      recommended_actions: [
        'File contains null (0x00) bytes — it may be binary output, compiled JS, or mis-encoded',
        'Re-save the file as UTF-8 without BOM using your editor',
        'Check whether this file should be excluded via .gitignore or nirnex config',
      ],
    };
  }

  // Non-string passed to parse() — Nirnex bug
  if (diag.input_type !== undefined && diag.input_type !== 'string') {
    return {
      suspected_cause: 'invalid_parse_input_type',
      recommended_actions: [
        `Parser received type "${diag.input_type}" instead of a string — this is a Nirnex bug`,
        'Please file a bug report with this log entry attached',
      ],
    };
  }

  // File could not be read or decoded
  if (diag.stage === 'read_file' || diag.stage === 'decode_file') {
    return {
      suspected_cause: 'file_access_or_encoding_error',
      recommended_actions: [
        `Check file permissions: ls -la "${diag.file}"`,
        'Ensure the file is valid UTF-8 (not UTF-16, Latin-1, or binary)',
        'Check whether the file is a dangling symlink',
      ],
    };
  }

  // Parse stage failure for .tsx — grammar or syntax issue
  if (diag.stage === 'parse' && diag.extension === '.tsx') {
    return {
      suspected_cause: 'unsupported_syntax_or_parser_binding_issue',
      recommended_actions: [
        'The TSX grammar (tree-sitter-typescript) could not parse this file',
        'Possible causes: very new JSX/TS syntax, very large file, or ABI mismatch in native bindings',
        'Run: npm ls tree-sitter tree-sitter-typescript — look for version mismatches',
        'Try reproducing with a minimal .tsx snippet to isolate the syntax involved',
        'If other .tsx files parse successfully, the issue is specific to this file\'s syntax',
        'File a bug report with this log entry if the problem persists',
      ],
    };
  }

  // Parse stage failure for .ts
  if (diag.stage === 'parse' && diag.extension === '.ts') {
    return {
      suspected_cause: 'unsupported_syntax_or_parser_binding_issue',
      recommended_actions: [
        'The TypeScript grammar (tree-sitter-typescript) could not parse this file',
        'Run: npm ls tree-sitter tree-sitter-typescript — look for version mismatches',
        'Try reproducing with a minimal .ts snippet',
        'File a bug report with this log entry if the problem persists',
      ],
    };
  }

  // AST traversal bug — Nirnex bug, not user file
  if (diag.stage === 'postprocess_ast') {
    return {
      suspected_cause: 'nirnex_ast_traversal_bug',
      recommended_actions: [
        'Parsing succeeded but Nirnex failed while reading the syntax tree — this is a Nirnex bug',
        'Please file a bug report with this log entry',
        'Workaround: the file will be skipped from the index until the bug is fixed',
      ],
    };
  }

  return {
    suspected_cause: 'unknown',
    recommended_actions: [
      'Review the stack trace in this log entry for clues',
      'Run: nirnex index --rebuild to retry',
      'File a bug report with this log entry attached',
    ],
  };
}

// ─── Log entry schema ────────────────────────────────────────────────────────

export interface DebugLogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  event: 'parser_failure';
  command: string;
  // Environment
  node_version: string;
  platform: string;
  nirnex_cli_version?: string;
  nirnex_parser_version?: string;
  tree_sitter_version?: string;
  grammar_package: string;
  grammar_variant?: string;
  // File metadata
  file: string;
  extension: string;
  size_bytes: number;
  content_sha256?: string;
  char_length?: number;
  has_bom?: boolean;
  has_null_bytes?: boolean;
  newline_style?: string;
  // Parser context
  selected_language?: string;
  language_set?: boolean;
  input_type?: string;
  // Failure details
  stage: string;
  error_name: string;
  error_message: string;
  stack?: string;
  // Actionable guidance
  suspected_cause: string;
  recommended_actions: string[];
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Appends a structured JSONL record to `.ai-index/nirnex-debug.log`.
 * Returns the absolute path to the log file.
 * Never throws.
 */
export function appendDebugLog(
  cwd: string,
  diag: ParseFileDiagnostics,
  command: string
): string {
  const logDir = path.join(cwd, '.ai-index');
  const logPath = path.join(logDir, 'nirnex-debug.log');

  try {
    fs.mkdirSync(logDir, { recursive: true });

    // Rotate if log exceeds size limit
    try {
      const stat = fs.statSync(logPath);
      if (stat.size > MAX_LOG_BYTES) {
        const rotated = `${logPath}.${Date.now()}.old`;
        fs.renameSync(logPath, rotated);
      }
    } catch {
      // Log may not exist yet — that's fine
    }

    const { suspected_cause, recommended_actions } = classify(diag);

    const entry: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'parser_failure',
      command,
      node_version: process.version,
      platform: `${process.platform}-${process.arch}`,
      nirnex_cli_version: pkgVersion('@nirnex/cli'),
      nirnex_parser_version: pkgVersion('@nirnex/parser'),
      tree_sitter_version: pkgVersion('tree-sitter'),
      grammar_package: 'tree-sitter-typescript',
      grammar_variant: diag.grammar_variant,
      file: diag.file,
      extension: diag.extension,
      size_bytes: diag.size_bytes,
      content_sha256: diag.content_sha256,
      char_length: diag.char_length,
      has_bom: diag.has_bom,
      has_null_bytes: diag.has_null_bytes,
      newline_style: diag.newline_style,
      selected_language: diag.selected_language,
      language_set: diag.language_set,
      input_type: diag.input_type,
      stage: diag.stage,
      error_name: diag.error_name,
      error_message: diag.error_message,
      stack: diag.stack,
      suspected_cause,
      recommended_actions,
    };

    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Never propagate — debug logging must not break indexing
  }

  return logPath;
}
