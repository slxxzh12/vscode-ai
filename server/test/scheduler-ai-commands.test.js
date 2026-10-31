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

test('listAiCommands 合并 opencode 配置 command 块（jsonc 带注释），按 name 排序去重', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'command'), { recursive: true });
  fs.writeFileSync(path.join(root, 'command', 'review.md'), '---\ndesc: x\n---\n评审');
  fs.writeFileSync(path.join(root, 'opencode.jsonc'), [
    '{',
    '  // 注释',
    '  "command": {',
    '    "code-review": { "description": "Review code" },',
    '    "verify": { "description": "Run verification loop" }',
    '  }',
    '}',
  ].join('\n'));
  const list = listAiCommands({ configRoot: root });
  assert.deepEqual(list.map((c) => c.name), ['code-review', 'review.md', 'verify']);
  assert.equal(list.find((c) => c.name === 'code-review').preview, 'Review code');
});

test('listAiCommands 只有 opencode.json 时也能列出', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'opencode.json'), JSON.stringify({ command: { alpha: { description: 'A' } } }));
  assert.deepEqual(listAiCommands({ configRoot: root }).map((c) => c.name), ['alpha']);
});

test('listAiCommands 配置损坏时忽略配置，不影响文件命令', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'command'), { recursive: true });
  fs.writeFileSync(path.join(root, 'command', 'a.md'), 'BODY');
  fs.writeFileSync(path.join(root, 'opencode.jsonc'), '{ not json');
  assert.deepEqual(listAiCommands({ configRoot: root }).map((c) => c.name), ['a.md']);
});

test('readAiCommand 读取正文；非法名抛错', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'command'), { recursive: true });
  fs.writeFileSync(path.join(root, 'command', 'a.md'), 'BODY');
  assert.equal(readAiCommand('a.md', { configRoot: root }), 'BODY');
  assert.throws(() => readAiCommand('../secret', { configRoot: root }), /bad name|unsafe name/);
});
