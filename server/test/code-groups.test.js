import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeGroups, createCodeGroups, emptyGroups } from '../code-groups.js';

test('normalizeGroups 去空/去重/截断组名/丢弃非法成员', () => {
  const r = normalizeGroups({
    groups: ['A组', ' A组 ', '', 'x'.repeat(50), 'B组'],
    members: { 张三: 'A组', 李四: 'C组', '': 'A组', 王五: 'B组' },
  });
  assert.deepEqual(r.groups, ['A组', 'x'.repeat(40), 'B组']);
  assert.deepEqual(r.members, { 张三: 'A组', 王五: 'B组' });
});

test('normalizeGroups 非法输入 → 空', () => {
  assert.deepEqual(normalizeGroups(null), emptyGroups());
  assert.deepEqual(normalizeGroups('x'), emptyGroups());
  assert.deepEqual(normalizeGroups({ groups: 'x', members: [] }), emptyGroups());
});

test('createCodeGroups 读写往返 + 坏文件回退空', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfgrp-')), 'code-groups.json');
  const store = createCodeGroups({ file });
  assert.deepEqual(store.read(), emptyGroups());
  store.write({ groups: ['A组'], members: { 张三: 'A组' } });
  assert.deepEqual(createCodeGroups({ file }).read(), { groups: ['A组'], members: { 张三: 'A组' } });

  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createCodeGroups({ file }).read(), emptyGroups());
});

test('createCodeGroups 无 file 时纯内存', () => {
  const store = createCodeGroups({});
  store.write({ groups: ['A组'], members: {} });
  assert.deepEqual(store.read(), { groups: ['A组'], members: {} });
});
