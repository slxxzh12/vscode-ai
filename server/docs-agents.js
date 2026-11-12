import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = path.join(__dirname, '..', 'config', 'doc-agents', 'AGENTS.md');

export const DOCS_AGENTS_MARKER = '<!-- devflow:docs-agents -->';

// 方案规范正文放在 config/doc-agents/AGENTS.md（随绿色包发布），避免把中文内容写进服务端代码。
export function buildDocsAgentsSection({ templateFile = DEFAULT_TEMPLATE } = {}) {
  return fs.readFileSync(templateFile, 'utf8');
}

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// 从任意目录推断文档仓根目录：命中 <root>/docs/... 时取 docs 的上一级；否则原样返回。
export function docsRepoRootOf(input) {
  const list = typeof input === 'string' ? [input] : Object.values(input || {});
  for (const v of list) {
    const s = String(v || '').trim();
    if (!s) continue;
    const m = s.match(/^(.*?)[\\/]docs(?:[\\/]|$)/i);
    if (m && m[1]) return m[1];
  }
  return typeof input === 'string' ? String(input || '').trim() : '';
}

// 在文档仓根目录写入/追加方案规范。已存在同名段落时跳过；已有 AGENTS.md 时只追加，不覆盖。
export function ensureDocsAgents(docsRoot) {
  const root = String(docsRoot || '').trim();
  if (!root) return { ok: false, error: 'no-root' };
  const file = path.join(root, 'AGENTS.md');
  const section = buildDocsAgentsSection();
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(file, `# AGENTS.md\n\n${section}\n`, 'utf8');
      return { ok: true, path: file, action: 'created' };
    }
    const cur = fs.readFileSync(file, 'utf8');
    if (cur.includes(DOCS_AGENTS_MARKER)) return { ok: true, path: file, action: 'exists' };
    const sep = cur.endsWith('\n') ? '\n' : '\n\n';
    fs.appendFileSync(file, `${sep}${section}\n`, 'utf8');
    return { ok: true, path: file, action: 'appended' };
  } catch (e) {
    return { ok: false, path: file, error: (e && e.code) || 'write-failed', message: (e && e.message) || String(e) };
  }
}

export { inside };
