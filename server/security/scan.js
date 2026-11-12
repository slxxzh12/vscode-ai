import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'dist-portable', 'logs', '.superpowers',
  'coverage', '.next', '.nuxt', '.cache', '.turbo',
]);

const CONTENT_RULES = [
  { rule: 'private-key', severity: 'high', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { rule: 'github-token', severity: 'high', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { rule: 'github-pat', severity: 'high', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { rule: 'gitlab-token', severity: 'high', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { rule: 'slack-token', severity: 'high', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: 'aws-key', severity: 'high', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'credential-url', severity: 'high', re: /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/ },
  { rule: 'gitee-token', severity: 'high', re: /\baccess_token\s*[:=]\s*['"]?([0-9a-f]{32})\b/i },
  { rule: 'generic-secret', severity: 'medium', re: /(?:token|secret|password|passwd|pwd|api[_-]?key)\s*[:=]\s*['"]([^'"\s]{8,})['"]/i },
];

const DANGEROUS_BASENAMES = new Set(['.env', '.npmrc', '.pypirc', 'credentials', 'id_rsa', 'id_ed25519']);
const DANGEROUS_EXTS = new Set(['.pem', '.key', '.p12', '.pfx', '.sqlite', '.db', '.mdb', '.kdbx']);
const IGNORE_SECRETS = /^(?:<|\$\{|process\.env|os\.environ|your|example|placeholder|changeme|change-me|xxxx|\*{3,}|test|demo)/i;

const MAX_FILES = 20000;
const MAX_BYTES = 1024 * 1024;
const MAX_FINDINGS = 1000;

function isDangerousFile(rel) {
  const base = path.basename(rel).toLowerCase();
  return DANGEROUS_BASENAMES.has(base)
    || base.startsWith('.env.')
    || DANGEROUS_EXTS.has(path.extname(base));
}

function inEnvDir(rel) {
  return rel.split(/[\\/]/).some((seg) => seg.toLowerCase() === 'env');
}

function walk(dir, base, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, base, out);
    } else if (e.isFile()) {
      out.push(full);
      if (out.length >= MAX_FILES) return;
    }
  }
}

function scanContent(root, rel, full, findings) {
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return;
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return;
  let buf;
  try {
    buf = fs.readFileSync(full);
  } catch {
    return;
  }
  if (buf.subarray(0, 8192).includes(0)) return;
  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of CONTENT_RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      if (rule.rule === 'generic-secret' && IGNORE_SECRETS.test(String(m[1] || '').trim())) continue;
      const key = `${rule.rule}:${i + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ root, path: rel, line: i + 1, rule: rule.rule, severity: rule.severity });
      if (findings.length >= MAX_FINDINGS) return;
    }
  }
}

export function scanSecurityDirs(dirs = []) {
  const findings = [];
  let files = 0;
  let bytes = 0;
  let scannedDirs = 0;

  for (const input of Array.isArray(dirs) ? dirs : []) {
    const root = path.resolve(String(input || ''));
    let stat;
    try {
      stat = fs.statSync(root);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    scannedDirs += 1;
    const list = [];
    walk(root, root, list);
    for (const full of list) {
      const rel = path.relative(root, full);
      files += 1;
      try { bytes += fs.statSync(full).size; } catch { /* ignore */ }
      if (isDangerousFile(rel)) {
        findings.push({ root, path: rel, line: 0, rule: 'dangerous-file', severity: 'medium' });
      }
      if (inEnvDir(rel)) {
        findings.push({ root, path: rel, line: 0, rule: 'env-dir', severity: 'medium' });
      }
      scanContent(root, rel, full, findings);
      if (findings.length >= MAX_FINDINGS) break;
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => (order[a.severity] - order[b.severity]) || a.path.localeCompare(b.path) || a.line - b.line);
  const summary = {
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    total: findings.length,
  };
  return { findings, summary, scanned: { dirs: scannedDirs, files, bytes } };
}
