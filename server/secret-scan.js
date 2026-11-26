import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

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

// 常见敏感配置关键字：键名以这些词结尾即视为敏感配置（支持 DB_PASSWORD / AWS_SECRET_ACCESS_KEY 等前缀写法）
const SENSITIVE_KEY_SUFFIX = [
  'password', 'passwd', 'pwd', 'passphrase',
  'secret', 'token',
  'api[_-]?key', 'apikey', 'access[_-]?key', 'secret[_-]?key', 'private[_-]?key',
  'signing[_-]?key', 'encryption[_-]?key', 'master[_-]?key', 'license[_-]?key', 'auth[_-]?key',
  'credentials?', 'connection[_-]?string', 'conn[_-]?str',
  'database[_-]?url', 'db[_-]?url', 'dsn',
  '(?:mongodb?|mysql|postgres(?:ql)?|redis|amqp|rabbitmq|kafka)[_-]?(?:url|uri|dsn)',
].join('|');
const SENSITIVE_KEY_RE = new RegExp(`(?:^|[_-])(?:${SENSITIVE_KEY_SUFFIX})$`, 'i');

// 键名归一化：camelCase → snake_case，点/空白 → 下划线，便于按「后缀」判断
function normalizeKey(key) {
  return String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[.\s]+/g, '_').toLowerCase();
}
function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(normalizeKey(key));
}

