import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowXml, loadWorkflowXml, defaultWorkflowFile } from '../workflow-xml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('parseWorkflowXml 解析多工作流/多阶段/多提示语', () => {
  const xml = `<?xml version="1.0"?>
  <workflows>
    <workflow id="dev" label="开发工作流">
      <stage id="design" label="需求设计"><prompt>A</prompt><prompt>B &amp; C</prompt></stage>
      <stage id="code" label="代码实现"><prompt>实现</prompt></stage>
    </workflow>
    <workflow id="doc" label="文档工作流">
      <stage id="scan" label="盘点"><prompt>盘点文档</prompt></stage>
    </workflow>
  </workflows>`;
  const wfs = parseWorkflowXml(xml);
  assert.equal(wfs.length, 2);
  assert.equal(wfs[0].id, 'dev');
  assert.equal(wfs[0].stages.length, 2);
  assert.deepEqual(wfs[0].stages[0].prompts, ['A', 'B & C']);
  assert.equal(wfs[1].id, 'doc');
  assert.equal(wfs[1].stages[0].label, '盘点');
});

test('仓库 config/workflow.xml 可解析出 开发/测试/文档 三个工作流且阶段均有提示语', () => {
  const file = defaultWorkflowFile(path.join(__dirname, '..', '..'));
  const wfs = loadWorkflowXml(file);
  const ids = wfs.map((w) => w.id);
  assert.ok(ids.includes('dev') && ids.includes('test') && ids.includes('doc'), `ids=${ids.join(',')}`);
  for (const w of wfs) {
    assert.ok(w.stages.length > 0, `${w.id} 无阶段`);
    for (const s of w.stages) assert.ok(s.prompts.length > 0, `${w.id}/${s.id} 无提示语`);
  }
});

test('配置缺失时回退内置工作流', () => {
  const wfs = loadWorkflowXml(path.join(__dirname, 'no-such-file.xml'));
  assert.ok(wfs.length >= 1);
});
