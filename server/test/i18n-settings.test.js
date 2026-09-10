import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, writeSettings } from '../settings.js';
import { t, setLocale, getLocale } from '../i18n.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-')), 'server.json'); }

test('settings 默认 language=zh-CN', () => {
  assert.equal(readSettings(tmpFile()).language, 'zh-CN');
});

test('writeSettings 持久化 language；非法值读回回落默认', () => {
  const f = tmpFile();
  writeSettings(f, { language: 'en' });
  assert.equal(readSettings(f).language, 'en');
  fs.writeFileSync(f, JSON.stringify({ port: 3001, language: 'fr' }), 'utf8');
  assert.equal(readSettings(f).language, 'zh-CN');
});

test('writeSettings 合并保留 port', () => {
  const f = tmpFile();
  writeSettings(f, { port: 4000 });
  writeSettings(f, { language: 'en' });
  const s = readSettings(f);
  assert.equal(s.port, 4000);
  assert.equal(s.language, 'en');
});

test('server i18n：setLocale 切换并按语言翻译', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('nav.explorer'), 'Explorer');
  setLocale('zh-CN');
  assert.equal(t('nav.explorer'), '目录');
  setLocale('zh-TW');
  assert.equal(getLocale(), 'zh-CN', 'zh 方言归一为 zh-CN');
});
