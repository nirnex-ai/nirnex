import Parser from 'tree-sitter';
import tsLanguage from 'tree-sitter-typescript';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const parser = new Parser();

// ─── Public types ────────────────────────────────────────────────────────────

export interface ParsedModule {
  path: string;
  name: string;
  language: string;
  loc: number;
  exports: Array<{ name: string; isDefault: boolean }>;
  imports: Array<{ source: string; specifiers: string[] }>;
  declarations: Array<{ name: string; kind: 'function' | 'class'; startLine: number; endLine: number }>;
}

export type ParseStage =
  | 'read_file'
  | 'decode_file'
  | 'select_language'
  | 'set_language'
  | 'parse'
  | 'postprocess_ast';

export interface ParseFileDiagnostics {
  file: string;
  extension: string;
  size_bytes: number;
  content_sha256?: string;
  char_length?: number;
  has_bom?: boolean;
  has_null_bytes?: boolean;
  newline_style?: 'LF' | 'CRLF' | 'mixed' | 'unknown';
  selected_language?: string;
  grammar_variant?: string;
  language_set?: boolean;
  input_type?: string;
  stage: ParseStage;
  error_name: string;
  error_message: string;
  stack?: string;
}

export type ParseFileResult =
  | { ok: true; module: ParsedModule }
  | { ok: false; diagnostics: ParseFileDiagnostics };

// ─── AST traversal (shared) ──────────────────────────────────────────────────

