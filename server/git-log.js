import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { makeKeepPath } from '@devflow/shared/git-filter';

const STATUS_MAP = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'modified', T: 'modified' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COMMITS = 500;
const MAX_FILES = 5000;
const CLONE_TIMEOUT = 120 * 1000;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function runGitRaw(args, { timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') { reject(err('git-unavailable', 'git not found in PATH')); return; }
        if (error.killed || error.signal) { reject(err('git-timeout', 'git command timed out')); return; }
        reject(err('git-failed', String(stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function runGit(repo, args) {
  return runGitRaw(['-C', repo, ...args]);
}

// 远程地址判定：scheme 形式或 scp 形式（user@host:path）
function isGitUrl(s) {
  return /^(https?|git|ssh|file):\/\//i.test(s) || /^[^\s@:]+@[^\s:]+:\S+$/.test(s);
}

function parseLog(out) {
  const commits = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.startsWith('@@')) {
      const parts = line.split('\x01');
      const hash = parts[1] || '';
      cur = {
        hash,
        short: hash.slice(0, 7),
        author: parts[2] || '',
        email: parts[3] || '',
        date: parts[4] || '',
        subject: parts.slice(5).join('\x01'),
        files: [],
      };
      commits.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^([AMDRTC])(\d*)\t(.*)$/);
    if (!m) continue;
    const status = STATUS_MAP[m[1]];
    const rest = m[3];
    if ((m[1] === 'R' || m[1] === 'C') && rest.includes('\t')) {
      const idx = rest.indexOf('\t');
      cur.files.push({ status, path: rest.slice(idx + 1), oldPath: rest.slice(0, idx) });
    } else {
      cur.files.push({ status, path: rest });
    }
  }
  return commits;
}

// 解析 `git log --numstat` 输出：每个提交 → [{ added, deleted, path, oldPath }]
// 重命名以 `{old => new}` 形式给出，拆成 path（新）与 oldPath（旧）；二进制为 `-` 记 0
function parseNumstat(out) {
  const map = new Map();
  let cur = null;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.startsWith('@@')) {
      const hash = line.split('\x01')[1] || '';
      cur = [];
      map.set(hash, cur);
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/);
    if (!m) continue;
    const added = m[1] === '-' ? 0 : parseInt(m[1], 10);
    const deleted = m[2] === '-' ? 0 : parseInt(m[2], 10);
    let path = m[3];
    let oldPath = null;
    const b = path.match(/^(.*)\{([^{}]*?) => ([^{}]*?)\}(.*)$/);
    if (b) {
      oldPath = b[1] + b[2] + b[4];
      path = b[1] + b[3] + b[4];
    }
    cur.push({ added, deleted, path, oldPath });
  }
  return map;
}

// 将 numstat 的行数信息按（提交哈希 + 新路径）回填到各提交文件上
function mergeNumstat(commits, numMap) {
  for (const c of commits) {
    const nums = numMap.get(c.hash);
    if (!nums) continue;
    const byPath = new Map(nums.map((n) => [n.path, n]));
    for (const f of c.files) {
      const n = byPath.get(f.path);
      if (n) { f.added = n.added; f.deleted = n.deleted; }
    }
  }
}

function summarize(commits) {
  const map = new Map();
  const applyEvent = (row, status, date, author, email, added, deleted) => {
    row.touches += 1;
    row.lastDate = date;
    row.lastAuthor = author;
    row.lastEmail = email;
    row.added += added;
    row.deleted += deleted;
    if (!row.firstRaw) row.firstRaw = status;
    row.lastRaw = status;
    if (status === 'renamed') row.sawRename = true;
  };
  // git 默认最新在前，反转成时间正序以正确判定首次/末次状态
  for (const c of [...commits].reverse()) {
    for (const f of c.files) {
      const added = f.added || 0;
      const deleted = f.deleted || 0;
      if (f.status === 'renamed' && f.oldPath && map.has(f.oldPath)) {
        const row = map.get(f.oldPath);
        map.delete(f.oldPath);
        row.path = f.path;
        if (!row.oldPath) row.oldPath = f.oldPath;
        applyEvent(row, f.status, c.date, c.author, c.email, added, deleted);
        map.set(f.path, row);
        continue;
      }
      let row = map.get(f.path);
      if (!row) {
        row = { path: f.path, oldPath: f.oldPath, firstRaw: null, lastRaw: null, sawRename: false, touches: 0, lastDate: c.date, lastAuthor: c.author, lastEmail: c.email, added: 0, deleted: 0 };
        map.set(f.path, row);
      } else if (f.oldPath && !row.oldPath) {
        row.oldPath = f.oldPath;
      }
      applyEvent(row, f.status, c.date, c.author, c.email, added, deleted);
    }
  }
  const rows = [];
  for (const row of map.values()) {
    let status;
    if (row.lastRaw === 'deleted') status = 'deleted';
    else if (row.firstRaw === 'added') status = 'added';
    else if (row.sawRename) status = 'renamed';
    else status = 'modified';
    rows.push({ path: row.path, status, ...(row.oldPath ? { oldPath: row.oldPath } : {}), touches: row.touches, lastDate: row.lastDate, lastAuthor: row.lastAuthor, lastEmail: row.lastEmail, added: row.added, deleted: row.deleted });
  }
  return rows;
}

// 远程地址 → 克隆到临时目录裸仓库，返回 { target, cleanup }；失败时抛并清掉临时目录
async function cloneToTemp(repo) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dfgit-clone-'));
  const target = path.join(parent, 'repo');
  try {
    await runGitRaw(['clone', '--quiet', '--bare', repo, target], { timeout: CLONE_TIMEOUT });
  } catch (e) {
    fs.rmSync(parent, { recursive: true, force: true });
    if (e.code === 'git-unavailable') throw e;
    if (e.code === 'git-timeout') throw err('clone-timeout', `clone timed out after ${CLONE_TIMEOUT / 1000}s`);
    throw err('clone-failed', e.message);
  }
  return { target, cleanup: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

export async function collectGitChanges({ repo, since, until, filter } = {}) {
  if (typeof repo !== 'string' || !repo.trim()) throw err('bad-repo', 'repo required');
  const source = repo.trim();
  if (source.startsWith('-')) throw err('bad-repo', 'invalid repo');
  if (!DATE_RE.test(since || '') || !DATE_RE.test(until || '')) throw err('bad-date', 'date must be YYYY-MM-DD');
  if (since > until) throw err('bad-range', 'since is after until');
  const flt = filter && typeof filter === 'object' ? filter : null;

  const remote = isGitUrl(source);
  let target = source;
  let cleanup = null;
  if (remote) {
    const cloned = await cloneToTemp(source);
    target = cloned.target;
    cleanup = cloned.cleanup;
  } else {
    let st;
    try { st = fs.statSync(source); } catch { throw err('not-found', 'repo path not found'); }
    if (!st.isDirectory()) throw err('not-found', 'repo path is not a directory');
  }

  try {
    try {
      await runGit(target, ['rev-parse', '--git-dir']);
    } catch (e) {
      if (e.code === 'git-unavailable') throw e;
      throw err('not-a-repo', e.message);
    }

    let branch = null;
    try {
      branch = (await runGit(target, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || null;
      if (branch === 'HEAD') branch = null;
    } catch { /* 空仓库无分支，忽略 */ }

    const logArgs = [
      '-c', 'core.quotepath=false',
      'log',
      `--since=${since}T00:00:00`,
      `--until=${until}T23:59:59`,
      '--no-merges',
      '-M',
    ];

    const out = await runGit(target, [
      ...logArgs,
      '--name-status',
      '--pretty=format:@@%x01%H%x01%an%x01%ae%x01%aI%x01%s',
    ]);

    const numOut = await runGit(target, [
      ...logArgs,
      '--numstat',
      '--pretty=format:@@%x01%H%x01%an%x01%ae%x01%aI%x01%s',
    ]);

    const parsed = parseLog(out);
    const allCommits = parsed.map((c) => ({
      hash: c.hash, short: c.short, author: c.author, email: c.email, date: c.date, subject: c.subject, files: c.files,
    }));
    mergeNumstat(allCommits, parseNumstat(numOut));
    const keep = flt ? makeKeepPath(flt) : null;
    const kept = keep
      ? allCommits.filter((c) => { c.files = c.files.filter((fp) => keep(fp.path)); return c.files.length > 0; })
      : allCommits;
    const commits = kept.slice(0, MAX_COMMITS);
    const summaryAll = summarize(commits);
    const summary = summaryAll.slice(0, MAX_FILES);
    const truncated = kept.length > MAX_COMMITS || summaryAll.length > MAX_FILES;

    const stats = { commits: commits.length, files: summary.length, added: 0, modified: 0, deleted: 0, renamed: 0 };
    for (const r of summary) stats[r.status] = (stats[r.status] || 0) + 1;

    return {
      repo: { path: source, branch, cloned: remote },
      range: { since, until },
      stats,
      summary,
      commits,
      ...(truncated ? { truncated: true } : {}),
    };
  } finally {
    if (cleanup) cleanup();
  }
}
