import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FINDINGS = 5000;
const MAX_FINDINGS_PER_FILE = 200;
const CONCURRENCY = 16;

const HARD_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-portable', 'env', 'logs', 'coverage',
  'build', 'out', 'target', 'vendor', '.next', '.nuxt', '.turbo',
]);
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.tgz', '.bz2', '.7z', '.rar', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.jar', '.war',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.ogg', '.woff',
  '.woff2', '.ttf', '.eot', '.otf', '.sqlite', '.db', '.wasm', '.node',
]);
// 无引号的「键=值」只在配置类文件里检测，避免把代码里的 `token = getToken()` 误报
const CONFIG_EXTS = new Set([
  '', '.env', '.ini', '.cfg', '.conf', '.config', '.properties',
  '.yaml', '.yml', '.toml', '.json', '.jsonc', '.sh', '.ps1', '.bat', '.cmd',
]);

const ASSIGN_KEYS = 'password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret';

// 规则：id 用于界面词条，severity 只分 high/medium；re 必须带 g。
const RULES = [
  { id: 'private-key', severity: 'high', re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g },
  { id: 'credential-url', severity: 'high', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi, ignore: (m) => /[<>{}$]/.test(m[0]) },
  { id: 'aws-access-key', severity: 'high', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', severity: 'high', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { id: 'gitlab-token', severity: 'high', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', severity: 'high', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'google-api-key', severity: 'high', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'openai-key', severity: 'high', re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { id: 'bearer-token', severity: 'medium', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { id: 'jwt', severity: 'medium', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    id: 'secret-assignment',
    severity: 'medium',
    re: new RegExp(`\\b(?:${ASSIGN_KEYS})\\b\\s*[:=]\\s*['"\`]([^'"\`\\s]{6,})['"\`]`, 'gi'),
    ignore: (m) => isPlaceholder(m[1]),
  },
  {
    id: 'secret-assignment',
    severity: 'medium',
    exts: CONFIG_EXTS,
    re: new RegExp(`\\b(?:${ASSIGN_KEYS})\\b\\s*[:=]\\s*([^\\s'"\`#(){}[\\]]{6,})`, 'gi'),
    ignore: (m) => isPlaceholder(m[1]),
  },
];

const PLACEHOLDER_RE = /^(?:<.*>|\$\{.*\}|\$[A-Z_]+|\{\{.*\}\}|x{3,}|\*{3,}|\.{3,}|-{3,}|password|passwd|token|secret|change[_-]?me|your[_-].*|example|sample|test|null|undefined|true|false|none)$/i;

function isPlaceholder(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (PLACEHOLDER_RE.test(v)) return true;
  if (/^(?:process\.env|import\.meta\.env)/.test(v)) return true;
  if (/^[a-z0-9_]+$/.test(v) && new Set(v).size <= 2) return true;
  return false;
}

function mask(value) {
  const s = String(value || '').trim();
  if (s.length <= 8) return `${s.slice(0, 1)}***${s.slice(-1)}`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

// 递归列出候选文件，跳过隐藏目录、硬跳过目录、用户排除目录与明显二进制后缀
function listFiles(root, excludeDirs) {
  const skip = new Set(excludeDirs);
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        const lower = e.name.toLowerCase();
        if (e.name.startsWith('.') || HARD_SKIP_DIRS.has(lower) || skip.has(lower)) continue;
        stack.push(childRel);
      } else if (e.isFile()) {
        if (BINARY_EXTS.has(extOf(e.name))) continue;
        out.push(childRel);
      }
    }
  }
  return out;
}

async function scanFile(root, rel) {
  const full = path.join(root, rel);
  let st;
  try { st = await fsp.stat(full); } catch { return null; }
  if (st.size > MAX_FILE_BYTES || st.size === 0) return null;
  let buf;
  try { buf = await fsp.readFile(full); } catch { return null; }
  if (buf.includes(0)) return null;
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  const ext = extOf(rel);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    for (const rule of RULES) {
      if (rule.exts && !rule.exts.has(ext)) continue;
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.ignore && rule.ignore(m)) continue;
        findings.push({
          rel,
          line: i + 1,
          rule: rule.id,
          severity: rule.severity,
          match: mask(m[0]),
        });
        if (findings.length >= MAX_FINDINGS_PER_FILE) return { rel, findings, truncated: true };
      }
    }
  }
  return { rel, findings };
}

export async function scanSecrets({ dir, excludeDirs } = {}) {
  if (typeof dir !== 'string' || !dir.trim()) throw err('bad-dir', 'dir required');
  const root = dir.trim();
  let st;
  try { st = await fsp.stat(root); } catch { throw err('not-found', 'path not found'); }
  if (!st.isDirectory()) throw err('not-found', 'not a directory');

  const dirs = Array.isArray(excludeDirs)
    ? excludeDirs.map((d) => String(d).trim().replace(/^\/+|\/+$/g, '').toLowerCase()).filter(Boolean)
    : [];
  const all = listFiles(root, dirs).sort();

  const findings = [];
  let scanned = 0;
  let truncated = false;
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const chunk = all.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((rel) => scanFile(root, rel)));
    for (const r of results) {
      if (!r) continue;
      scanned += 1;
      if (r.truncated) truncated = true;
      for (const f of r.findings) {
        if (findings.length >= MAX_FINDINGS) { truncated = true; break; }
        findings.push(f);
      }
      if (findings.length >= MAX_FINDINGS) break;
    }
    if (findings.length >= MAX_FINDINGS) break;
  }

  const ruleMap = new Map();
  for (const f of findings) {
    const cur = ruleMap.get(f.rule) || { rule: f.rule, severity: f.severity, count: 0 };
    cur.count += 1;
    ruleMap.set(f.rule, cur);
  }
  const byRule = [...ruleMap.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
  const byFile = new Map();
  for (const f of findings) byFile.set(f.rel, (byFile.get(f.rel) || 0) + 1);

  return {
    dir: root,
    scanned,
    findings,
    byRule,
    totals: { files: byFile.size, findings: findings.length, scanned },
    ...(truncated ? { truncated: true } : {}),
  };
}
