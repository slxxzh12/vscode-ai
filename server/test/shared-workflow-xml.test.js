import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowsXml, serializeWorkflowsFragment, serializeWorkflow, sortWorkflows, escXml, decode } from '@devflow/shared/workflow-xml';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const sample = [
  { id: 'dev', label: '开发工作流', stages: [
    { id: 'design', label: '需求设计', group: '需求', prompts: ['第一句', '第二句'] },
    { id: 'code', label: '代码实现', group: '开发交付', prompts: ['写代码'] },
    { id: 'plain', label: '无分组', group: '', prompts: [] },
  ] },
  { id: 'test', label: '测试工作流', stages: [
    { id: 'run', label: '执行验证', group: '', prompts: ['跑测试'] },
  ] },
];

test('shared: serialize → parse 往返深度相等', () => {
  const xml = serializeWorkflowsFragment(sample);
  assert.deepEqual(parseWorkflowsXml(xml), sample);
});

test('shared: 特殊字符与换行转义往返', () => {
  const tricky = [{ id: 'x&1', label: 'a<b>"c"', stages: [
    { id: 's\'1', label: 'l&l', group: 'g<1>', prompts: ['line1\nline2 & <tag> "q" \'a\''] },
  ] }];
  const xml = serializeWorkflowsFragment(tricky);
  assert.ok(xml.includes('&amp;') && xml.includes('&lt;') && xml.includes('&quot;'));
  assert.deepEqual(parseWorkflowsXml(xml), tricky);
});

test('shared: 空提示语被过滤', () => {
  const xml = '<workflows><workflow id="a" label="A"><stage id="s" label="S"><prompt>  </prompt><prompt>ok</prompt></stage></workflow></workflows>';
  assert.deepEqual(parseWorkflowsXml(xml)[0].stages[0].prompts, ['ok']);
});

test('shared: 无 stage 的 workflow 被丢弃', () => {
  const xml = '<workflows><workflow id="a" label="A"></workflow></workflows>';
  assert.deepEqual(parseWorkflowsXml(xml), []);
});

test('shared: 对整份 devflow.xml 解析得到期望工作流', () => {
  const full = fs.readFileSync(path.join(repoRoot, 'config', 'devflow.xml'), 'utf8');
  const wfs = parseWorkflowsXml(full);
  assert.equal(wfs[0].id, 'dev');
  assert.ok(wfs.some((w) => w.id === 'test'));
  assert.ok(wfs[0].stages.every((s) => s.id && s.label));
});

test('shared: escXml/decode 互逆', () => {
  const s = 'a&b<c>d"e\'f';
  assert.equal(decode(escXml(s)), s);
});

test('shared: serializeWorkflow 是 fragment 的子串', () => {
  const one = serializeWorkflow(sample[0]);
  assert.ok(serializeWorkflowsFragment([sample[0]]).includes(one));
});

test('shared: priority 解析与序列化（缺省不出现）', () => {
  const withP = '<workflows><workflow id="a" label="A" priority="7"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows>';
  const wfs = parseWorkflowsXml(withP);
  assert.equal(wfs[0].priority, 7);
  assert.ok(serializeWorkflow(wfs[0]).includes('priority="7"'));

  const noP = '<workflows><workflow id="b" label="B"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows>';
  const plain = parseWorkflowsXml(noP)[0];
  assert.equal('priority' in plain, false);
  assert.ok(!serializeWorkflow(plain).includes('priority='));
});

test('shared: priority 非法值归 0 且不输出', () => {
  const xml = '<workflows><workflow id="a" label="A" priority="abc"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows>';
  const wf = parseWorkflowsXml(xml)[0];
  assert.equal(wf.priority, 0);
  assert.ok(!serializeWorkflow(wf).includes('priority='));
});

test('shared: sortWorkflows 按 priority 降序、label 升序、id 升序', () => {
  const list = [
    { id: 'b', label: 'B', stages: [] },
    { id: 'a', label: 'A', stages: [] },
    { id: 'c', label: 'A', stages: [], priority: 5 },
    { id: 'd', label: 'C', stages: [], priority: 5 },
  ];
  assert.deepEqual(sortWorkflows(list).map((w) => w.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(list.map((w) => w.id), ['b', 'a', 'c', 'd']);
});
