import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HAN = /[\u4e00-\u9fff]/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-portable', 'env', '.git']);
const SKIP_FILE = /\.test\.|\.d\.ts$/;
// 明确排除：日志行（不属于用户可见文案）
const LOG_LINE = /\b(console\.|logger\.|log\.(info|warn|error|debug))\b/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|ts|vue)$/.test(e.name) && !SKIP_FILE.test(e.name)) out.push(full);
  }
  return out;
}
// 去掉 HTML / 块 / 行注释（避免把 http:// 当注释）
function stripComments(src) {
  let s = src.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return s;
}
function scan(file) {
  const body = stripComments(fs.readFileSync(file, 'utf8'));
  const hits = [];
  body.split('\n').forEach((ln, i) => {
    if (LOG_LINE.test(ln)) return;
    if (HAN.test(ln)) hits.push({ line: i + 1, text: ln.trim() });
  });
  return hits;
}

const roots = ['web/src', 'server'].map((r) => path.join(ROOT, r)).filter((r) => fs.existsSync(r));
let total = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    for (const h of scan(file)) {
      total++;
      console.log(`${path.relative(ROOT, file)}:${h.line}: ${h.text}`);
    }
  }
}
if (total) {
  console.log(`\ncheck-i18n: 共 ${total} 处中文命中（目标：0）`);
  process.exit(1);
}
console.log('check-i18n: 未发现中文命中');
