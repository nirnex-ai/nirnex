import Parser from 'tree-sitter';
import tsLanguage from 'tree-sitter-typescript';
import fs from 'node:fs';
import path from 'node:path';

const parser = new Parser();

export interface ParsedModule {
  path: string;
  name: string;
  language: string;
  loc: number;
  exports: Array<{ name: string; isDefault: boolean }>;
  imports: Array<{ source: string; specifiers: string[] }>;
  declarations: Array<{ name: string; kind: 'function' | 'class'; startLine: number; endLine: number }>;
}

export function parseFile(filePath: string): ParsedModule | null {
  try {
    const ext = path.extname(filePath);
    if (!['.ts', '.tsx'].includes(ext)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    
    const tsLang = tsLanguage as unknown as { typescript: any, tsx: any };
    if (ext === '.tsx') {
      parser.setLanguage(tsLang.tsx);
    } else {
      parser.setLanguage(tsLang.typescript);
    }
    
    const tree = parser.parse(content);
    
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
                    if (nc.type === 'import_specifier') {
                      specifiers.push(nc.text);
                    }
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
          if (child.type === 'class_declaration' || child.type === 'function_declaration' || child.type === 'lexical_declaration') {
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
               endLine: node.endPosition.row + 1
            });
         }
      }
      
      for (const child of node.children) traverse(child);
    };
    
    traverse(tree.rootNode);
    
    return {
      path: filePath,
      name: path.basename(filePath),
      language: ext === '.tsx' ? 'tsx' : 'typescript',
      loc: content.split('\n').length,
      imports,
      exports,
      declarations
    };
  } catch (error) {
    const ext = path.extname(filePath);
    let sizeBytes = 0;
    try { sizeBytes = fs.statSync(filePath).size; } catch {}
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `[nirnex parser] Failed to parse ${filePath}\n` +
      `  extension: ${ext}  size: ${sizeBytes} bytes\n` +
      `  reason: ${msg}`
    );
    return null;
  }
}
