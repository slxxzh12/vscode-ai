import { spawn } from 'node:child_process';

function run(cwd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e && e.message || e) });
    }
    let stdout = '';
    let stderr = '';
    const timer = timeoutMs > 0 ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e && e.message || e) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function sanitizeBranchUser(name) {
  return String(name || '').trim()
    .replace(/[\s~^:?*[\\\x00-\x1f]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function branchFor(user) {
  const u = sanitizeBranchUser(user);
  return u ? `feature/${u}` : '';
}

export async function getGitUserName(cwd) {
  const r = await run(cwd, ['config', 'user.name']);
  return r.code === 0 ? r.stdout.trim() : '';
}

async function defaultBranch(cwd) {
  const head = await run(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const name of ['origin/main', 'origin/master']) {
    const ok = await run(cwd, ['show-ref', '--verify', '--quiet', `refs/remotes/${name}`]);
    if (ok.code === 0) return name;
  }
  return '';
}

export async function detectRemoteDefault(cwd) {
  const full = await defaultBranch(cwd);
  return full ? full.replace(/^origin\//, '') : '';
}

export async function syncBranchToRemote(cwd, branch, base) {
  if (!branch || !base) return { ok: false, error: 'bad-args' };
  const fetched = await run(cwd, ['fetch', 'origin']);
  if (fetched.code !== 0) return { ok: false, error: 'fetch-failed', message: fetched.stderr.trim() };
  const checked = await run(cwd, ['checkout', branch]);
  if (checked.code !== 0) return { ok: false, error: 'checkout-failed', message: checked.stderr.trim() };
  const merged = await run(cwd, ['merge', '--ff-only', `origin/${base}`]);
  return merged.code === 0
    ? { ok: true }
    : { ok: false, error: 'sync-failed', message: merged.stderr.trim() };
}

export async function prepareUserBranch(cwd, user) {
  const branch = branchFor(user);
  if (!branch) return { error: 'missing-user-name' };

  const fetched = await run(cwd, ['fetch', 'origin']);
  if (fetched.code !== 0) return { error: 'fetch-failed', message: fetched.stderr.trim() };

  const local = await run(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  let checked;
  if (local.code === 0) {
    checked = await run(cwd, ['checkout', branch]);
  } else {
    const remote = await run(cwd, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    if (remote.code === 0) checked = await run(cwd, ['checkout', '-b', branch, '--track', `origin/${branch}`]);
    else {
      const base = await defaultBranch(cwd);
      if (!base) return { error: 'no-default-branch' };
      checked = await run(cwd, ['checkout', '-b', branch, base]);
    }
  }
  if (checked.code !== 0) return { error: 'checkout-failed', message: checked.stderr.trim() };

  const status = await run(cwd, ['status', '--porcelain']);
  if (status.stdout.trim()) return { error: 'dirty-worktree' };
  return { branch };
}

export async function commitAll(cwd, message) {
  const status = await run(cwd, ['status', '--porcelain']);
  if (!status.stdout.trim()) return { commit: null };
  const added = await run(cwd, ['add', '-A']);
  if (added.code !== 0) return { error: 'git-add-failed', message: added.stderr.trim() };
  const committed = await run(cwd, ['commit', '-m', message]);
  if (committed.code !== 0) return { error: 'git-commit-failed', message: committed.stderr.trim() };
  const head = await run(cwd, ['rev-parse', 'HEAD']);
  return { commit: head.stdout.trim() };
}

export async function pushBranch(cwd, branch) {
  const first = await run(cwd, ['push', '-u', 'origin', branch]);
  if (first.code === 0) return { ok: true, rebased: false };
  const pull = await run(cwd, ['pull', '--rebase', 'origin', branch]);
  if (pull.code !== 0) {
    await run(cwd, ['rebase', '--abort']);
    return { ok: false, error: 'push-rejected', message: first.stderr.trim() };
  }
  const second = await run(cwd, ['push', '-u', 'origin', branch]);
  return second.code === 0
    ? { ok: true, rebased: true }
    : { ok: false, error: 'push-rejected', message: second.stderr.trim() };
}
