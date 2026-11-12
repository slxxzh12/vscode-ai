import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocUpdateStore, selectedDocDirs, DOC_SLOTS } from '../doc-update-store.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-doc-update-'));
  return path.join(dir, 'doc-update.json');
}

test('doc-update-store：默认 7 个槽位为空且未勾选', () => {
  const file = tmpFile();
  const store = createDocUpdateStore({ file });
  const s = store.read();
  assert.deepEqual([...DOC_SLOTS], ['code', 'knowledge', 'solution', 'workflow', 'experience', 'skills', 'rules']);
  assert.deepEqual(Object.keys(s), [...DOC_SLOTS]);
  for (const slot of DOC_SLOTS) assert.deepEqual(s[slot], { path: '', selected: false });
});

test('doc-update-store：写入后读回，非法项被归一化', () => {
  const file = tmpFile();
  const store = createDocUpdateStore({ file });
  store.write({
    code: { path: 'D:\\code', selected: true },
    knowledge: { path: 'D:\\kb', selected: true },
    solution: { path: 123, selected: 'yes' },
    workflow: null,
  });
  const s = store.read();
  assert.deepEqual(s.code, { path: 'D:\\code', selected: true });
  assert.deepEqual(s.knowledge, { path: 'D:\\kb', selected: true });
  assert.deepEqual(s.solution, { path: '', selected: false });
  assert.deepEqual(s.workflow, { path: '', selected: false });
});

test('selectedDocDirs：只取勾选且非空路径，去重', () => {
  const s = {
    code: { path: 'D:\\code', selected: true },
    knowledge: { path: 'D:\\kb', selected: true },
    solution: { path: 'D:\\kb', selected: true },
    workflow: { path: 'D:\\wf', selected: false },
  };
  assert.deepEqual(selectedDocDirs(s), ['D:\\code', 'D:\\kb']);
});