function traverseAST(
  tree: Parser.Tree
): {
  imports: ParsedModule['imports'];
  exports: ParsedModule['exports'];
  declarations: ParsedModule['declarations'];
} {
  const imports: ParsedModule['imports'] = [];
  const exports: ParsedModule['exports'] = [];
  const declarations: ParsedModule['declarations'] = [];

  const traverse = (node: Parser.SyntaxNode) => {
    if (node.type === 'import_statement') {
      let source = '';
      const specifiers: string[] = [];
      for (const child of node.children) {
        if (child.type === 'string') {
          source = child.text.slice(1, -1);
        } else if (child.type === 'import_clause') {
          for (const c of child.children) {
            if (c.type === 'identifier') {
              specifiers.push(c.text);
            } else if (c.type === 'named_imports') {
              for (const nc of c.children) {
                if (nc.type === 'import_specifier') specifiers.push(nc.text);
              }
            }
          }
        }
      }
      if (source) imports.push({ source, specifiers });
    }

    if (node.type === 'export_statement') {
      let isDefault = false;
      for (const child of node.children) {
        if (child.type === 'default') isDefault = true;
        if (child.type === 'export_clause') {
          for (const c of child.children) {
            if (c.type === 'export_specifier') exports.push({ name: c.text, isDefault: false });
          }
        }
        if (
          child.type === 'class_declaration' ||
          child.type === 'function_declaration' ||
          child.type === 'lexical_declaration'
        ) {
          const nameNode = child.children.find(c => c.type === 'identifier');
          if (nameNode) {
            exports.push({ name: nameNode.text, isDefault });
          } else if (child.type === 'lexical_declaration') {
            const declC = child.children.find(c => c.type === 'variable_declarator');
            if (declC) {
              const idNode = declC.children.find(c => c.type === 'identifier');
              if (idNode) exports.push({ name: idNode.text, isDefault });
            }
          }
        }
      }
    }

    if (node.type === 'function_declaration' || node.type === 'class_declaration') {
      const nameNode = node.children.find(c => c.type === 'identifier');
      if (nameNode) {
        declarations.push({
          name: nameNode.text,
          kind: node.type.split('_')[0] as 'function' | 'class',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    }

    for (const child of node.children) traverse(child);
  };

  traverse(tree.rootNode);
  return { imports, exports, declarations };
}

// ─── Stage-aware parse with full diagnostics ────────────────────────────────

export function parseFileWithDiagnostics(filePath: string): ParseFileResult {
  let stage: ParseStage = 'read_file';
  let size_bytes = 0;
  let content_sha256: string | undefined;
  let char_length: number | undefined;
  let has_bom: boolean | undefined;
  let has_null_bytes: boolean | undefined;
  let newline_style: 'LF' | 'CRLF' | 'mixed' | 'unknown' | undefined;
  let selected_language: string | undefined;
  let language_set = false;
  let input_type: string | undefined;

  try {
    const ext = path.extname(filePath);
    if (!['.ts', '.tsx'].includes(ext)) {
      return {
        ok: false,
        diagnostics: {
          file: filePath,
          extension: ext,
          size_bytes: 0,
          stage: 'select_language',
          error_name: 'UnsupportedExtension',
          error_message: `File extension "${ext}" is not supported by nirnex parser (expected .ts or .tsx)`,
        },
      };
    }

    // ── Stage: read_file ──────────────────────────────────────────────────
    stage = 'read_file';
    size_bytes = fs.statSync(filePath).size;
    const rawBuffer = fs.readFileSync(filePath);

    // ── Stage: decode_file ────────────────────────────────────────────────
    stage = 'decode_file';
    has_bom = rawBuffer[0] === 0xef && rawBuffer[1] === 0xbb && rawBuffer[2] === 0xbf;
    has_null_bytes = rawBuffer.indexOf(0x00) !== -1;
    content_sha256 = crypto.createHash('sha256').update(rawBuffer).digest('hex').slice(0, 16);

    const content = rawBuffer.toString('utf-8');
    char_length = content.length;
    input_type = typeof content;

    // Newline style detection
    const crlfCount = (content.match(/\r\n/g) ?? []).length;
    const lfCount = (content.match(/(?<!\r)\n/g) ?? []).length;
    if (crlfCount > 0 && lfCount > 0) newline_style = 'mixed';
    else if (crlfCount > 0) newline_style = 'CRLF';
    else if (lfCount > 0) newline_style = 'LF';
    else newline_style = 'unknown';

    // ── Stage: select_language ────────────────────────────────────────────
    stage = 'select_language';
    const tsLang = tsLanguage as unknown as { typescript: any; tsx: any };
    selected_language = ext === '.tsx' ? 'tsx' : 'typescript';

    // ── Stage: set_language ───────────────────────────────────────────────
    stage = 'set_language';
    if (ext === '.tsx') {
      parser.setLanguage(tsLang.tsx);
    } else {
      parser.setLanguage(tsLang.typescript);
    }
    language_set = true;

    // ── Stage: parse ──────────────────────────────────────────────────────
    stage = 'parse';
    const tree = parser.parse(content);

    // ── Stage: postprocess_ast ────────────────────────────────────────────
    stage = 'postprocess_ast';
    const { imports, exports, declarations } = traverseAST(tree);

    return {
      ok: true,
      module: {
        path: filePath,
        name: path.basename(filePath),
        language: selected_language,
        loc: content.split('\n').length,
        imports,
        exports,
        declarations,
      },
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      ok: false,
      diagnostics: {
        file: filePath,
        extension: path.extname(filePath),
        size_bytes,
        content_sha256,
        char_length,
        has_bom,
        has_null_bytes,
        newline_style,
        selected_language,
        grammar_variant: selected_language,
        language_set,
        input_type,
        stage,
        error_name: err.name,
        error_message: err.message,
        stack: err.stack,
      },
    };
  }
}

// ─── Backward-compatible wrapper ─────────────────────────────────────────────

export function parseFile(filePath: string): ParsedModule | null {
  const result = parseFileWithDiagnostics(filePath);
  if (result.ok) return result.module;

  const d = result.diagnostics;
  // Minimal stderr output — CLI layer writes the full debug log
  process.stderr.write(
    `[nirnex parser] Failed to parse ${d.file}\n` +
    `  extension: ${d.extension}  size: ${d.size_bytes} bytes  stage: ${d.stage}\n` +
    `  reason: ${d.error_message}\n`
  );
  return null;
}
