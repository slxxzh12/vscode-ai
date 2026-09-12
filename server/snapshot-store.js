import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const SNAPSHOT_DIR = 'remote_coder';
const PNG_PREFIX = 'data:image/png;base64,';

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function snapshotName(date = new Date()) {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `devflow-${ymd}-${hms}.png`;
}

export function decodePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) {
    throw err('bad-image', 'expected data:image/png;base64 URL');
  }
  const buf = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64');
  if (!buf.length) throw err('bad-image', 'empty image');
  return buf;
}

function uniqueName(dir, base) {
  const dot = base.lastIndexOf('.');
  const stem = base.slice(0, dot);
  const ext = base.slice(dot);
  let name = base;
  let i = 1;
  while (fs.existsSync(path.join(dir, name))) name = `${stem}-${i++}${ext}`;
  return name;
}

function defaultGit(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120 * 1000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') { reject(err('git-unavailable', 'git not found in PATH')); return; }
        reject(err('git-failed', String(stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function saveSnapshotToRepo({ repoRoot, dataUrl, date = new Date(), git = defaultGit }) {
  const dir = path.join(repoRoot, SNAPSHOT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const buffer = decodePng(dataUrl);
  const file = uniqueName(dir, snapshotName(date));
  fs.writeFileSync(path.join(dir, file), buffer);
  const rel = `${SNAPSHOT_DIR}/${file}`;
  await git(repoRoot, ['add', '--', rel]);
  await git(repoRoot, ['commit', '-m', `snapshot: ${file}`, '--', rel]);
  await git(repoRoot, ['push', 'origin', 'HEAD']);
  return { file, rel };
}
