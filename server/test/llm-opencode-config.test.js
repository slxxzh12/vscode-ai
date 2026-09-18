import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readActiveConfig, validateManaged, normalizeProviderKeys, mergeAndWrite } from '../llm-opencode-config.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfocc-')); }

test('readActiveConfig 读 opencode.json，缺文件返回空配置', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ model: 'a/m', provider: { a: { options: { baseURL: 'https://a/v1', apiKey: 'K' } } } }));
  const r = readActiveConfig({ dir });
  assert.equal(r.format, 'json');
  assert.equal(r.exists, true);
  assert.equal(r.config.model, 'a/m');
  assert.equal(r.config.provider.a.options.apiKey, 'K');
  assert.match(r.path, /opencode\.json$/);

  const empty = readActiveConfig({ dir: tmpDir() });
  assert.equal(empty.exists, false);
  assert.equal(empty.format, null);
  assert.deepEqual(empty.config, {});
});

test('readActiveConfig 读 .jsonc 去注释，坏文件 config=null', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.jsonc'), '{ // note\n "provider": { "a": {} } }');
  const r = readActiveConfig({ dir });
  assert.equal(r.format, 'jsonc');
  assert.deepEqual(Object.keys(r.config.provider), ['a']);

  const bad = tmpDir();
  fs.writeFileSync(path.join(bad, 'opencode.json'), '{ not json');
  assert.equal(readActiveConfig({ dir: bad }).config, null);
});

test('normalizeProviderKeys：0 删、1 apiKey、N apiKeys 去重', () => {
  assert.deepEqual(normalizeProviderKeys({ options: { baseURL: 'x', apiKey: '' } }).options, { baseURL: 'x' });
  assert.deepEqual(normalizeProviderKeys({ options: { baseURL: 'x', apiKey: 'K' } }).options, { baseURL: 'x', apiKey: 'K' });
  assert.deepEqual(normalizeProviderKeys({ options: { apiKeys: ['A', 'B', 'A'] } }).options, { apiKeys: ['A', 'B'] });
  assert.equal(normalizeProviderKeys({}).options, undefined);
});

test('validateManaged 拒绝非法结构（bad-config）', () => {
  assert.throws(() => validateManaged({ provider: 'x', model: '' }), (e) => e.code === 'bad-config');
  assert.throws(() => validateManaged({ provider: { a: { models: { m: 1 } } }, model: '' }), (e) => e.code === 'bad-config');
  assert.throws(() => validateManaged({ provider: { a: { options: { apiKeys: 'K' } } }, model: '' }), (e) => e.code === 'bad-config');
  assert.throws(() => validateManaged({ provider: {}, model: 5 }), (e) => e.code === 'bad-config');
  assert.doesNotThrow(() => validateManaged({ provider: { a: { options: { baseURL: 'x', apiKeys: ['K'] }, models: { m: {} } } }, model: 'a/m' }));
});

test('mergeAndWrite 只替换 provider/model，保留其余顶层键并补 $schema', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ agent: { a: {} }, provider: { old: {} }, model: 'old/m', $schema: 'X' }));
  const r = mergeAndWrite({ dir, provider: { a: { options: { baseURL: 'https://a/v1', apiKey: 'K' }, models: { m1: {} } } }, model: 'a/m1', now: new Date('2026-09-18T10:20:30') });
  const saved = JSON.parse(fs.readFileSync(r.path, 'utf8'));
  assert.deepEqual(saved.agent, { a: {} });
  assert.equal(saved.$schema, 'X');
  assert.deepEqual(Object.keys(saved.provider), ['a']);
  assert.equal(saved.model, 'a/m1');
  assert.deepEqual(r.backups.map((b) => path.basename(b)), ['opencode.20260918-102030.bak']);
  assert.equal(fs.existsSync(path.join(dir, 'opencode.json.tmp')), false);
});

test('mergeAndWrite 转换 .jsonc：改名备份后写 opencode.json', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.jsonc'), '{ "provider": { "a": {} } }');
  mergeAndWrite({ dir, provider: {}, model: '', now: new Date('2026-09-18T10:20:30') });
  assert.equal(fs.existsSync(path.join(dir, 'opencode.jsonc')), false);
  assert.equal(fs.existsSync(path.join(dir, 'opencode.jsonc.20260918-102030.bak')), true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
  assert.equal(saved.$schema, 'https://opencode.ai/config.json');
  assert.equal('model' in saved, false);
  assert.deepEqual(saved.provider, {});
});

test('mergeAndWrite 坏文件拒绝（bad-existing）', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{ broken');
  assert.throws(() => mergeAndWrite({ dir, provider: {}, model: '' }), (e) => e.code === 'bad-existing');
});

test('mergeAndWrite 无文件时新建', () => {
  const dir = tmpDir();
  const r = mergeAndWrite({ dir, provider: { a: { models: { m: {} } } }, model: 'a/m' });
  assert.equal(fs.existsSync(r.path), true);
  assert.deepEqual(r.backups, []);
  assert.equal(JSON.parse(fs.readFileSync(r.path, 'utf8')).model, 'a/m');
});
