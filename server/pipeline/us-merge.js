import { spawn } from 'node:child_process';
import { detectRemoteDefault } from './us-git.js';

function runProcess(cwd, bin, args, { input, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function parseRemoteUrl(raw) {
  const text = String(raw || '').trim();
  const out = { host: '', owner: '', repo: '', provider: '' };
  const scp = text.match(/^[^@\s]+@([^:]+):(.+)$/);
  if (scp) {
    const parts = scp[2].replace(/^\/+/, '').split('/');
    out.host = scp[1];
    out.owner = parts[0] || '';
    out.repo = (parts[1] || '').replace(/\.git$/i, '');
  } else {
    try {
      const u = new URL(text);
      const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
      out.host = u.hostname;
      out.owner = parts[0] || '';
      out.repo = (parts[1] || '').replace(/\.git$/i, '');
    } catch {
      return out;
    }
  }
  if (out.host.includes('github')) out.provider = 'github';
  else if (out.host.includes('gitlab')) out.provider = 'gitlab';
  else if (out.host.includes('gitee')) out.provider = 'gitee';
  return out;
}

async function defaultCredential(cwd, host, credentialPath, { run = runProcess } = {}) {
  const input = `protocol=https\nhost=${host}\npath=${credentialPath}\n\n`;
  const r = await run(cwd, 'git', ['credential', 'fill'], { input });
  if (r.code !== 0) return null;
  const data = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) data[line.slice(0, i)] = line.slice(i + 1);
  }
  if (!data.password) return null;
  return { username: data.username || '', password: data.password };
}

function firstUrl(text) {
  return (String(text || '').match(/https?:\/\/[^\s]+/) || [])[0] || '';
}

async function mergeGithub({ codeDir, branch, base, title, body, run }) {
  let url = '';
  const list = await run(codeDir, 'gh', ['pr', 'list', '--head', branch, '--json', 'number,url,state']);
  if (list.code === 0) {
    try {
      const rows = JSON.parse(list.stdout || '[]');
      const open = rows.find((x) => String(x.state || '').toLowerCase() === 'open');
      if (open) url = String(open.url || '');
    } catch { /* ignore */ }
  }
  if (!url) {
    const created = await run(codeDir, 'gh', ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body]);
    if (created.code !== 0) return { ok: false, provider: 'github', error: 'gh-create-failed', message: created.stderr.trim() };
    url = firstUrl(created.stdout);
    if (!url) return { ok: false, provider: 'github', error: 'gh-create-failed', message: created.stdout.trim() };
  }
  const merged = await run(codeDir, 'gh', ['pr', 'merge', url, '--merge']);
  if (merged.code !== 0) return { ok: false, provider: 'github', url, error: 'gh-merge-failed', message: merged.stderr.trim() };
  return { ok: true, provider: 'github', url, base };
}

async function mergeGitlab({ codeDir, branch, base, title, body, run }) {
  let url = '';
  const list = await run(codeDir, 'glab', ['mr', 'list', '--source-branch', branch]);
  if (list.code === 0) url = firstUrl(list.stdout);
  if (!url) {
    const created = await run(codeDir, 'glab', ['mr', 'create', '--source-branch', branch, '--target-branch', base, '--title', title, '--description', body, '--yes']);
    if (created.code !== 0) return { ok: false, provider: 'gitlab', error: 'glab-create-failed', message: created.stderr.trim() };
    url = firstUrl(created.stdout);
    if (!url) return { ok: false, provider: 'gitlab', error: 'glab-create-failed', message: created.stdout.trim() };
  }
  const merged = await run(codeDir, 'glab', ['mr', 'merge', url, '--yes']);
  if (merged.code !== 0) return { ok: false, provider: 'gitlab', url, error: 'glab-merge-failed', message: merged.stderr.trim() };
  return { ok: true, provider: 'gitlab', url, base };
}

async function mergeGitee({ codeDir, info, branch, base, title, body, run, credential, fetchFn }) {
  const cred = await credential(codeDir, info.host, `${info.owner}/${info.repo}.git`);
  if (!cred || !cred.password) return { ok: false, provider: 'gitee', error: 'gitee-credentials-missing' };
  const token = cred.password;
  const api = `https://${info.host}/api/v5/repos/${info.owner}/${info.repo}`;
  let number = null;
  let url = '';

  const listUrl = `${api}/pulls?state=open&head=${encodeURIComponent(`${info.owner}:${branch}`)}&access_token=${encodeURIComponent(token)}`;
  const list = await fetchFn(listUrl, { headers: { 'Content-Type': 'application/json' } });
  if (!list.ok) return { ok: false, provider: 'gitee', error: 'gitee-list-failed' };
  const rows = await list.json();
  if (Array.isArray(rows) && rows.length) {
    number = rows[0].number ?? null;
    url = String(rows[0].html_url || rows[0].url || '');
  }

  if (!url) {
    const created = await fetchFn(`${api}/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token, title, head: `${info.owner}:${branch}`, base, body }),
    });
    if (!created.ok) return { ok: false, provider: 'gitee', error: 'gitee-create-failed' };
    const data = await created.json();
    number = data.number ?? null;
    url = String(data.html_url || data.url || '');
    if (!url || !number) return { ok: false, provider: 'gitee', error: 'gitee-create-failed' };
  }

  const merged = await fetchFn(`${api}/pulls/${number}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token, merge_method: 'merge' }),
  });
  if (!merged.ok) return { ok: false, provider: 'gitee', url, error: 'gitee-merge-failed' };
  const data = await merged.json();
  if (data && data.merged === false) return { ok: false, provider: 'gitee', url, error: 'gitee-merge-failed' };
  return { ok: true, provider: 'gitee', url, base };
}

export async function mergeUsBranch({
  codeDir, branch, us, title, body, base,
  run = runProcess, credential = null, fetchFn = fetch, logger = console,
}) {
  const remote = await run(codeDir, 'git', ['remote', 'get-url', 'origin']);
  if (remote.code !== 0) return { ok: false, error: 'no-remote' };
  const info = parseRemoteUrl(remote.stdout);
  if (!info.provider) return { ok: false, error: 'unsupported-remote' };

  const target = base || await detectRemoteDefault(codeDir);
  if (!target) return { ok: false, error: 'no-default-branch' };

  const subject = String(title || `feat(${String(us).split('-')[0]}): ${us}`);
  const text = String(body || `US: ${us}\nBranch: ${branch}\n`);
  try {
    if (info.provider === 'github') return await mergeGithub({ codeDir, branch, base: target, title: subject, body: text, run });
    if (info.provider === 'gitlab') return await mergeGitlab({ codeDir, branch, base: target, title: subject, body: text, run });
    const credFn = credential || ((cwd, host, p) => defaultCredential(cwd, host, p, { run }));
    return await mergeGitee({ codeDir, info, branch, base: target, title: subject, body: text, run, credential: credFn, fetchFn });
  } catch (e) {
    logger?.warn?.('us merge failed', (e && e.name) || 'error');
    return { ok: false, provider: info.provider, error: 'merge-failed' };
  }
}
