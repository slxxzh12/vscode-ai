import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskCleanCleaner } from '../disk-clean/clean.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-clean-')); }

function fakeScan(categories, customDirs = []) {
  return { id: 's1', startedAt: Date.now(), expired: false, customDirs, exclusions: { dirs: [], patterns: [] }, categories };
}

const cat = (id, risk = 'safe', needsAdmin = false) => ({ id, group: 'app', risk, needsAdmin, minAgeDays: 0, status: 'done', bytes: 1, files: 1, truncated: false });

test('clean：拒绝不属于该扫描的类别', () => {
  const dir = tmp();
  const c = createDiskCleanCleaner({ jobsDir: path.join(dir, 'jobs'), resolveTargets: () => [], appendHistory: () => {} });
  const r = c.start({ scan: fakeScan([cat('npm')]), categoryIds: ['nope'], permanent: false, confirmed: [] });
  assert.equal(r.error, 'bad_category');
});

test('clean：risky 类别必须逐项确认', () => {
  const dir = tmp();
  const c = createDiskCleanCleaner({ jobsDir: path.join(dir, 'jobs'), resolveTargets: () => [], appendHistory: () => {} });
  const r = c.start({ scan: fakeScan([cat('custom', 'risky')]), categoryIds: ['custom'], permanent: false, confirmed: [] });
  assert.equal(r.error, 'need_confirm');
});

test('clean：生成 job.json 与带 BOM 的 helper 拷贝，并注入 spawn', () => {
  const dir = tmp();
  const jobsDir = path.join(dir, 'jobs');
  const spawned = [];
  const c = createDiskCleanCleaner({
    jobsDir,
    helperPath: path.resolve('server/disk-clean/helper.ps1'),
    resolveTargets: () => [{ path: dir, mode: 'contents', minAgeDays: 0 }],
    appendHistory: () => {},
    spawnFn: (cmd, args) => { spawned.push({ cmd, args }); return { on: () => {}, exitCode: 0 }; },
  });
  const r = c.start({ scan: fakeScan([cat('npm')]), categoryIds: ['npm'], permanent: false, confirmed: [] });
  assert.ok(r.jobId);
  const jobFile = path.join(jobsDir, r.jobId, 'job.json');
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  assert.equal(job.mode, 'recycle');
  assert.equal(job.categories.length, 1);
  assert.ok(job.categories[0].targets.length >= 1);
  assert.equal(spawned.length, 1);
  assert.ok(fs.existsSync(spawned[0].args.at(-1)));
  const copy = fs.readFileSync(path.join(jobsDir, r.jobId, 'helper.ps1'));
  assert.deepEqual([...copy.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const st = c.get(r.jobId);
  assert.equal(st.status, 'running');
});

test('clean：读取 result.json', () => {
  const dir = tmp();
  const jobsDir = path.join(dir, 'jobs');
  const c = createDiskCleanCleaner({
    jobsDir,
    helperPath: path.resolve('server/disk-clean/helper.ps1'),
    resolveTargets: () => [],
    appendHistory: () => {},
    spawnFn: () => ({ on: () => {}, exitCode: 0 }),
  });
  const jobId = c.start({ scan: fakeScan([cat('npm')]), categoryIds: ['npm'], permanent: true, confirmed: [] }).jobId;
  fs.writeFileSync(path.join(jobsDir, jobId, 'result.json'), JSON.stringify({ status: 'done', removed: 2, bytes: 20, failed: [], skipped: 0, mode: 'permanent' }));
  const st = c.get(jobId);
  assert.equal(st.status, 'done');
  assert.equal(st.removed, 2);
  assert.equal(st.mode, 'permanent');
});
