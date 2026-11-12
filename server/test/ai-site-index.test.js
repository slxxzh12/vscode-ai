import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSite } from '../ai-site/index.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-index-'));
  const pluginRoot = path.join(root, 'plugins');
  fs.mkdirSync(path.join(pluginRoot, 'p1'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'p1', 'manifest.json'), JSON.stringify({ name: 'P1', workflow: 'w.md' }));
  fs.writeFileSync(path.join(pluginRoot, 'p1', 'w.md'), 'x');
  return { root, pluginRoot };
}

test('ai-site：路径模式匹配与剥离前缀', async () => {
  const { root, pluginRoot } = setup();
  const site = createAiSite({
    dir: path.join(root, 'ai-site'), logger: console,
    isPrefixTaken: () => false,
  });
  site.configStore.save({ pluginRoot, mode: 'path', pathPrefix: '/ai', enabled: true, requireAuth: false });
  assert.equal(site.matchPath('/ai'), true);
  assert.equal(site.matchPath('/ai/p/x'), true);
  assert.equal(site.matchPath('/apix'), false);
  assert.equal(site.matchPath('/api/x'), false);
  assert.equal(site.listPlugins().length, 1);
  site.configStore.save({ mode: 'path', pathPrefix: '/ai2', enabled: false });
  assert.equal(site.matchPath('/ai2'), false);
  await site.stop();
});
