import type { AttachmentItem } from '../types/nova.ts';
import { generateId } from './conversationStore.ts';

export type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'plain';

export interface CodeToken {
  type: TokenType;
  value: string;
}

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'import', 'export', 'from', 'default',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'new', 'class', 'extends',
  'implements', 'interface', 'type', 'enum', 'public', 'private', 'protected',
  'readonly', 'true', 'false', 'null', 'undefined', 'def', 'elif', 'except', 'lambda',
  'with', 'as', 'yield', 'in', 'is', 'not', 'and', 'or', 'None', 'True', 'False',
  'struct', 'fn', 'mut', 'pub', 'use', 'impl', 'match', 'SELECT', 'FROM', 'WHERE',
  'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'ORDER', 'GROUP', 'BY', 'LIMIT',
]);

const TOKEN_REGEX =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\s*\()|\b([A-Za-z_]\w*)\b/g;

export function tokenizeCode(code: string): CodeToken[] {
  if (!code) return [];
  const tokens: CodeToken[] = [];
  let lastIndex = 0;

  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_REGEX.exec(code)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'plain', value: code.slice(lastIndex, match.index) });
    }

    const [full, comment, str, num, fnCall, word] = match;
    if (comment !== undefined) {
      tokens.push({ type: 'comment', value: full });
    } else if (str !== undefined) {
      tokens.push({ type: 'string', value: full });
    } else if (num !== undefined) {
      tokens.push({ type: 'number', value: full });
    } else if (fnCall !== undefined) {
      tokens.push({
        type: KEYWORDS.has(fnCall) ? 'keyword' : 'function',
        value: full,
      });
    } else if (word !== undefined) {
      tokens.push({
        type: KEYWORDS.has(word) ? 'keyword' : 'plain',
        value: full,
      });
    } else {
      tokens.push({ type: 'plain', value: full });
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < code.length) {
    tokens.push({ type: 'plain', value: code.slice(lastIndex) });
  }

  return tokens;
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'toml',
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'cs', 'php', 'html', 'css', 'sql', 'sh', 'env', 'log',
]);

export function classifyFileKind(fileName: string, mimeType: string): 'image' | 'document' | 'text' {
  const lowerMime = mimeType.toLowerCase();
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (lowerMime.startsWith('image/')) {
    return 'image';
  }
  if (
    lowerMime.startsWith('text/') ||
    lowerMime === 'application/json' ||
    lowerMime === 'application/javascript' ||
    lowerMime === 'application/xml' ||
    TEXT_EXTENSIONS.has(ext)
  ) {
    return 'text';
  }
  return 'document';
}

export async function readFileAsAttachment(file: File): Promise<AttachmentItem> {
  const mimeType = file.type || 'application/octet-stream';
  const kind = classifyFileKind(file.name, mimeType);
  const id = generateId('att');

  if (kind === 'text') {
    const textContent = await file.text();
    return {
      id,
      name: file.name,
      mimeType: file.type || 'text/plain',
      sizeBytes: file.size,
      kind: 'text',
      textContent: textContent.slice(0, 120_000),
    };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
    reader.readAsDataURL(file);
  });

  const commaIdx = dataUrl.indexOf(',');
  const base64Data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';

  return {
    id,
    name: file.name,
    mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : mimeType),
    sizeBytes: file.size,
    kind,
    dataUrl,
    base64Data,
  };
}
