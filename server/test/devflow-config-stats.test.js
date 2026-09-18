import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevflowConfig, serializeDevflowConfig, buildDefaultConfig } from '../devflow-config.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<devflow>
  <server language="zh-CN" host="127.0.0.1" />
  <agents default="opencode">
    <agent id="opencode" name="OpenCode" cmd="opencode" statsCmd="opencode stats --days {days}" />
    <agent id="nga" name="nga" cmd="nga.cmd" />
  </agents>
  <workflows></workflows>
</devflow>`;

test('parseDevflowConfig 解析 statsCmd（缺省不产生键）', () => {
  const cfg = parseDevflowConfig(XML);
  const oc = cfg.agents.list.find((a) => a.id === 'opencode');
  const nga = cfg.agents.list.find((a) => a.id === 'nga');
  assert.equal(oc.statsCmd, 'opencode stats --days {days}');
  assert.equal('statsCmd' in nga, false);
});

test('serializeDevflowConfig 原样回写 statsCmd', () => {
  const out = serializeDevflowConfig(parseDevflowConfig(XML));
  assert.ok(out.includes('statsCmd="opencode stats --days {days}"'));
  const back = parseDevflowConfig(out);
  assert.equal(back.agents.list.find((a) => a.id === 'opencode').statsCmd, 'opencode stats --days {days}');
});

test('无 statsCmd 的旧配置仍可解析与序列化', () => {
  const cfg = parseDevflowConfig('<devflow><agents default="opencode"><agent id="opencode" name="OpenCode" cmd="opencode" /></agents></devflow>');
  assert.equal(serializeDevflowConfig(cfg).includes('statsCmd'), false);
});

test('默认配置里 opencode / nga 带 statsCmd', () => {
  const list = buildDefaultConfig().agents.list;
  assert.equal(list.find((a) => a.id === 'opencode').statsCmd, 'opencode stats --days {days}');
  assert.equal(list.find((a) => a.id === 'nga').statsCmd, 'nga stats --days {days}');
});
