import fs from 'node:fs';
import { execFile } from 'node:child_process';

const STATUS_MAP = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'modified', T: 'modified' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COMMITS = 500;
const MAX_FILES = 5000;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repoPath, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') { reject(err('git-unavailable', 'git not found in PATH')); return; }
        reject(err('git-failed', String(stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
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

function summarize(commits) {
  const map = new Map();
  const applyEvent = (row, status, date) => {
    row.touches += 1;
    row.lastDate = date;
    if (!row.firstRaw) row.firstRaw = status;
    row.lastRaw = status;
    if (status === 'renamed') row.sawRename = true;
  };
  // git 默认最新在前，反转成时间正序以正确判定首次/末次状态
  for (const c of [...commits].reverse()) {
    for (const f of c.files) {
      if (f.status === 'renamed' && f.oldPath && map.has(f.oldPath)) {
        const row = map.get(f.oldPath);
        map.delete(f.oldPath);
        row.path = f.path;
        if (!row.oldPath) row.oldPath = f.oldPath;
        applyEvent(row, f.status, c.date);
        map.set(f.path, row);
        continue;
      }
      let row = map.get(f.path);
      if (!row) {
        row = { path: f.path, oldPath: f.oldPath, firstRaw: null, lastRaw: null, sawRename: false, touches: 0, lastDate: c.date };
        map.set(f.path, row);
      } else if (f.oldPath && !row.oldPath) {
        row.oldPath = f.oldPath;
      }
      applyEvent(row, f.status, c.date);
    }
  }
  const rows = [];
  for (const row of map.values()) {
    let status;
    if (row.lastRaw === 'deleted') status = 'deleted';
    else if (row.firstRaw === 'added') status = 'added';
    else if (row.sawRename) status = 'renamed';
    else status = 'modified';
    rows.push({ path: row.path, status, ...(row.oldPath ? { oldPath: row.oldPath } : {}), touches: row.touches, lastDate: row.lastDate });
  }
  return rows;
}

export async function collectGitChanges({ repoPath, since, until } = {}) {
  if (typeof repoPath !== 'string' || !repoPath) throw err('not-found', 'repoPath required');
  let st;
  try { st = fs.statSync(repoPath); } catch { throw err('not-found', 'repo path not found'); }
  if (!st.isDirectory()) throw err('not-found', 'repo path is not a directory');
  if (!DATE_RE.test(since || '') || !DATE_RE.test(until || '')) throw err('bad-date', 'date must be YYYY-MM-DD');
  if (since > until) throw err('bad-range', 'since is after until');

  let inside;
  try {
    inside = (await runGit(repoPath, ['rev-parse', '--is-inside-work-tree'])).trim();
  } catch (e) {
    if (e.code === 'git-unavailable') throw e;
    throw err('not-a-repo', e.message);
  }
  if (inside !== 'true') throw err('not-a-repo', 'not a git work tree');

  let branch = null;
  try {
    branch = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || null;
  } catch { /* 空仓库无分支，忽略 */ }

  const out = await runGit(repoPath, [
    '-c', 'core.quotepath=false',
    'log',
    `--since=${since}T00:00:00`,
    `--until=${until}T23:59:59`,
    '--no-merges',
    '-M',
    '--name-status',
    '--pretty=format:@@%x01%H%x01%an%x01%ae%x01%aI%x01%s',
  ]);

  const parsed = parseLog(out);
  const commits = parsed.slice(0, MAX_COMMITS).map((c) => ({
    hash: c.hash, short: c.short, author: c.author, email: c.email, date: c.date, subject: c.subject, files: c.files,
  }));
  const summaryAll = summarize(commits);
  const summary = summaryAll.slice(0, MAX_FILES);
  const truncated = parsed.length > MAX_COMMITS || summaryAll.length > MAX_FILES;

  const stats = { commits: commits.length, files: summary.length, added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const r of summary) stats[r.status] = (stats[r.status] || 0) + 1;

  return {
    repo: { path: repoPath, branch },
    range: { since, until },
    stats,
    summary,
    commits,
    ...(truncated ? { truncated: true } : {}),
  };
}
