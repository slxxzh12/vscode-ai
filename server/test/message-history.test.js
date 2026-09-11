import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonc, readHistory, writeHistory, appendHistory } from '../message-history.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-history-'));
  return path.join(dir, 'message-history.jsonc');
}

test('parseJsonc 支持注释与尾随逗号', () => {
  const text = `// head\n{\n  "messages": [\n    "a", // inline\n    /* block */ "b",\n  ],\n}\n`;
  assert.deepEqual(parseJsonc(text), { messages: ['a', 'b'] });
});

test('空文件返回空数组', () => {
  assert.deepEqual(readHistory(tmpFile()), []);
});

test('写入后可读回，且落盘为 jsonc（含注释）', () => {
  const f = tmpFile();
  writeHistory(f, ['一', '二']);
  const raw = fs.readFileSync(f, 'utf8');
  assert.ok(raw.startsWith('//'));
  assert.deepEqual(readHistory(f).map((x) => x.text), ['一', '二']);
});

test('appendHistory 置顶、去重、过滤非字符串', () => {
  const f = tmpFile();
  appendHistory(f, 'a');
  appendHistory(f, 'b');
  appendHistory(f, 'a');            // 去重后置顶
  assert.deepEqual(readHistory(f).map((x) => x.text), ['a', 'b']);
  assert.ok(readHistory(f)[0].ts > 0);
  appendHistory(f, '   ');          // 空串忽略
  assert.deepEqual(readHistory(f).map((x) => x.text), ['a', 'b']);
});

test('writeHistory 只保留字符串并裁剪上限', () => {
  const f = tmpFile();
  writeHistory(f, ['x', 1, null, 'y'], 1);
  assert.deepEqual(readHistory(f).map((x) => x.text), ['x']);
});

test('readHistory 兼容旧版纯字符串并补 ts=0', () => {
  const f = tmpFile();
  writeHistory(f, ['legacy1', 'legacy2']);
  fs.writeFileSync(f, '// head\n["legacy1","legacy2"]\n', 'utf8');
  assert.deepEqual(readHistory(f), [{ text: 'legacy1', ts: 0 }, { text: 'legacy2', ts: 0 }]);
});
