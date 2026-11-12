import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPlugins, readPlugin, readLogo, resolvePluginPath } from '../ai-site/plugins.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-plugins-'));
  const p = path.join(root, 'translate');
  fs.mkdirSync(path.join(p, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(p, 'manifest.json'), JSON.stringify({
    name: '翻译助手', description: '翻译文本', logo: 'logo.png', workflow: 'workflow/prompt.md',
    fields: [
      { key: 'text', label: '文本', type: 'textarea', required: true },
      { key: 'lang', label: '语言', type: 'select', options: ['中文', '英文'] },
      { key: 'bad', label: '坏', type: 'file' },
      { key: 'bad2', label: '坏2', type: 'bogus' },
    ],
  }));
  fs.writeFileSync(path.join(p, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(p, 'workflow', 'prompt.md'), '# go');
  return root;
}

test('plugins：扫描/解析/忽略非法字段', () => {
  const root = setup();
  const items = listPlugins(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'translate');
  assert.equal(items[0].title, '翻译助手');
  assert.equal(items[0].hasLogo, true);
  assert.deepEqual(items[0].fields.map((f) => f.key), ['text', 'lang']);
  assert.equal(items[0].fields[1].type, 'select');
  assert.deepEqual(items[0].fields[1].options, ['中文', '英文']);
  assert.equal(items[0].error, null);
});

test('plugins：缺 manifest 的目录跳过', () => {
  const root = setup();
  fs.mkdirSync(path.join(root, 'empty'));
  assert.equal(listPlugins(root).length, 1);
});

test('plugins：路径穿越拒绝', () => {
  const root = setup();
  assert.throws(() => resolvePluginPath(root, 'translate', '../x'), (e) => e.code === 'bad-path');
  assert.throws(() => resolvePluginPath(root, 'translate', '/abs'), (e) => e.code === 'bad-path');
  assert.throws(() => readPlugin(root, '../translate'), (e) => e.code === 'not-found');
  const logo = readLogo(root, 'translate');
  assert.equal(logo.contentType, 'image/png');
  assert.equal(logo.data.length, 4);
});
