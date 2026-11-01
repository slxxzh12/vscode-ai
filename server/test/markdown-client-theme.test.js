import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mermaidInitOptions } from '../../shared/markdown-client.js';

const PINK_PURPLE = /#(8b5cf6|a855f7|d946ef|ec4899|f472b6)/i;

test('mermaid 深色主题使用蓝色科技配色且无粉紫', () => {
  const opt = mermaidInitOptions('dark');
  assert.equal(opt.theme, 'dark');
  assert.equal(opt.securityLevel, 'strict');
  assert.equal(opt.themeVariables.primaryColor, '#0f2a4d');
  assert.equal(opt.themeVariables.primaryBorderColor, '#3b82f6');
  assert.equal(opt.themeVariables.pie1, '#1d4ed8');
  assert.doesNotMatch(JSON.stringify(opt.themeVariables), PINK_PURPLE);
});

test('mermaid 浅色主题同样为蓝色系', () => {
  const opt = mermaidInitOptions('default');
  assert.equal(opt.themeVariables.primaryColor, '#dbeafe');
  assert.equal(opt.themeVariables.lineColor, '#2563eb');
  assert.doesNotMatch(JSON.stringify(opt.themeVariables), PINK_PURPLE);
});

test('mermaid 图表布局紧凑（横竖排间距收紧）', () => {
  const opt = mermaidInitOptions('dark');
  assert.equal(opt.flowchart.nodeSpacing, 24);
  assert.equal(opt.flowchart.rankSpacing, 24);
  assert.equal(opt.flowchart.useMaxWidth, true);
  assert.equal(opt.sequence.useMaxWidth, true);
  assert.equal(opt.pie.useMaxWidth, true);
});
