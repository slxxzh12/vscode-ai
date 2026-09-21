import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowStore, safeWorkflowFile } from '../workflow-store.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-wfstore-')); }
const wf = (id, label, priority) => ({ id, label, ...(priority ? { priority } : {}), stages: [{ id: 's', label: 'S', prompts: ['p'] }] });

test('safeWorkflowFile 净化非法字符并防穿越', () => {
  assert.equal(safeWorkflowFile('dev'), 'dev.xml');
  assert.equal(safeWorkflowFile('a/b\\c'), 'a_b_c.xml');
  assert.ok(!safeWorkflowFile('..').includes('/'));
  assert.ok(!safeWorkflowFile('..').includes('\\'));
});

test('writeAll 落盘为单文件，readAll 读回并按 priority 排序', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('b', 'B', 0), wf('a', 'A', 5)]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.xml', 'b.xml']);
  const out = store.readAll();
  assert.deepEqual(out.map((w) => w.id), ['a', 'b']);
  assert.equal(out[0].priority, 5);
});

test('writeAll 删除不再存在的文件', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('a', 'A'), wf('b', 'B')]);
  store.writeAll([wf('a', 'A')]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.xml']);
  assert.deepEqual(store.readAll().map((w) => w.id), ['a']);
});

test('单文件损坏被跳过，其余照常', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('a', 'A')]);
  fs.writeFileSync(path.join(dir, 'broken.xml'), '<workflow', 'utf8');
  assert.deepEqual(store.readAll().map((w) => w.id), ['a']);
});

test('同 id 重复文件：按文件名后者覆盖并告警', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir, logger: { warn() {} } });
  fs.writeFileSync(path.join(dir, '1.xml'), '<workflow id="dup" label="First"><stage id="s" label="S"><prompt>p</prompt></stage></workflow>', 'utf8');
  fs.writeFileSync(path.join(dir, '2.xml'), '<workflow id="dup" label="Second"><stage id="s" label="S"><prompt>p</prompt></stage></workflow>', 'utf8');
  const out = store.readAll();
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'Second');
});

test('migrateFromConfigXml 拆分 <workflows> 并从配置移除该段', () => {
  const dir = tmp();
  const cfg = path.join(tmp(), 'devflow.xml');
  const xml = '<?xml version="1.0"?>\n<devflow>\n  <server language="zh-CN" host="127.0.0.1" />\n  <agents default="opencode" />\n  <workflows>\n  <workflow id="dev" label="D"><stage id="s" label="S"><prompt>p</prompt></stage></workflow>\n  </workflows>\n</devflow>\n';
  fs.writeFileSync(cfg, xml, 'utf8');
  const store = createWorkflowStore({ dir, configFile: cfg });
  assert.equal(store.migrateFromConfigXml(), true);
  assert.deepEqual(store.readAll().map((w) => w.id), ['dev']);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(!/<workflows\b/i.test(after));
  assert.ok(/<server\b/.test(after) && /<agents\b/.test(after));
});

test('migrateFromConfigXml 目录已有文件时不迁移', () => {
  const dir = tmp();
  const cfg = path.join(tmp(), 'devflow.xml');
  fs.writeFileSync(cfg, '<devflow><workflows><workflow id="x" label="X"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows></devflow>', 'utf8');
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('keep', 'K')]);
  assert.equal(store.migrateFromConfigXml(), false);
  assert.deepEqual(store.readAll().map((w) => w.id), ['keep']);
});
