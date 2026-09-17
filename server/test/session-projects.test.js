import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeSessionProjects, createSessionProjects, MAX_SESSIONS } from '../session-projects.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfsp-')), 'session-projects.json');
}

test('normalizeSessionProjects 只留非空字符串键值', () => {
  assert.deepEqual(normalizeSessionProjects({ a: 'p1', b: '', c: 1, d: null, e: 'p2' }), { a: 'p1', e: 'p2' });
  assert.deepEqual(normalizeSessionProjects(null), {});
  assert.deepEqual(normalizeSessionProjects('x'), {});
  assert.deepEqual(normalizeSessionProjects([]), {});
});

test('normalizeSessionProjects 超过上限淘汰最旧', () => {
  const src = {};
  for (let i = 0; i < MAX_SESSIONS + 5; i++) src[`k${i}`] = `p${i}`;
  const out = normalizeSessionProjects(src);
  assert.equal(Object.keys(out).length, MAX_SESSIONS);
  assert.equal(out.k0, undefined);
  assert.equal(out.k4, undefined);
  assert.equal(out[`k${MAX_SESSIONS + 4}`], `p${MAX_SESSIONS + 4}`);
});

test('record 幂等、空值跳过、读写往返', () => {
  const file = tmpFile();
  const store = createSessionProjects({ file });
  assert.deepEqual(store.read(), {});

  store.record('s_1', 'p1');
  assert.deepEqual(store.read(), { s_1: 'p1' });
  store.record('s_1', 'p1');                 // 幂等
  assert.deepEqual(store.read(), { s_1: 'p1' });

  store.record('s_2', null);
  store.record(null, 'p1');
  store.record('', 'p1');
  store.record('s_3', '');
  assert.deepEqual(store.read(), { s_1: 'p1' });

  assert.deepEqual(createSessionProjects({ file }).read(), { s_1: 'p1' });   // 落盘可回读
});

test('record 超过上限时淘汰最旧', () => {
  const file = tmpFile();
  const store = createSessionProjects({ file });
  for (let i = 0; i < MAX_SESSIONS + 3; i++) store.record(`s${i}`, `p${i}`);
  const out = store.read();
  assert.equal(Object.keys(out).length, MAX_SESSIONS);
  assert.equal(out.s0, undefined);
  assert.equal(out[`s${MAX_SESSIONS + 2}`], `p${MAX_SESSIONS + 2}`);
});

test('坏文件回退空 + 无 file 时纯内存', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createSessionProjects({ file }).read(), {});

  const mem = createSessionProjects({});
  mem.record('s_1', 'p1');
  assert.deepEqual(mem.read(), { s_1: 'p1' });
});
