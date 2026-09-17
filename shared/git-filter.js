// Git 提交统计的文件过滤规则：后端用它过滤，前端用它作为「代码后缀 / 排除目录」输入框默认值。
// 后缀与目录清单由用户在界面编辑，这里只提供默认的常见集合。

export const DEFAULT_CODE_EXTS = [
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.py', '.java', '.kt', '.go', '.rs',
  '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.rb', '.swift', '.scala', '.dart',
  '.sh', '.bash', '.ps1', '.bat', '.sql', '.xml', '.lua',
];

export const DEFAULT_EXCLUDE_DIRS = [
  'node_modules',
  'docs', 'doc', 'documentation',
  'test', 'tests', '__tests__', 'spec', 'specs', 'e2e',
];

// 清单/锁文件：不是「代码」，即使后缀被加进白名单也一律不算
export const SKIP_BASENAMES = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json',
  'yarn.lock', 'pnpm-lock.yaml',
]);

const DEFAULT_EXT_SET = new Set(DEFAULT_CODE_EXTS);

export function basename(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export function extOf(p) {
  const base = basename(p);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i).toLowerCase() : '';
}

function dirSegments(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? [] : p.slice(0, i).split('/').map((s) => s.toLowerCase());
}

export function isTestFile(p) {
  const b = basename(p).toLowerCase();
  return /\.(test|spec)\.[^.]+$/.test(b)
    || /[_-](test|spec)\.[^.]+$/.test(b)
    || /^test_.+\.[^.]+$/.test(b)
    || /test\.(java|kt|cs|rb|scala|php)$/.test(b);
}

// 把用户输入（数组或逗号/空格/分号分隔的字符串）归一成 ['.js', '.ts', ...]
export function parseExts(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const out = [];
  for (const raw of arr) {
    let e = String(raw).trim().toLowerCase();
    if (!e) continue;
    if (!e.startsWith('.')) e = `.${e}`;
    if (e.length > 1 && !out.includes(e)) out.push(e);
  }
  return out;
}

// 目录名归一：小写、去首尾斜杠，去重
export function parseDirs(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const out = [];
  for (const raw of arr) {
    const d = String(raw).trim().replace(/^\/+|\/+$/g, '').toLowerCase();
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

// 生成路径过滤谓词；filter.exts 为空时回退到默认常见后缀
export function makeKeepPath(filter = {}) {
  const exts = parseExts(filter.exts);
  const extSet = exts.length ? new Set(exts) : DEFAULT_EXT_SET;
  const dirSet = new Set(parseDirs(filter.excludeDirs));
  return (p) => {
    const segs = dirSegments(p);
    if (dirSet.size && segs.some((s) => dirSet.has(s))) return false;
    if (SKIP_BASENAMES.has(basename(p).toLowerCase())) return false;
    if (filter.excludeTestFiles && isTestFile(p)) return false;
    if (filter.codeOnly && !extSet.has(extOf(p))) return false;
    return true;
  };
}

// 超大提交阈值（单次提交新增行数）：超过即整条提交不计入统计
export const DEFAULT_HUGE_COMMIT_ADDED_LIMIT = 2000;

// 阈值归一：非正整数一律视为 0（不过滤）
export function parseHugeCommitLimit(input) {
  const n = typeof input === 'number' ? input : parseInt(String(input ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}
