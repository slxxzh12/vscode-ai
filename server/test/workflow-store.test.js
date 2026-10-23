import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowStore } from '../workflow-store.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-wfstore-')); }
function wf(id, label, prompts = ['p']) {
  return { id, label, stages: [{ id: 's', label: 'S', prompts }] };
}
function dirs(dir) { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(); }

test('writeAll 生成 工作流/小组/技能 目录，readAll 读回', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  const out = store.writeAll([wf('dev', '测试流', ['第一步', '第二步'])]);
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^100_测试流$/);
  assert.equal(out[0].label, '测试流');
  const wfDir = path.join(dir, '100_测试流');
  assert.ok(fs.existsSync(wfDir));
  const group = dirs(wfDir)[0];
  assert.match(group, /^100_S$/);
  const skillFiles = files(path.join(wfDir, group));
  assert.equal(skillFiles.length, 2);
  assert.match(skillFiles[0], /^100_/);
  assert.match(skillFiles[1], /^200_/);
  assert.equal(fs.readFileSync(path.join(wfDir, group, skillFiles[0]), 'utf8').trim(), '第一步');
  const again = store.readAll();
  assert.equal(again[0].stages[0].prompts[0], '第一步');
  assert.equal(again[0].stages[0].prompts[1], '第二步');
});

test('按文件夹数字前缀升序读取工作流/小组/技能', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('b', 'B'), wf('a', 'A'), wf('c', 'C', ['z', 'a'])]);
  const names = dirs(dir);
  assert.deepEqual(names, ['100_B', '200_A', '300_C']);
  assert.deepEqual(store.readAll().map((w) => w.label), ['B', 'A', 'C']);
  assert.deepEqual(store.readAll()[2].stages[0].prompts, ['z', 'a']);
});

test('writeAll 删除不再存在的工作流/小组/技能', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  const one = store.writeAll([wf('a', 'A', ['keep', 'remove'])])[0];
  const wfDir = path.join(dir, one.id);
  const groupDir = path.join(wfDir, one.stages[0].id);
  const oldSkill = files(groupDir).find((n) => n.includes('remove'));
  assert.ok(oldSkill);
  store.writeAll([{ id: one.id, label: 'A', stages: [{ id: one.stages[0].id, label: 'S', prompts: ['keep'] }] }]);
  assert.equal(files(groupDir).length, 1);
  store.writeAll([]);
  assert.deepEqual(dirs(dir), []);
});

test('迁移旧 XML 文件为文件夹并删除 XML', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'dev.xml'), '<workflow id="dev" label="D"><stage id="s" label="S"><prompt>p</prompt></stage></workflow>', 'utf8');
  const store = createWorkflowStore({ dir });
  assert.equal(files(dir).filter((n) => n.endsWith('.xml')).length, 0);
  const out = store.readAll();
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'D');
  assert.equal(out[0].stages[0].prompts[0], 'p');
});

test('tree/readFile 返回当前工作流的文件夹树和技能内容', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  const out = store.writeAll([wf('a', 'A', ['第一段'])])[0];
  const tree = store.tree(out.id);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, out.id);
  assert.equal(tree[0].children[0].name, out.stages[0].id);
  const file = tree[0].children[0].children[0];
  assert.match(file.name, /\.md$/);
  assert.equal(store.readFile(file.path).trim(), '第一段');
  assert.throws(() => store.readFile('../x.md'));
  assert.throws(() => store.readFile(file.path.replace(/\.md$/, '.js')));
});

test('migrateFromConfigXml 拆分 <workflows> 并从配置移除该段', () => {
  const dir = tmp();
  const cfg = path.join(tmp(), 'devflow.xml');
  const xml = '<?xml version="1.0"?>\n<devflow>\n  <server language="zh-CN" host="127.0.0.1" />\n  <agents default="opencode" />\n  <workflows>\n  <workflow id="dev" label="D"><stage id="s" label="S"><prompt>p</prompt></stage></workflow>\n  </workflows>\n</devflow>\n';
  fs.writeFileSync(cfg, xml, 'utf8');
  const store = createWorkflowStore({ dir, configFile: cfg });
  assert.equal(store.migrateFromConfigXml(), true);
  assert.equal(store.readAll()[0].label, 'D');
  assert.ok(dirs(dir).length > 0);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(!/<workflows\b/i.test(after));
  assert.ok(/<server\b/.test(after) && /<agents\b/.test(after));
});

test('目录已有文件夹时不迁移配置 XML', () => {
  const dir = tmp();
  const cfg = path.join(tmp(), 'devflow.xml');
  fs.writeFileSync(cfg, '<devflow><workflows><workflow id="x" label="X"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows></devflow>', 'utf8');
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('keep', 'K')]);
  assert.equal(store.migrateFromConfigXml(), false);
  assert.deepEqual(store.readAll().map((w) => w.label), ['K']);
});
