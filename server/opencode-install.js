import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { resolveAgentBin } from './collaboration/agent-stats.js';

export const OPENCODE_DOWNLOAD_URL = 'https://gitee.com/slxxzh12/vscode-ai/releases/download/opencode-windows-x64/opencode-windows-x64.zip';
export const KNOWN_AGENT_CMDS = ['opencode', 'claudecode', 'claude', 'nga', 'pi', 'codeagent'];

const execFileAsync = promisify(execFile);

const USER_PATH_SCRIPT = [
  '$dir = $env:DF_OPENCODE_PATH',
  'if ([string]::IsNullOrWhiteSpace($dir)) { exit 2 }',
  "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
  'if ($null -eq $key) { exit 3 }',
  "$cur = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
  '$kind = [Microsoft.Win32.RegistryValueKind]::ExpandString',
  "try { $kind = $key.GetValueKind('Path') } catch { }",
  "$parts = @($cur -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })",
  "$want = $dir.TrimEnd('\\')",
  '$found = $false',
  "foreach ($p in $parts) { if ([string]::Equals($p.TrimEnd('\\'), $want, [StringComparison]::OrdinalIgnoreCase)) { $found = $true; break } }",
  "if (-not $found) { $parts += $dir; $key.SetValue('Path', ($parts -join ';'), $kind) }",
  '$key.Close()',
  'exit 0',
].join('; ');

function samePath(a, b) {
  if (process.platform === 'win32') return String(a).toLowerCase() === String(b).toLowerCase();
  return String(a) === String(b);
}

export function opencodePaths(appRoot) {
  const softDir = path.join(appRoot, 'soft');
  return { softDir, exe: path.join(softDir, 'opencode.exe') };
}

export function detectAgents(agents = [], { env = process.env, exists = fs.existsSync, appRoot } = {}) {
  const cmds = new Set();
  for (const agent of Array.isArray(agents) ? agents : []) {
    const cmd = String(agent?.cmd || '').trim();
    if (cmd) cmds.add(cmd);
  }
  for (const cmd of KNOWN_AGENT_CMDS) cmds.add(cmd);
  const installed = [];
  for (const cmd of cmds) {
    const bin = resolveAgentBin(cmd, { env, exists, appRoot });
    if (bin && path.isAbsolute(bin) && exists(bin)) installed.push({ cmd, path: bin });
  }
  return installed;
}

export function prependProcessPath(dir, { env = process.env } = {}) {
  const parts = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  if (!parts.some((p) => samePath(p, dir))) env.PATH = [dir, ...parts].join(path.delimiter);
  return env.PATH || '';
}

export async function persistUserPath(dir, { platform = process.platform, env = process.env, execFileFn = execFileAsync } = {}) {
  if (platform !== 'win32') return false;
  const encoded = Buffer.from(USER_PATH_SCRIPT, 'utf16le').toString('base64');
  await execFileFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: { ...env, DF_OPENCODE_PATH: dir },
    windowsHide: true,
  });
  return true;
}

function extractOpencode(zipPath, target) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr) return fail(openErr);
      zip.on('error', fail);
      zip.on('end', () => fail(new Error('opencode.exe not found in zip')));
      zip.on('entry', (entry) => {
        if (!/^opencode\.exe$/i.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        const tmp = `${target}.download`;
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return fail(streamErr);
          pipeline(stream, fs.createWriteStream(tmp))
            .then(async () => {
              await fsp.rm(target, { force: true });
              await fsp.rename(tmp, target);
              if (settled) return;
              settled = true;
              zip.close();
              resolve(target);
            })
            .catch((err) => {
              fsp.rm(tmp, { force: true }).catch(() => {});
              fail(err);
            });
        });
      });
      zip.readEntry();
    });
  });
}

export function createOpencodeInstaller({
  appRoot,
  agents = () => [],
  getAgents = null,
  url = process.env.DEVFLOW_OPENCODE_URL || OPENCODE_DOWNLOAD_URL,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  fetchFn = fetch,
  logger = console,
  persistPath = persistUserPath,
} = {}) {
  const paths = opencodePaths(appRoot);
  const listAgents = () => (typeof getAgents === 'function' ? getAgents() : agents());
  let download = {
    state: 'idle',
    downloaded: 0,
    total: 0,
    error: '',
    path: '',
    userPath: false,
    startedAt: 0,
    finishedAt: 0,
  };
  let task = null;

  function snapshot() {
    const installed = detectAgents(listAgents(), { env, appRoot });
    const exists = fs.existsSync(paths.exe);
    let current = download;
    if (current.state === 'idle' && exists) {
      current = { ...current, state: 'done', path: paths.exe, finishedAt: current.finishedAt || Date.now() };
    }
    const percent = current.total
      ? Math.min(100, Math.round((current.downloaded / current.total) * 100))
      : (current.state === 'done' ? 100 : 0);
    return {
      supported: platform === 'win32',
      platform,
      arch,
      anyInstalled: installed.length > 0 || exists,
      installed,
      target: paths.exe,
      downloadUrl: url,
      download: { ...current, percent, path: current.path || (exists ? paths.exe : '') },
    };
  }

  function markDone(userPath) {
    download = {
      ...download,
      state: 'done',
      error: '',
      path: paths.exe,
      userPath: !!userPath,
      finishedAt: Date.now(),
    };
  }

  async function persist(dir) {
    try {
      return await persistPath(dir, { platform, env });
    } catch (err) {
      logger?.warn?.('opencode user PATH update failed', (err && err.message) || err);
      return false;
    }
  }

  async function run() {
    await fsp.mkdir(paths.softDir, { recursive: true });
    const zipPath = path.join(paths.softDir, `.opencode-download-${process.pid}-${Date.now()}.zip`);
    try {
      const res = await fetchFn(url, { redirect: 'follow' });
      if (!res || !res.ok || !res.body) throw new Error(`download failed: HTTP ${res?.status || 0}`);
      const total = Number(res.headers?.get?.('content-length')) || 0;
      download = {
        state: 'downloading',
        downloaded: 0,
        total,
        error: '',
        path: '',
        userPath: false,
        startedAt: Date.now(),
        finishedAt: 0,
      };
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          download.downloaded += chunk.length;
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(zipPath));
      await extractOpencode(zipPath, paths.exe);
      prependProcessPath(paths.softDir, { env });
      const userPath = await persist(paths.softDir);
      markDone(userPath);
      logger?.info?.(`opencode installed: ${paths.exe}`);
      return snapshot();
    } catch (err) {
      download = {
        ...download,
        state: 'error',
        error: String((err && err.message) || err || 'install failed'),
        finishedAt: Date.now(),
      };
      logger?.warn?.('opencode install failed', download.error);
      throw err;
    } finally {
      await fsp.rm(zipPath, { force: true }).catch(() => {});
    }
  }

  function begin() {
    download = {
      state: 'downloading',
      downloaded: 0,
      total: 0,
      error: '',
      path: '',
      userPath: false,
      startedAt: Date.now(),
      finishedAt: 0,
    };
    task = run().finally(() => { task = null; });
  }

  function start() {
    if (fs.existsSync(paths.exe)) {
      prependProcessPath(paths.softDir, { env });
      if (download.state !== 'done') markDone(false);
      return snapshot();
    }
    if (!task) begin();
    return snapshot();
  }

  async function install() {
    if (fs.existsSync(paths.exe) && download.state !== 'downloading') {
      prependProcessPath(paths.softDir, { env });
      if (download.state !== 'done') markDone(false);
      return snapshot();
    }
    if (!task) begin();
    await task;
    return snapshot();
  }

  return { status: snapshot, start, install, paths };
}
