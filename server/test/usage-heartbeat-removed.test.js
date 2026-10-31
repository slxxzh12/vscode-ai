import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CollabPeer } from '@devflow/shared/collab';

test('旧的签名信封常量已删除', () => {
  assert.equal(CollabPeer.STATS, undefined);
  assert.equal(CollabPeer.HEARTBEAT, undefined);
});

test('旧的 heartbeat 模块与测试文件已删除', () => {
  const root = path.join(import.meta.dirname, '..');
  assert.equal(fs.existsSync(path.join(root, 'collaboration', 'heartbeat.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'test', 'heartbeat.test.js')), false);
});
