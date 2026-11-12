import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSiteConfigStore, normalizeConfig } from '../ai-site/config-store.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-cfg-')), 'ai-site', 'config.json');
}

test('config：默认值 + sessionSecret 生成且稳定', () => {
  const file = tmpFile();
  const s = createAiSiteConfigStore({ file });
  const c = s.get();
  assert.equal(c.mode, 'port');
  assert.equal(c.listenPort, 22300);
  assert.equal(c.pathPrefix, '/ai');
  assert.equal(c.enabled, false);
  assert.equal(c.requireAuth, true);
  assert.match(c.sessionSecret, /^[0-9a-f]{48}$/);
  const again = createAiSiteConfigStore({ file: tmpFile() });
  assert.equal(again.get().requireAuth, true);
  const s2 = createAiSiteConfigStore({ file });
  assert.equal(s2.get().sessionSecret, c.sessionSecret);
});

test('config：端口/路径校验', () => {
  const s = createAiSiteConfigStore({ file: tmpFile() });
  assert.throws(() => s.save({ mode: 'bad' }), (e) => e.code === 'bad-request');
  assert.throws(() => s.save({ mode: 'port', listenPort: 0 }), (e) => e.code === 'bad-request');
  assert.throws(() => s.save({ mode: 'path', pathPrefix: 'ai' }), (e) => e.code === 'bad-request');
  assert.throws(() => s.save({ mode: 'path', pathPrefix: '/ai/' }), (e) => e.code === 'bad-request');
  assert.throws(() => s.save({ mode: 'path', pathPrefix: '/api' }), (e) => e.code === 'bad-request');
  const c = s.save({ mode: 'path', pathPrefix: '/ai', enabled: true });
  assert.equal(c.mode, 'path');
  assert.equal(c.pathPrefix, '/ai');
  assert.equal(c.enabled, true);
});

test('config：插件根目录必须存在，前缀冲突拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-root-'));
  const s = createAiSiteConfigStore({ file: tmpFile(), isPrefixTaken: (p) => p === '/taken' });
  assert.equal(normalizeConfig({ pluginRoot: dir }).pluginRoot, path.resolve(dir));
  assert.throws(() => s.save({ pluginRoot: path.join(dir, 'nope') }), (e) => e.code === 'bad-static-dir');
  assert.throws(() => s.save({ mode: 'path', pathPrefix: '/taken' }), (e) => e.code === 'bad-request');
});

test('config：默认 pluginRoot 随应用走，不写入配置文件', () => {
  const def = path.join(os.tmpdir(), 'df-aisite-default-plugins');
  const file = tmpFile();
  const s = createAiSiteConfigStore({ file, defaultPluginRoot: def });
  assert.equal(s.get().pluginRoot, path.resolve(def));
  assert.equal(s.get().pluginRootDefault, true);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.pluginRoot, '');
  assert.equal(raw.pluginRootDefault, true);
});

test('config：用户自定义 pluginRoot 才保存；换应用默认目录不影响', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-custom-'));
  const custom = path.join(root, 'my-plugins');
  fs.mkdirSync(custom, { recursive: true });
  const file = tmpFile();
  const s = createAiSiteConfigStore({ file, defaultPluginRoot: path.join(root, 'demo_plugins') });
  assert.equal(s.save({ pluginRoot: custom }).pluginRoot, path.resolve(custom));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pluginRoot, path.resolve(custom));
  const next = createAiSiteConfigStore({ file, defaultPluginRoot: path.join(root, 'another-app', 'demo_plugins') });
  assert.equal(next.get().pluginRoot, path.resolve(custom));
  assert.equal(next.get().pluginRootDefault, false);
  assert.equal(next.save({ pluginRoot: '', pluginRootDefault: true }).pluginRoot, path.join(root, 'another-app', 'demo_plugins'));
});

test('config：旧配置写死的 demo_plugins 路径迁移为默认目录', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pluginRoot: path.join(os.tmpdir(), 'old-app', 'demo_plugins') }), 'utf8');
  const def = path.join(os.tmpdir(), 'new-app', 'demo_plugins');
  const s = createAiSiteConfigStore({ file, defaultPluginRoot: def });
  assert.equal(s.get().pluginRoot, def);
  assert.equal(s.get().pluginRootDefault, true);
});
