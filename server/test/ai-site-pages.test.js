import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../i18n.js';
import { loginPage, listPage, formPage, runPage } from '../ai-site/pages.js';

const PLUGIN = {
  name: 'translate', title: '翻译助手', description: '翻译文本', logo: 'logo.png', hasLogo: true,
  fields: [
    { key: 'text', label: '文本', type: 'textarea', required: true },
    { key: 'lang', label: '语言', type: 'select', options: ['中文', '英文'] },
    { key: 'n', label: '数量', type: 'number', min: 1, max: 9 },
  ],
};

test('pages：登录页只需 JWT token 字段', () => {
  setLocale('zh-CN');
  const html = loginPage({ base: '/ai' });
  assert.match(html, /<form[^>]+action="\/ai\/__login"/);
  assert.match(html, /name="token"/);
  assert.doesNotMatch(html, /name="username"/);
});

test('pages：列表页展示 logo/name/description 与链接', () => {
  const html = listPage({ base: '', plugins: [PLUGIN], authenticated: true });
  assert.match(html, /翻译助手/);
  assert.match(html, /翻译文本/);
  assert.match(html, /href="\/p\/translate"/);
  assert.match(html, /__assets\/logo\/translate/);
});

test('pages：表单页按字段类型渲染', () => {
  const html = formPage({ base: '/ai', plugin: PLUGIN });
  assert.match(html, /<textarea[^>]+name="text"[^>]*required/);
  assert.match(html, /<select[^>]+name="lang"/);
  assert.match(html, /<option value="中文"/);
  assert.match(html, /<input[^>]+type="number"[^>]+name="n"/);
  assert.match(html, /\/__api\/run/);
  assert.match(html, /\/__run\//);
});

test('pages：执行终端页轮询运行状态并渲染输出', () => {
  const html = runPage({ base: '/ai', runId: 'r1' });
  assert.match(html, /\/__api\/runs\//);
  assert.match(html, /id="term"/);
  assert.match(html, /rundot/);
});
