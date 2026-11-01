import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowStore, readWorkflowsDir } from '../workflow-store.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-wfstore-')); }
function wf(id, label, stages) {
  return {
    id, label,
    stages: stages || [{ id: 's', label: 'S', group: '默认', prompts: ['p'] }],
  };
}
function dirs(dir) { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(); }

test('writeAll 生成 工作流/小组/阶段/技能 目录，readAll 读回', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  const out = store.writeAll([wf('dev', '测试流', [
    { id: 's1', label: '基础', group: '需求', prompts: ['第一步', '第二步'] },
    { id: 's2', label: '代码', group: '开发交付', prompts: ['写代码'] },
  ])]);
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^100_测试流$/);
  assert.equal(out[0].label, '测试流');
  assert.deepEqual(out[0].stages.map((s) => s.group), ['需求', '开发交付']);
  const wfDir = path.join(dir, '100_测试流');
  assert.deepEqual(dirs(wfDir), ['100_需求', '200_开发交付']);
  const groupDir = path.join(wfDir, '100_需求');
  assert.deepEqual(dirs(groupDir), ['100_基础']);
  const skillFiles = files(path.join(groupDir, '100_基础'));
  assert.equal(skillFiles.length, 2);
  assert.match(skillFiles[0], /^100_/);
  assert.match(skillFiles[1], /^200_/);
  assert.equal(fs.readFileSync(path.join(groupDir, '100_基础', skillFiles[0]), 'utf8').trim(), '第一步');
  const again = store.readAll();
  assert.equal(again[0].stages[0].label, '基础');
  assert.equal(again[0].stages[0].group, '需求');
  assert.equal(again[0].stages[0].prompts[1], '第二步');
});

test('同一个 group 下的多个阶段放在同一个小组文件夹', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('a', 'A', [
    { id: 's1', label: 'S1', group: 'G', prompts: ['p1'] },
    { id: 's2', label: 'S2', group: 'G', prompts: ['p2'] },
  ])]);
  const wfDir = path.join(dir, dirs(dir)[0]);
  assert.deepEqual(dirs(wfDir), ['100_G']);
  assert.deepEqual(dirs(path.join(wfDir, '100_G')), ['100_S1', '200_S2']);
  assert.deepEqual(store.readAll()[0].stages.map((s) => s.label), ['S1', 'S2']);
});

test('按文件夹数字前缀升序读取工作流/小组/阶段/技能', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([
    wf('b', 'B', [{ id: 's', label: 'S', group: 'G', prompts: ['z', 'a'] }]),
    wf('a', 'A', [{ id: 's', label: 'S', group: 'G', prompts: ['p'] }]),
    wf('c', 'C', [{ id: 's', label: 'S', group: 'G', prompts: ['p'] }]),
  ]);
  assert.deepEqual(dirs(dir), ['100_B', '200_A', '300_C']);
  assert.deepEqual(store.readAll().map((w) => w.label), ['B', 'A', 'C']);
  assert.deepEqual(store.readAll()[0].stages[0].prompts, ['z', 'a']);
});

test('writeAll 删除不再存在的工作流/小组/阶段/技能', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  const one = store.writeAll([wf('a', 'A', [{ id: 's', label: 'S', group: 'G', prompts: ['keep', 'remove'] }])])[0];
  const wfDir = path.join(dir, one.id);
  const groupDir = path.join(wfDir, '100_G');
  const stageDir = path.join(groupDir, '100_S');
  assert.ok(files(stageDir).some((n) => n.includes('remove')));
  store.writeAll([{ id: one.id, label: 'A', stages: [{ id: one.stages[0].id, label: 'S', group: 'G', prompts: ['keep'] }] }]);
  assert.equal(files(stageDir).length, 1);
  store.writeAll([{ id: one.id, label: 'A', stages: [] }]);
  assert.deepEqual(dirs(wfDir), []);
});

test('迁移旧 XML 文件为四层文件夹并删除 XML', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'dev.xml'), '<workflow id="dev" label="D"><stage id="s" label="S" group="需求"><prompt>p</prompt></stage></workflow>', 'utf8');
  const store = createWorkflowStore({ dir });
  assert.equal(files(dir).filter((n) => n.endsWith('.xml')).length, 0);
  const out = store.readAll();
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'D');
  assert.equal(out[0].stages[0].group, '需求');
  assert.equal(out[0].stages[0].prompts[0], 'p');
});

test('旧三层目录自动迁移为默认小组', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '100_W', '100_S'), { recursive: true });
  fs.writeFileSync(path.join(dir, '100_W', '100_S', '100_p.md'), 'p', 'utf8');
  const store = createWorkflowStore({ dir });
  const wfDir = path.join(dir, '100_W');
  const groups = dirs(wfDir);
  assert.equal(groups.length, 1);
  assert.match(groups[0], /^100_/);
  assert.ok(dirs(path.join(wfDir, groups[0])).length === 1);
  assert.equal(store.readAll()[0].stages[0].prompts[0], 'p');
});

test('migrateFromConfigXml 拆分 <workflows> 并从配置移除该段', () => {
  const dir = tmp();
  const cfg = path.join(tmp(), 'devflow.xml');
  const xml = '<?xml version="1.0"?>\n<devflow>\n  <server language="zh-CN" host="127.0.0.1" />\n  <agents default="opencode" />\n  <workflows>\n  <workflow id="dev" label="D"><stage id="s" label="S" group="需求"><prompt>p</prompt></stage></workflow>\n  </workflows>\n</devflow>\n';
  fs.writeFileSync(cfg, xml, 'utf8');
  const store = createWorkflowStore({ dir, configFile: cfg });
  assert.equal(store.migrateFromConfigXml(), true);
  assert.equal(store.readAll()[0].stages[0].group, '需求');
  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(!/<workflows\b/i.test(after));
  assert.ok(/<server\b/.test(after) && /<agents\b/.test(after));
});

