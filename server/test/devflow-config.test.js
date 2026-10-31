import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseDevflowConfig, serializeDevflowConfig,
  loadDevflowConfig, ensureConfigFile, updateServerAttrs, buildDefaultConfig,
  validateWorkflows, updateWorkflows, resolveActiveConfigFile,
  updateAgentsDefault, setDefaultAgent,
} from '../devflow-config.js';
import { createWorkflowSeedStore } from '../workflow-seed.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devcfg-')), 'devflow.xml'); }
function tmpSeedStore() { return createWorkflowSeedStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devcfg-')), 'void.db'), logger: { warn() {} } }); }

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- keep me -->
<devflow>
  <server port="4123" language="en" />
  <agents default="nga">
    <agent id="opencode" name="OpenCode" cmd="opencode" />
    <agent id="nga" name="nga" cmd="nga.cmd" />
  </agents>
  <workflows>
    <workflow id="dev" label="Dev">
      <stage id="design" label="Design" group="G"><prompt>p1</prompt><prompt>p2</prompt></stage>
    </workflow>
  </workflows>
</devflow>`;

test('parseDevflowConfig 解析 server/agents/workflows', () => {
  const c = parseDevflowConfig(SAMPLE);
  assert.equal(c.server.language, 'en');
  assert.equal(c.server.port, undefined, '端口不再来自 XML');
  assert.equal(c.agents.default, 'nga');
  assert.deepEqual(c.agents.list.map((a) => a.id), ['opencode', 'nga']);
  assert.equal(c.workflows.length, 1);
  assert.equal(c.workflows[0].id, 'dev');
  assert.deepEqual(c.workflows[0].stages[0].prompts, ['p1', 'p2']);
});

test('parseDevflowConfig 非法/缺失回落英文', () => {
  const c = parseDevflowConfig('<devflow><server port="abc" language="fr"/></devflow>');
  assert.equal(c.server.language, 'en');
  assert.equal(c.agents.default, 'opencode');
});

test('parseDevflowConfig language="auto" 跟随机器语言', () => {
  const c = parseDevflowConfig('<devflow><server language="auto" /></devflow>');
  assert.ok(['zh-CN', 'en'].includes(c.server.language));
});

test('serialize → parse 往返一致', () => {
  const cfg = buildDefaultConfig();
  const xml = serializeDevflowConfig(cfg);
  const back = parseDevflowConfig(xml);
  assert.deepEqual(back.agents.list.map((a) => a.id), cfg.agents.list.map((a) => a.id));
  assert.equal(back.workflows[0].id, cfg.workflows[0].id);
});

test('ensureConfigFile 缺失时生成默认，二次不覆盖', () => {
  const f = tmpFile();
  assert.equal(ensureConfigFile(f), true);
  assert.equal(fs.existsSync(f), true);
  assert.equal(ensureConfigFile(f), false);
});

test('updateServerAttrs 只写 language/host，不再写 port，且保留注释', () => {
  const f = tmpFile();
  fs.writeFileSync(f, SAMPLE, 'utf8');
  const next = updateServerAttrs(f, { language: 'zh-CN', host: '0.0.0.0' });
  assert.deepEqual(next, { language: 'zh-CN', host: '0.0.0.0' });
  const xml = fs.readFileSync(f, 'utf8');
  assert.doesNotMatch(xml, /<server[^>]*\bport=/, 'XML 不应再写 port 属性');
  assert.match(xml, /<server language="zh-CN" host="0\.0\.0\.0" \/>/);
  assert.ok(xml.includes('<!-- keep me -->'), '注释保留');
  assert.ok(xml.includes('nga.cmd'), '其余内容保留');
});

test('loadDevflowConfig 文件缺失返回默认（语言跟随机器）', () => {
  const c = loadDevflowConfig(tmpFile());
  assert.ok(['zh-CN', 'en'].includes(c.server.language));
  assert.ok(c.agents.list.length >= 1);
});

test('validateWorkflows 规整字段并过滤空提示语', () => {
  const out = validateWorkflows([
    { id: 'dev', label: '开发', stages: [{ id: 's1', label: '阶段', group: 'g', prompts: ['a', '  ', 'b'] }] },
  ]);
  assert.equal(out[0].id, 'dev');
  assert.equal(out[0].stages[0].prompts.length, 2);
});

test('validateWorkflows 非数组抛错', () => {
  assert.throws(() => validateWorkflows(null), /array/);
});

test('updateWorkflows 覆盖 <workflows> 且保留 server/agents', () => {
  const f = tmpFile();
  ensureConfigFile(f);
  updateServerAttrs(f, { language: 'en' });
  const saved = updateWorkflows(f, [
    { id: 'doc', label: '文档流', stages: [{ id: 'scan', label: '盘点', prompts: ['请盘点'] }] },
  ]);
  assert.equal(saved.length, 1);
  const c = loadDevflowConfig(f);
  assert.equal(c.server.language, 'en');
  assert.equal(c.workflows[0].id, 'doc');
  assert.ok(c.agents.list.some((a) => a.id === 'opencode'));
});

function withDataHome(fn) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-data-'));
  const prev = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = data;
  try { return fn(data); }
  finally {
    if (prev === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prev;
  }
}

test('resolveActiveConfigFile 首次从模板复制到 ports/<端口>/downloads', () => {
  withDataHome((data) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-root-'));
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'devflow.xml'), SAMPLE, 'utf8');
    const active = resolveActiveConfigFile(root, 22222);
    assert.equal(active, path.join(data, 'ports', '22222', 'downloads', 'devflow.xml'));
    assert.equal(fs.readFileSync(active, 'utf8'), SAMPLE);
  });
});

test('resolveActiveConfigFile 已存在则不覆盖', () => {
  withDataHome(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-root-'));
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'devflow.xml'), SAMPLE, 'utf8');
    const first = resolveActiveConfigFile(root, 22222);
    fs.writeFileSync(first, '<devflow><server port="9999" language="en"/></devflow>', 'utf8');
    const second = resolveActiveConfigFile(root, 22222);
    assert.equal(second, first);
    assert.match(fs.readFileSync(second, 'utf8'), /port="9999"/);
  });
});

test('resolveActiveConfigFile 模板缺失写入内置默认', () => {
  withDataHome(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-root-'));
    const active = resolveActiveConfigFile(root, 22222);
    const c = loadDevflowConfig(active);
    assert.equal(c.agents.list.length, buildDefaultConfig().agents.list.length);
    assert.ok(c.workflows.length >= 1);
  });
});

test('resolveActiveConfigFile 目录不可创建时抛错', () => {
  withDataHome((data) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-root-'));
    fs.mkdirSync(path.join(data, 'ports'), { recursive: true });
    fs.writeFileSync(path.join(data, 'ports', '22222'), 'not-a-dir', 'utf8');   // 占位成文件 → mkdir 失败
    assert.throws(() => resolveActiveConfigFile(root, 22222));
  });
});

test('updateWorkflows 刷新工作流种子并在内容变化时递增 version', () => {
  const f = tmpFile();
  const seed = tmpSeedStore();
  ensureConfigFile(f);
  updateWorkflows(f, [{ id: 'w1', label: 'W1', stages: [{ id: 's', label: 'S', prompts: ['p'] }] }], seed);
  const s1 = seed.read();
  assert.equal(s1.version, 1);
  assert.ok(s1.workflows.some((w) => w.id === 'w1'));
  updateWorkflows(f, [{ id: 'w1', label: 'W1x', stages: [{ id: 's', label: 'S', prompts: ['p'] }] }], seed);
  assert.equal(seed.read().version, 2);
  seed.close();
});

test('parse/serialize 支持 agent skillsDir 属性', () => {
  const xml = `<devflow>
  <agents default="nga">
    <agent id="nga" name="nga" cmd="nga.cmd" skillsDir="/opt/nga/skills" />
  </agents>
</devflow>`;
  const c = parseDevflowConfig(xml);
  assert.equal(c.agents.list[0].skillsDir, '/opt/nga/skills');
  const out = serializeDevflowConfig({ ...buildDefaultConfig(), agents: c.agents });
  assert.match(out, /skillsDir="\/opt\/nga\/skills"/);
  const back = parseDevflowConfig(out);
  assert.equal(back.agents.list[0].skillsDir, '/opt/nga/skills');
});

test('serialize 未配置 skillsDir 时不输出该属性', () => {
  const out = serializeDevflowConfig(buildDefaultConfig());
  assert.doesNotMatch(out, /skillsDir=/);
});

test('parseDevflowConfig 解析 agents chosen（缺省 false / chosen="1" 为 true）', () => {
  assert.equal(parseDevflowConfig(SAMPLE).agents.chosen, false);
  const c = parseDevflowConfig('<devflow><agents default="opencode" chosen="1"><agent id="opencode" name="OpenCode" cmd="opencode" /></agents></devflow>');
  assert.equal(c.agents.chosen, true);
});

test('serializeDevflowConfig 仅 chosen=true 时输出 chosen 属性', () => {
  assert.doesNotMatch(serializeDevflowConfig(buildDefaultConfig()), /chosen=/);
  const cfg = buildDefaultConfig();
  const out = serializeDevflowConfig({ ...cfg, agents: { default: 'opencode', list: cfg.agents.list, chosen: true } });
  assert.match(out, /<agents default="opencode" chosen="1">/);
  assert.equal(parseDevflowConfig(out).agents.chosen, true);
});

test('updateAgentsDefault 改写 default/chosen 且保留其余内容', () => {
  const f = tmpFile();
  fs.writeFileSync(f, SAMPLE, 'utf8');
  const r = updateAgentsDefault(f, 'opencode');
  assert.deepEqual(r, { default: 'opencode', chosen: true });
  const xml = fs.readFileSync(f, 'utf8');
  assert.match(xml, /<agents default="opencode" chosen="1">/);
  assert.ok(xml.includes('<!-- keep me -->'), '注释保留');
  assert.ok(xml.includes('<workflow id="dev"'), '工作流保留');
  const c = parseDevflowConfig(xml);
  assert.equal(c.agents.default, 'opencode');
  assert.equal(c.agents.chosen, true);
  assert.deepEqual(c.agents.list.map((a) => a.id), ['opencode', 'nga'], 'agent 列表保留');
});

test('setDefaultAgent 校验未知 id 抛 bad-agent，合法则写盘', () => {
  const f = tmpFile();
  fs.writeFileSync(f, SAMPLE, 'utf8');
  assert.equal(setDefaultAgent(f, 'nga').default, 'nga');
  assert.equal(parseDevflowConfig(fs.readFileSync(f, 'utf8')).agents.chosen, true);
  assert.throws(() => setDefaultAgent(f, 'nope'), (e) => e.code === 'bad-agent');
});

test('validateWorkflows 透传非 0 priority（0/缺失不产生键）', () => {
  const out = validateWorkflows([
    { id: 'a', label: 'A', priority: 3, stages: [{ id: 's', label: 'S', prompts: ['p'] }] },
    { id: 'b', label: 'B', priority: 0, stages: [{ id: 's', label: 'S', prompts: ['p'] }] },
    { id: 'c', label: 'C', stages: [{ id: 's', label: 'S', prompts: ['p'] }] },
  ]);
  assert.equal(out[0].priority, 3);
  assert.equal('priority' in out[1], false);
  assert.equal('priority' in out[2], false);
});
