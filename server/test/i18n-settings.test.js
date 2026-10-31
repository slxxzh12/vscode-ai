import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDevflowConfig, updateServerAttrs } from '../devflow-config.js';
import { t, setLocale, getLocale } from '../i18n.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devcfg-lang-')), 'devflow.xml'); }

test('devflow.xml 缺失时 language 跟随机器语言', () => {
  assert.ok(['zh-CN', 'en'].includes(loadDevflowConfig(tmpFile()).server.language));
});

test('updateServerAttrs 持久化 language 且不影响 host', () => {
  const f = tmpFile();
  updateServerAttrs(f, { language: 'en' });
  assert.equal(loadDevflowConfig(f).server.language, 'en');
  updateServerAttrs(f, { host: '0.0.0.0' });
  const s = loadDevflowConfig(f).server;
  assert.equal(s.host, '0.0.0.0');
  assert.equal(s.language, 'en', '改 host 不丢 language');
});

test('server i18n：setLocale 切换并按语言翻译', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('nav.explorer'), 'Explorer');
  setLocale('zh-CN');
  assert.equal(t('nav.explorer'), '目录');
  setLocale('zh-TW');
  assert.equal(getLocale(), 'zh-CN');
});
