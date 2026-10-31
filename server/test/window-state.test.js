import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeWindowState, createWindowState, MAX_TABS } from '../window-state.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfws-')), 'window-state.json');
}

test('normalizeWindowState 白名单校验 rail/historyTab/msgFilter', () => {
  assert.deepEqual(normalizeWindowState({ rail: 'history' }), { rail: 'history' });
  assert.deepEqual(normalizeWindowState({ rail: 'nope' }), {});
  assert.deepEqual(normalizeWindowState({ rail: 'mobile' }), {});          // 手机视图不持久化
  assert.deepEqual(normalizeWindowState({ rail: 'jobs' }), { rail: 'scheduler' }); // 旧 jobs 页签并入定时任务
  assert.deepEqual(normalizeWindowState({ historyTab: 'messages' }), { historyTab: 'messages' });
  assert.deepEqual(normalizeWindowState({ historyTab: 'other' }), {});
  assert.deepEqual(normalizeWindowState({ msgFilter: false }), { msgFilter: false });
  assert.deepEqual(normalizeWindowState({ msgFilter: 'yes' }), {});
  assert.deepEqual(normalizeWindowState({ nope: 1 }), {});                // 未知键丢弃
  assert.deepEqual(normalizeWindowState(null), {});
  assert.deepEqual(normalizeWindowState([]), {});
});

test('normalizeWindowState tabs 丢弃非法项、label 缺失用文件名、上限截断', () => {
  const out = normalizeWindowState({
    tabs: [
      { projectId: 'p1', path: 'src/a.ts', label: 'a.ts' },
      { projectId: 'p1', path: 'src\\b.ts' },                 // 缺 label → 反推文件名
      { projectId: 'p1' },                                     // 缺 path → 丢
      { path: 'x.ts' },                                        // 缺 projectId → 丢
      { projectId: '', path: 'y.ts' },                         // 空 projectId → 丢
      'nope', null, 42,
    ],
  });
  assert.deepEqual(out.tabs, [
    { projectId: 'p1', path: 'src/a.ts', label: 'a.ts' },
    { projectId: 'p1', path: 'src\\b.ts', label: 'b.ts' },
  ]);

  const many = Array.from({ length: MAX_TABS + 5 }, (_, i) => ({ projectId: 'p', path: `f${i}.ts`, label: `f${i}.ts` }));
  assert.equal(normalizeWindowState({ tabs: many }).tabs.length, MAX_TABS);
});

test('normalizeWindowState activeTab 只接受非空字符串或 null', () => {
  assert.deepEqual(normalizeWindowState({ activeTab: 'f:p1|a.ts' }), { activeTab: 'f:p1|a.ts' });
  assert.deepEqual(normalizeWindowState({ activeTab: null }), { activeTab: null });
  assert.deepEqual(normalizeWindowState({ activeTab: '' }), {});
  assert.deepEqual(normalizeWindowState({ activeTab: 7 }), {});
});

test('createWindowState 读写往返 + 坏文件回退空 + 无 file 纯内存', () => {
  const file = tmpFile();
  const store = createWindowState({ file });
  assert.deepEqual(store.read(), {});

  store.write({ rail: 'history', historyTab: 'messages', msgFilter: false, tabs: [{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }], activeTab: 'f:p1|a.ts' });
  assert.deepEqual(createWindowState({ file }).read(), {
    rail: 'history', historyTab: 'messages', msgFilter: false,
    tabs: [{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }], activeTab: 'f:p1|a.ts',
  });

  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createWindowState({ file }).read(), {});

  const mem = createWindowState({});
  mem.write({ msgFilter: false });
  assert.deepEqual(mem.read(), { msgFilter: false });
});
