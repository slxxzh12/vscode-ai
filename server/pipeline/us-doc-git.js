import { runGitRaw } from '../git-log.js';

// 方案仓中某个 US 目录最近一次提交的信息（用于变更检测与取提交人）。
async function gitLine(dir, args) {
  try {
    const out = await runGitRaw(['-C', dir, ...args], { timeout: 15000 });
    return String(out || '').trim();
  } catch {
    return '';
  }
}

// 返回该 US 目录最近一次提交的 hash；非 git 仓库/无提交时返回空串。
export async function docRevOf(dir, us) {
  return gitLine(dir, ['log', '-1', '--format=%H', '--', us]);
}

// 返回该 US 目录最近一次提交的作者 { name, email }；无提交时返回空。
export async function docAuthorOf(dir, us) {
  const out = await gitLine(dir, ['log', '-1', '--format=%an%x01%ae', '--', us]);
  if (!out) return { name: '', email: '' };
  const [name, email] = out.split('\u0001');
  return { name: String(name || '').trim(), email: String(email || '').trim() };
}
