import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotName, decodePng, saveSnapshotToRepo, SNAPSHOT_DIR } from '../snapshot-store.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-snapshot-'));
}
function recordGit(record) {
  return async (repo, args) => { record.push(args); return ''; };
}

test('snapshotName 生成 devflow-YYYYMMDD-HHmmss.png', () => {
  assert.equal(snapshotName(new Date(2026, 8, 12, 9, 30, 5)), 'devflow-20260912-093005.png');
  assert.equal(snapshotName(new Date(2026, 0, 3, 0, 0, 0)), 'devflow-20260103-000000.png');
});

test('decodePng 接受合法 dataURL，拒绝非 PNG 或空', () => {
  const bytes = Buffer.from([137, 80, 78, 71]);
  const url = `data:image/png;base64,${bytes.toString('base64')}`;
  assert.deepEqual(decodePng(url), bytes);
  for (const bad of ['data:image/jpeg;base64,AAAA', 'data:image/png;base64,', '', null, 123]) {
    assert.throws(() => decodePng(bad), (e) => e.code === 'bad-image');
  }
});

test('saveSnapshotToRepo git 仓库下写盘并依次 git add/commit/push', async () => {
  const repo = tmp();
  const calls = [];
  const bytes = Buffer.from('PNGDATA');
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
  const r = await saveSnapshotToRepo({ repoRoot: repo, dataUrl, date: new Date(2026, 8, 12, 9, 30, 5), isGitRepo: () => true, git: recordGit(calls) });
  assert.equal(r.file, 'devflow-20260912-093005.png');
  assert.equal(r.rel, `${SNAPSHOT_DIR}/devflow-20260912-093005.png`);
  assert.equal(r.dir, path.join(repo, SNAPSHOT_DIR));
  assert.equal(r.uploaded, true);
  assert.equal(r.reason, '');
  const written = fs.readFileSync(path.join(repo, SNAPSHOT_DIR, r.file));
  assert.deepEqual(written, bytes);
  assert.deepEqual(calls, [
    ['add', '--', r.rel],
    ['commit', '-m', `snapshot: ${r.file}`, '--', r.rel],
    ['push', 'origin', 'HEAD'],
  ]);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('saveSnapshotToRepo 非 git 目录时跳过 git 但仍返回成功', async () => {
  const repo = tmp();
  let called = false;
  const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
  const r = await saveSnapshotToRepo({ repoRoot: repo, dataUrl, date: new Date(2026, 8, 12, 9, 30, 5), git: async () => { called = true; return ''; } });
  assert.equal(called, false);
  assert.equal(r.uploaded, false);
  assert.equal(r.reason, 'not-a-repo');
  assert.equal(r.dir, path.join(repo, SNAPSHOT_DIR));
  assert.ok(fs.existsSync(path.join(repo, SNAPSHOT_DIR, r.file)));
  fs.rmSync(repo, { recursive: true, force: true });
});

test('saveSnapshotToRepo 同秒重名追加 -1', async () => {
  const repo = tmp();
  const date = new Date(2026, 8, 12, 9, 30, 5);
  const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
  const git = async () => '';
  const a = await saveSnapshotToRepo({ repoRoot: repo, dataUrl, date, git });
  const b = await saveSnapshotToRepo({ repoRoot: repo, dataUrl, date, git });
  assert.equal(a.file, 'devflow-20260912-093005.png');
  assert.equal(b.file, 'devflow-20260912-093005-1.png');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('saveSnapshotToRepo git 失败时不抛错，标记 uploaded:false', async () => {
  const repo = tmp();
  const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
  const r = await saveSnapshotToRepo({ repoRoot: repo, dataUrl, date: new Date(2026, 8, 12, 9, 30, 5), isGitRepo: () => true, git: async () => { const e = new Error('push rejected'); e.code = 'git-failed'; throw e; } });
  assert.equal(r.uploaded, false);
  assert.equal(r.reason, 'git-failed');
  assert.ok(fs.existsSync(path.join(repo, SNAPSHOT_DIR, r.file)));
  fs.rmSync(repo, { recursive: true, force: true });
});
