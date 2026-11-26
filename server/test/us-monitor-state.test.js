import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, commit, git } from './helpers/git-fixture.js';
import {
  docHeadOf, readMonitorState, writeMonitorState, changedUsSince, MONITOR_FILE,
} from '../pipeline/us-monitor-state.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-monitor-'));
}

test('us-monitor-state：写入/读取监控时间戳与提交', () => {
  const dir = tmpDir();
  const now = new Date('2026-11-25T12:00:00Z');
  const s = writeMonitorState(dir, { now, commit: 'abc123' });
  assert.equal(s.lastCommit, 'abc123');
  assert.equal(s.lastRunAt, '2026-11-25T12:00:00.000Z');
  assert.equal(s.lastRunMs, now.getTime());
  const read = readMonitorState(dir);
  assert.equal(read.lastCommit, 'abc123');
  assert.equal(read.lastRunMs, now.getTime());
  assert.equal(fs.existsSync(path.join(dir, MONITOR_FILE)), true);
  assert.equal(readMonitorState(path.join(dir, 'missing')), null);
});

test('us-monitor-state：docHeadOf 返回当前 HEAD，非仓库返回空', async () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  commit(repo, 'c0');
  assert.equal(await docHeadOf(repo), git(repo, ['rev-parse', 'HEAD']).trim());
  assert.equal(await docHeadOf(tmpDir()), '');
});

test('us-monitor-state：按提交先后列出变更的方案目录', async () => {
  const repo = makeRepo();
  const flat = 'US000001-2021-A';
  fs.mkdirSync(path.join(repo, flat));
  fs.writeFileSync(path.join(repo, flat, 'x.md'), '1');
  commit(repo, 'c0');
  const base = git(repo, ['rev-parse', 'HEAD']).trim();

  const nested = 'F0001-用户管理/US000002-2022-B';
  fs.mkdirSync(path.join(repo, 'F0001-用户管理', 'US000002-2022-B'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'F0001-用户管理', 'US000002-2022-B', 'x.md'), '1');
  commit(repo, 'c1');

  fs.writeFileSync(path.join(repo, flat, 'x.md'), '2');
  commit(repo, 'c2');

  assert.deepEqual(await changedUsSince(repo, base), [nested, flat]);

  // 无关文件不算
  fs.writeFileSync(path.join(repo, 'README.md'), 'x');
  commit(repo, 'c3');
  assert.deepEqual(await changedUsSince(repo, base), [nested, flat]);
});
