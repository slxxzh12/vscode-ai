import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDevflowConfig, updateServerAttrs } from '../devflow-config.js';
import { t, setLocale, getLocale } from '../i18n.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devcfg-lang-')), 'devflow.xml'); }

test('devflow.xml 默认 language=zh-CN', () => {
  assert.equal(loadDevflowConfig(tmpFile()).server.language, 'zh-CN');
});

test('updateServerAttrs 持久化 language 并可按 port 合并', () => {
  const f = tmpFile();
  updateServerAttrs(f, { language: 'en' });
  assert.equal(loadDevflowConfig(f).server.language, 'en');
  updateServerAttrs(f, { port: 4100 });
  const s = loadDevflowConfig(f).server;
  assert.equal(s.port, 4100);
  assert.equal(s.language, 'en', '改 port 不丢 language');
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
