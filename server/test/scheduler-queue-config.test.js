import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQueueConfig } from '../scheduler/queue/config.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qcfg-')); }

test('没有配置时默认 SQLite', () => {
  const c = createQueueConfig({ dir: tmp() });
  assert.equal(c.get().backend, 'sqlite');
  assert.equal(c.publicConfig().hasPassword, false);
});

test('保存 MySQL 后密码不回传且可解密', () => {
  const dir = tmp();
  const c = createQueueConfig({ dir });
  const r = c.save({ host: '127.0.0.1', port: 3306, user: 'root', password: 'p@ss', database: 'devflow' });
  assert.equal(r.ok, true);
  const pub = c.publicConfig();
  assert.equal(pub.backend, 'mysql');
  assert.equal(pub.hasPassword, true);
  assert.equal(pub.password, undefined);
  assert.equal(c.openPassword(), 'p@ss');
  assert.equal(fs.readFileSync(c.file, 'utf8').includes('p@ss'), false);
  const reopened = createQueueConfig({ dir });
  assert.equal(reopened.openPassword(), 'p@ss');
});

test('密码 undefined 保留旧密码，空串清除', () => {
  const dir = tmp();
  const c = createQueueConfig({ dir });
  c.save({ host: 'h', user: 'u', password: 'old', database: 'd' });
  c.save({ host: 'h2', user: 'u', database: 'd' });
  assert.equal(c.openPassword(), 'old');
  c.save({ host: 'h2', user: 'u', password: '', database: 'd' });
  assert.equal(c.openPassword(), '');
});
