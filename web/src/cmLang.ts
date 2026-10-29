import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { sass } from '@codemirror/lang-sass';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import type { Extension } from '@codemirror/state';
import { looksLikeJson } from './formatText';

const L = (m: any) => StreamLanguage.define(m);

// 按文件名/扩展名选 CodeMirror 语言；未知扩展名但内容是合法 JSON 时也按 JSON 高亮
export function cmLangFor(name: string, content = ''): Extension | null {
  const base = (name || '').replace(/\\/g, '/').split('/').pop() || '';
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : lower;
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsx': return javascript();
    case 'ts': case 'tsx': case 'mts': return javascript({ typescript: true });
    case 'json': return json();
    case 'css': return css();
    case 'html': case 'htm': case 'xml': case 'svg': case 'vue': return html();
    case 'md': case 'markdown': return markdown();
    case 'py': return python();
    case 'java': return java();
    case 'c': case 'h': case 'cc': case 'cpp': case 'cxx': case 'hpp': case 'hh': case 'cs': return cpp();
    case 'php': return php();
    case 'sql': return sql();
    case 'sass': case 'scss': return sass();
    case 'go': return L(go);
    case 'rs': return L(rust);
    case 'sh': case 'bash': case 'zsh': case 'ksh': return L(shell);
    case 'ps1': return L(powerShell);
    case 'yml': case 'yaml': return L(yaml);
    case 'toml': return L(toml);
    case 'dockerfile': return L(dockerFile);
    case 'lua': return L(lua);
    case 'swift': return L(swift);
    case 'rb': case 'ruby': return L(ruby);
    case 'pl': case 'pm': return L(perl);
    default: return looksLikeJson(content) ? json() : null;
  }
}
