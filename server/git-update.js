import fs from 'node:fs';
import { runGitRaw } from './git-log.js';

export const UPDATE_TIMEOUT_MS = 120 * 1000;
export const CHECK_TIMEOUT_MS = 15 * 1000;

// 逐目录更新：先确认是 git 工作树，再 git pull --ff-only 拉取最新提交。
// 不做 reset/force，遇到分叉或冲突只返回该目录失败，不影响其它目录。
export async function updateGitDirs(dirs, { runGit = runGitRaw, exists = fs.existsSync } = {}) {
  const list = [...new Set((Array.isArray(dirs) ? dirs : [])
    .map((d) => String(d || '').trim())
    .filter(Boolean))];
  const results = [];
  for (const dir of list) {
    if (!exists(dir)) {
      results.push({ dir, ok: false, code: 'not-found', message: 'directory not found' });
      continue;
    }
    try {
      await runGit(['-C', dir, 'rev-parse', '--is-inside-work-tree'], { timeout: CHECK_TIMEOUT_MS });
    } catch (e) {
      results.push({ dir, ok: false, code: 'not-a-repo', message: String((e && e.message) || e) });
      continue;
    }
    try {
      const out = await runGit(['-C', dir, 'pull', '--ff-only'], { timeout: UPDATE_TIMEOUT_MS });
      results.push({ dir, ok: true, code: 'ok', message: String(out || '').trim() });
    } catch (e) {
      results.push({ dir, ok: false, code: (e && e.code) || 'git-failed', message: String((e && e.message) || e) });
    }
  }
  return { results };
}