test('tree/readFile 返回四层文件夹树和技能内容', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  const out = store.writeAll([wf('a', 'A', [{ id: 's', label: 'S', group: 'G', prompts: ['第一段'] }])])[0];
  const tree = store.tree(out.id);
  assert.equal(tree.length, 1);
  const group = tree[0].children[0];
  const stage = group.children[0];
  const file = stage.children[0];
  assert.match(file.name, /\.md$/);
  assert.equal(tree[0].abs, path.join(dir, out.id));
  assert.equal(file.abs, path.join(dir, file.path));
  assert.equal(store.absPath(file.path), file.abs);
  assert.equal(store.readFile(file.path).trim(), '第一段');
  assert.throws(() => store.readFile('../x.md'));
  assert.throws(() => store.absPath('../x'));
  assert.throws(() => store.readFile(file.path.replace(/\.md$/, '.js')));
});

test('deleteFile 直接删除技能文件，拒绝非 md/穿越/不存在', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  const out = store.writeAll([wf('a', 'A', [{ id: 's', label: 'S', group: 'G', prompts: ['p1', 'p2'] }])])[0];
  const tree = store.tree(out.id);
  const file = tree[0].children[0].children[0].children[0];
  const abs = path.join(dir, file.path);
  assert.ok(fs.existsSync(abs));
  store.deleteFile(file.path);
  assert.equal(fs.existsSync(abs), false);
  assert.equal(store.readAll()[0].stages[0].prompts.length, 1);
  assert.throws(() => store.deleteFile('../x.md'));
  assert.throws(() => store.deleteFile(file.path.replace(/\.md$/, '.js')));
  assert.throws(() => store.deleteFile(file.path));
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

test('moveFile：技能文件可移动到其他阶段目录，路径越界被拒绝', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  const out = store.writeAll([wf('a', 'A', [
    { id: 's1', label: 'S1', group: 'G', prompts: ['p1'] },
    { id: 's2', label: 'S2', group: 'G', prompts: ['p2'] },
  ])]);
  const wfName = out[0].id;
  const groupName = dirs(path.join(dir, wfName))[0];
  const stages = dirs(path.join(dir, wfName, groupName));
  const srcFile = files(path.join(dir, wfName, groupName, stages[0]))[0];
  const from = `${wfName}/${groupName}/${stages[0]}/${srcFile}`;
  const to = `${wfName}/${groupName}/${stages[1]}/moved.md`;
  store.moveFile(from, to);
  assert.equal(store.readAll()[0].stages.find((s) => s.label === 'S2').prompts.length, 2);
  assert.throws(() => store.moveFile(to, '../x.md'), /bad-path/);
});

test('seedDir：同名工作流只解压一次，新增工作流会补入', () => {
  const seed = tmp();
  const seedStore = createWorkflowStore({ dir: seed });
  seedStore.writeAll([wf('a', 'A', [{ id: 's', label: 'S', group: 'G', prompts: ['原始'] }])]);

  const dir = tmp();
  const first = createWorkflowStore({ dir, seedDir: seed });
  assert.deepEqual(first.readAll().map((w) => w.label), ['A']);

  first.writeAll([wf('a', 'A', [{ id: 's', label: 'S', group: 'G', prompts: ['已改'] }])]);
  seedStore.writeAll([
    wf('a', 'A', [{ id: 's', label: 'S', group: 'G', prompts: ['原始'] }]),
    wf('b', 'B', [{ id: 's', label: 'S', group: 'G', prompts: ['新增'] }]),
  ]);

  const again = createWorkflowStore({ dir, seedDir: seed });
  const out = again.readAll();
  assert.deepEqual(out.map((w) => w.label).sort(), ['A', 'B']);
  assert.equal(out.filter((w) => w.label === 'A').length, 1);
  assert.equal(out.find((w) => w.label === 'A').stages[0].prompts[0], '已改');
  assert.equal(out.find((w) => w.label === 'B').stages[0].prompts[0], '新增');
});

test('readWorkflowsDir 只读扫描 .void/workflows，不写盘不迁移', () => {
  const root = tmp();
  const base = path.join(root, '.void', 'workflows');
  const writer = createWorkflowStore({ dir: base });
  writer.writeAll([wf('local', 'Local', [{ id: 's', label: 'Stage', group: 'Group', prompts: ['hello'] }])]);
  const before = fs.readdirSync(root).sort().join(',');
  const list = readWorkflowsDir(base);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Local');
  assert.deepEqual(list[0].stages[0].prompts, ['hello']);
  assert.equal(fs.readdirSync(root).sort().join(','), before);
});

test('seed:false 不把默认工作流复制进目标目录（编辑器操作 .void 时用）', () => {
  const seed = tmp();
  createWorkflowStore({ dir: seed }).writeAll([wf('a', 'A')]);
  const dir = tmp();
  createWorkflowStore({ dir, seedDir: seed, seed: false });
  assert.deepEqual(createWorkflowStore({ dir }).readAll().map((w) => w.label), []);
});
