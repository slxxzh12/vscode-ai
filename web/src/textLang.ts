import { looksLikeJson } from './formatText';

export type TextLang = 'json' | 'js' | 'ts' | 'css' | 'html' | 'sql' | 'yaml' | 'python' | 'java' | 'cpp' | 'shell' | 'ps1' | 'markdown' | '';

export function detectTextLang(text: string): TextLang {
  const s = String(text || '').trim();
  if (!s) return '';
  if (looksLikeJson(s)) return 'json';
  const first = s.split(/\r?\n/, 1)[0] || '';
  const sh = /^#!\s*(.+)$/.exec(first);
  if (sh) {
    const c = sh[1].toLowerCase();
    if (/\b(node|deno|bun)\b/.test(c)) return 'js';
    if (/\bpython[0-9.]*\b/.test(c)) return 'python';
    if (/\b(pwsh|powershell)\b/.test(c)) return 'ps1';
    if (/\b(bash|sh|zsh|ksh)\b/.test(c)) return 'shell';
  }
  if (/<!doctype\s+html|<html[\s>]|<\/[a-z][\w-]*>/i.test(s)) return 'html';
  if (/\b(select\s+[\s\S]+?\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(table|database|view))\b/i.test(s)) return 'sql';
  if (/#include\s*[<"]|std::|using\s+namespace\b|int\s+main\s*\(/m.test(s)) return 'cpp';
  if (/^\s*(public\s+)?(class|interface|enum)\s+\w+/m.test(s) && /\b(public|private|protected|static|void|String|System\.out)\b/.test(s)) return 'java';
  if (/^\s*def\s+\w+\s*\(/m.test(s) || (/^\s*class\s+\w+.*:\s*$/m.test(s) && /^\s+def\s+/m.test(s))) return 'python';
  if (/(^|\n)\s*(const|let|var|function|class|import|export)\b/m.test(s)
    || /=>\s*[{(]|console\.(log|error|warn)|require\s*\(|module\.exports/.test(s)) return 'js';
  if (/^\s*[\w.-]+\s*:\s+.+$/m.test(s) && !/[{};]/.test(s)) return 'yaml';
  if (/^\s*(echo|export|cd|ls|grep|sed|awk|curl)\b/m.test(s)) return 'shell';
  if (/^\s*\$[\w:]+\s*=|Write-Host|\b(Get|Set|New|Remove)-\w+/m.test(s)) return 'ps1';
  if (/[.#]?[a-z][\w-]*\s*\{[^}]*[\w-]+\s*:\s*[^;]+;/i.test(s)) return 'css';
  if (/^\s*#{1,6}\s+\S/m.test(s)) return 'markdown';
  return '';
}

export function extForLang(lang: TextLang): string {
  switch (lang) {
    case 'js': return 'js';
    case 'ts': return 'ts';
    case 'json': return 'json';
    case 'css': return 'css';
    case 'html': return 'html';
    case 'sql': return 'sql';
    case 'yaml': return 'yaml';
    case 'python': return 'py';
    case 'java': return 'java';
    case 'cpp': return 'cpp';
    case 'shell': return 'sh';
    case 'ps1': return 'ps1';
    case 'markdown': return 'md';
    default: return '';
  }
}