// 把同一类敏感项归为一类，界面按类别汇总
function categoryOfKey(key) {
  const k = normalizeKey(key);
  if (/(password|passwd|pwd|passphrase)$/.test(k)) return 'password';
  if (/token$/.test(k)) return 'token';
  if (/(api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|master[_-]?key|license[_-]?key|auth[_-]?key)$/.test(k)) return 'key';
  if (/credentials?$/.test(k)) return 'credential';
  if (/(connection[_-]?string|conn[_-]?str|database[_-]?url|db[_-]?url|dsn|(mongodb?|mysql|postgres(?:ql)?|redis|amqp|rabbitmq|kafka)[_-]?(url|uri|dsn))$/.test(k)) return 'connection';
  return 'secret';
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// 用户在界面追加的关键字：与内置后缀一起参与键名判断
function createKeyMatcher(extraKeywords) {
  const extra = (Array.isArray(extraKeywords) ? extraKeywords : [])
    .map((s) => String(s || '').trim()).filter(Boolean);
  if (!extra.length) return { isSensitive: isSensitiveKey, categoryOf: categoryOfKey };
  const alt = extra.map(escapeRe).join('|');
  const re = new RegExp(`(?:^|[_-])(?:${SENSITIVE_KEY_SUFFIX}|${alt})$`, 'i');
  const extraSet = new Set(extra.map(normalizeKey));
  function isSensitive(key) {
    const k = normalizeKey(key);
    return re.test(k) || extraSet.has(k);
  }
  function categoryOf(key) {
    const k = normalizeKey(key);
    if (isSensitiveKey(k)) return categoryOfKey(k);
    return 'secret';
  }
  return { isSensitive, categoryOf };
}

// 引用密钥：`key = "value"` / `key: "value"`（引号包裹）
const ASSIGN_QUOTED_RE = /\b([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*(['"`])([^'"`\r\n]{6,})\2/g;
// 配置类文件里的裸值：`KEY=value` / `key: value`
const ASSIGN_BARE_RE = /\b([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*([^\s'"`#(){}\[\]]{6,})/g;

// 规则：id 用于界面词条，severity 只分 high/medium；category 用于把同类问题归为一类；re 必须带 g。
const RULES = [
  { id: 'private-key', severity: 'high', category: 'key', re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g },
  { id: 'credential-url', severity: 'high', category: 'connection', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi, ignore: (m) => /[<>{}$]/.test(m[0]) },
  { id: 'aws-access-key', severity: 'high', category: 'key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', severity: 'high', category: 'token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { id: 'gitlab-token', severity: 'high', category: 'token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', severity: 'high', category: 'token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'google-api-key', severity: 'high', category: 'key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'openai-key', severity: 'high', category: 'key', re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { id: 'bearer-token', severity: 'medium', category: 'token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { id: 'jwt', severity: 'medium', category: 'token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    id: 'secret-assignment',
    severity: 'medium',
    re: ASSIGN_QUOTED_RE,
    category: (m, mt) => mt.categoryOf(m[1]),
    ignore: (m, mt) => !mt.isSensitive(m[1]) || isPlaceholder(m[3]),
  },
  {
    id: 'secret-assignment',
    severity: 'medium',
    exts: CONFIG_EXTS,
    re: ASSIGN_BARE_RE,
    category: (m, mt) => mt.categoryOf(m[1]),
    ignore: (m, mt) => !mt.isSensitive(m[1]) || isPlaceholder(m[2]),
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

async function scanFile(root, rel, match) {
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
        if (rule.ignore && rule.ignore(m, match)) continue;
        const category = typeof rule.category === 'function' ? rule.category(m, match) : (rule.category || 'secret');
        findings.push({
          rel,
          line: i + 1,
          rule: rule.id,
          severity: rule.severity,
          category,
          match: mask(m[0]),
        });
        if (findings.length >= MAX_FINDINGS_PER_FILE) return { rel, findings, truncated: true };
      }
    }
  }
  return { rel, findings };
}

function isGitUrl(s) {
  const v = String(s || '').trim();
  return /^(https?|git|ssh):\/\//i.test(v) || /^[^\s@:]+@[^\s:]+:\S+$/.test(v);
}

// 把 git 仓库按分支浅克隆到本地缓存，供扫描使用
async function ensureClone(url, branch, cacheDir) {
  const root = cacheDir || path.join(os.tmpdir(), 'devflow-scan-repos');
  const hash = crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
  const dest = path.join(root, `${hash}-${branch}`);
  if (fs.existsSync(path.join(dest, '.git'))) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await execFileP('git', ['clone', '--depth', '1', '--single-branch', '--branch', branch, String(url), dest], { timeout: 180000, windowsHide: true });
  return dest;
}

function aggregate(findings, scanned, files, truncated) {
  const ruleMap = new Map();
  for (const f of findings) {
    const cur = ruleMap.get(f.rule) || { rule: f.rule, severity: f.severity, count: 0 };
    cur.count += 1;
    ruleMap.set(f.rule, cur);
  }
  const byRule = [...ruleMap.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
  const catMap = new Map();
  for (const f of findings) {
    const cur = catMap.get(f.category) || { category: f.category, count: 0, high: 0 };
    cur.count += 1;
    if (f.severity === 'high') cur.high += 1;
    catMap.set(f.category, cur);
  }
  const byCategory = [...catMap.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return { byRule, byCategory, totals: { files, findings: findings.length, scanned }, ...(truncated ? { truncated: true } : {}) };
}

export async function scanSecrets(opts = {}) {
  const { dir, excludeDirs, keywords, categories } = opts;
  if (typeof dir !== 'string' || !dir.trim()) throw err('bad-dir', 'dir required');
  const root = dir.trim();
  const match = createKeyMatcher(keywords);

  // git 地址：浅克隆 master/develop 两个分支后分别扫描，结果合并
  if (isGitUrl(root)) {
    const branches = (Array.isArray(opts.branches) && opts.branches.length ? opts.branches : ['master', 'develop']).map(String);
    const results = [];
    const failures = [];
    for (const branch of branches) {
      try {
        const cloneDir = await ensureClone(root, branch, opts.cacheDir);
        const r = await scanSecrets({ dir: cloneDir, excludeDirs, keywords, categories });
        results.push({ branch, result: r });
      } catch (e) {
        failures.push({ branch, error: String((e && e.message) || e) });
      }
    }
    if (!results.length) throw err('clone-failed', failures.map((f) => `${f.branch}: ${f.error}`).join('; ') || 'clone failed');
    const findings = [];
    let scanned = 0;
    for (const { branch, result } of results) {
      scanned += result.scanned;
      for (const f of result.findings) findings.push({ ...f, branch, rel: `${branch}/${f.rel}` });
    }
    const files = new Set(findings.map((f) => f.rel)).size;
    const agg = aggregate(findings, scanned, files, results.some((x) => x.result.truncated));
    return {
      dir: root,
      scanned,
      findings,
      ...agg,
      branches: results.map((x) => ({ branch: x.branch, scanned: x.result.scanned, findings: x.result.findings.length })),
      ...(failures.length ? { failures } : {}),
    };
  }

  let st;
  try { st = await fsp.stat(root); } catch { throw err('not-found', 'path not found'); }
  if (!st.isDirectory()) throw err('not-found', 'not a directory');

  const dirs = Array.isArray(excludeDirs)
    ? excludeDirs.map((d) => String(d).trim().replace(/^\/+|\/+$/g, '').toLowerCase()).filter(Boolean)
    : [];
  const all = listFiles(root, dirs).sort();

  let findings = [];
  let scanned = 0;
  let truncated = false;
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const chunk = all.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((rel) => scanFile(root, rel, match)));
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

  if (Array.isArray(categories) && categories.length) {
    const allow = new Set(categories.map(String));
    findings = findings.filter((f) => allow.has(f.category));
  }
  const files = new Set(findings.map((f) => f.rel)).size;
  return { dir: root, scanned, findings, ...aggregate(findings, scanned, files, truncated) };
}
