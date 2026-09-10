import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseDevflowConfig, serializeDevflowConfig,
  loadDevflowConfig, ensureConfigFile, updateServerAttrs, buildDefaultConfig,
} from '../devflow-config.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devcfg-')), 'devflow.xml'); }

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
  assert.equal(c.server.port, 4123);
  assert.equal(c.server.language, 'en');
  assert.equal(c.agents.default, 'nga');
  assert.deepEqual(c.agents.list.map((a) => a.id), ['opencode', 'nga']);
  assert.equal(c.workflows.length, 1);
  assert.equal(c.workflows[0].id, 'dev');
  assert.deepEqual(c.workflows[0].stages[0].prompts, ['p1', 'p2']);
});

test('parseDevflowConfig 非法/缺失回落默认', () => {
  const c = parseDevflowConfig('<devflow><server port="abc" language="fr"/></devflow>');
  assert.equal(c.server.port, buildDefaultConfig().server.port);
  assert.equal(c.server.language, 'zh-CN');
  assert.equal(c.agents.default, 'opencode');
});

test('serialize → parse 往返一致', () => {
  const cfg = buildDefaultConfig();
  const xml = serializeDevflowConfig(cfg);
  const back = parseDevflowConfig(xml);
  assert.equal(back.server.port, cfg.server.port);
  assert.deepEqual(back.agents.list.map((a) => a.id), cfg.agents.list.map((a) => a.id));
  assert.equal(back.workflows[0].id, cfg.workflows[0].id);
});

test('ensureConfigFile 缺失时生成默认，二次不覆盖', () => {
  const f = tmpFile();
  assert.equal(ensureConfigFile(f), true);
  assert.equal(fs.existsSync(f), true);
  assert.equal(ensureConfigFile(f), false);
});

test('updateServerAttrs 就地改属性并保留注释', () => {
  const f = tmpFile();
  fs.writeFileSync(f, SAMPLE, 'utf8');
  const next = updateServerAttrs(f, { port: 5000, language: 'zh-CN' });
  assert.deepEqual(next, { port: 5000, language: 'zh-CN' });
  const xml = fs.readFileSync(f, 'utf8');
  assert.match(xml, /<server port="5000" language="zh-CN" \/>/);
  assert.ok(xml.includes('<!-- keep me -->'), '注释保留');
  assert.ok(xml.includes('nga.cmd'), '其余内容保留');
});

test('loadDevflowConfig 文件缺失返回默认', () => {
  const c = loadDevflowConfig(tmpFile());
  assert.equal(c.server.port, buildDefaultConfig().server.port);
  assert.ok(c.agents.list.length >= 1);
});
