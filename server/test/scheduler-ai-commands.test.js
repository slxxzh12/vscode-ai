import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listAiCommands, readAiCommand } from '../scheduler/ai-commands.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-ai-')); }

test('listAiCommands 列出 .md 并提取预览', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'command'), { recursive: true });
  fs.writeFileSync(path.join(root, 'command', 'review.md'), '---\ndesc: x\n---\n请评审这段代码');
  fs.writeFileSync(path.join(root, 'command', 'notes.txt'), 'ignore');
  const list = listAiCommands({ configRoot: root });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'review.md');
  assert.match(list[0].preview, /请评审/);
});

test('listAiCommands 目录不存在返回空数组', () => {
  assert.deepEqual(listAiCommands({ configRoot: tmpDir() }), []);
});

test('readAiCommand 读取正文；非法名抛错', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'command'), { recursive: true });
  fs.writeFileSync(path.join(root, 'command', 'a.md'), 'BODY');
  assert.equal(readAiCommand('a.md', { configRoot: root }), 'BODY');
  assert.throws(() => readAiCommand('../secret', { configRoot: root }), /bad name|unsafe name/);
});
