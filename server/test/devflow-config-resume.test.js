import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevflowConfig, serializeDevflowConfig } from '../devflow-config.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<devflow>
  <server language="zh-CN" host="127.0.0.1" />
  <agents default="opencode">
    <agent id="opencode" name="OpenCode" cmd="opencode" />
    <agent id="claudecode" name="ClaudeCode" cmd="claudecode" resumeCmd="claudecode --resume {id}" resumeDiscover="win-claude-last-id" />
  </agents>
  <workflows></workflows>
</devflow>`;

test('parseDevflowConfig 解析 resumeCmd / resumeDiscover（缺省不产生键）', () => {
  const cfg = parseDevflowConfig(XML);
  const oc = cfg.agents.list.find((a) => a.id === 'opencode');
  const cc = cfg.agents.list.find((a) => a.id === 'claudecode');
  assert.equal('resumeCmd' in oc, false);
  assert.equal('resumeDiscover' in oc, false);
  assert.equal(cc.resumeCmd, 'claudecode --resume {id}');
  assert.equal(cc.resumeDiscover, 'win-claude-last-id');
});

test('serializeDevflowConfig 原样回写 resume 属性', () => {
  const cfg = parseDevflowConfig(XML);
  const out = serializeDevflowConfig(cfg);
  assert.ok(out.includes('resumeCmd="claudecode --resume {id}"'));
  assert.ok(out.includes('resumeDiscover="win-claude-last-id"'));
  const back = parseDevflowConfig(out);
  assert.equal(back.agents.list.find((a) => a.id === 'claudecode').resumeCmd, 'claudecode --resume {id}');
});

test('无 resume 属性的旧配置仍可解析与序列化', () => {
  const cfg = parseDevflowConfig('<devflow><agents default="opencode"><agent id="opencode" name="OpenCode" cmd="opencode" /></agents></devflow>');
  const out = serializeDevflowConfig(cfg);
  assert.equal(out.includes('resumeCmd'), false);
});

test('parseDevflowConfig 解析 resume="opencode"（缺省不产生键）并回写', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<devflow>
  <agents default="nga">
    <agent id="opencode" name="OpenCode" cmd="opencode" />
    <agent id="nga" name="nga" cmd="nga" resume="opencode" />
  </agents>
</devflow>`;
  const cfg = parseDevflowConfig(xml);
  assert.equal('resume' in cfg.agents.list.find((a) => a.id === 'opencode'), false);
  assert.equal(cfg.agents.list.find((a) => a.id === 'nga').resume, 'opencode');
  const out = serializeDevflowConfig(cfg);
  assert.ok(out.includes('id="nga" name="nga" cmd="nga" resume="opencode"'));
  assert.equal(parseDevflowConfig(out).agents.list.find((a) => a.id === 'nga').resume, 'opencode');
});
