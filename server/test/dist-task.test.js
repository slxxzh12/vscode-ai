import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distKindsOf, distTypeOf, distUrl, shouldProcess, downloadAddrOf } from '../collaboration/dist-task.js';

test('distKindsOf：技能类资产任一非空 → skills；workflow 非空 → workflow', () => {
  assert.deepEqual(distKindsOf({ skills: ['a'] }), ['skills']);
  assert.deepEqual(distKindsOf({ command: ['x'] }), ['skills']);
  assert.deepEqual(distKindsOf({ agent: ['y'] }), ['skills']);
  assert.deepEqual(distKindsOf({ workflow: [{ id: 'w', label: 'W' }] }), ['workflow']);
  assert.deepEqual(distKindsOf({ skills: ['a'], workflow: [{ id: 'w', label: 'W' }] }), ['skills', 'workflow']);
  assert.deepEqual(distKindsOf({}), []);
  assert.deepEqual(distKindsOf(null), []);
});

test('distTypeOf：单类给单类，两类给 mixed，空给 skills（兜底文案）', () => {
  assert.equal(distTypeOf({ skills: ['a'] }), 'skills');
  assert.equal(distTypeOf({ workflow: [{ id: 'w', label: 'W' }] }), 'workflow');
  assert.equal(distTypeOf({ skills: ['a'], workflow: [{ id: 'w', label: 'W' }] }), 'mixed');
  assert.equal(distTypeOf({}), 'skills');
});

test('distUrl：整段编码（名字含 / 时编码成单段，路由切分后再解码）', () => {
  assert.equal(
    distUrl('192.168.1.9', 22222, 'skills/abc-assets.zip'),
    'http://192.168.1.9:22222/api/collab/downloads/file/skills%2Fabc-assets.zip',
  );
});

test('shouldProcess：大于游标 ts 处理；小于跳过；同 ts 只有同 id 才跳过', () => {
  const cur = { lastTs: 100, lastId: 'm2' };
  assert.equal(shouldProcess(cur, { ts: 101, id: 'm3' }), true);
  assert.equal(shouldProcess(cur, { ts: 100, id: 'm9' }), true);
  assert.equal(shouldProcess(cur, { ts: 100, id: 'm2' }), false);
  assert.equal(shouldProcess(cur, { ts: 99, id: 'm0' }), false);
  assert.equal(shouldProcess(null, { ts: 1, id: 'a' }), true);
});

test('downloadAddrOf：解析 http(s) 主机端口；默认端口；非法返回 null', () => {
  assert.deepEqual(
    downloadAddrOf('http://192.168.16.142:22222/api/collab/downloads/file/skills%2Fa.zip'),
    { host: '192.168.16.142', port: 22222 },
  );
  assert.deepEqual(downloadAddrOf('https://hub.local/x'), { host: 'hub.local', port: 443 });
  assert.deepEqual(downloadAddrOf('http://hub.local/x'), { host: 'hub.local', port: 80 });
  for (const bad of ['', null, 'ftp://h/x', 'not a url', 'file:///x']) {
    assert.equal(downloadAddrOf(bad), null, `expected null for ${bad}`);
  }
});
