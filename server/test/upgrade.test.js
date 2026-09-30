import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersion, createUpgradeChecker, UPGRADE_PAGE_URL } from '../upgrade.js';

const okRes = (tag) => ({ ok: true, json: async () => ({ tag_name: tag }) });

test('compareVersion：vYYYYMMDD 数值比较；非日期回退字符串比较', () => {
  assert.equal(compareVersion('v20260929', 'v20260101'), 1);
  assert.equal(compareVersion('v20260101', 'v20260929'), -1);
  assert.equal(compareVersion('v20260929', 'v20260929'), 0);
  assert.equal(compareVersion('', 'v20260929'), -1);
  assert.equal(compareVersion('aaa', 'bbb'), -1);
  assert.equal(compareVersion('bbb', 'aaa'), 1);
});

test('createUpgradeChecker：拉 tag_name 判新旧并缓存，refresh 强制重拉', async () => {
  const urls = [];
  const checker = createUpgradeChecker({
    currentVersion: 'v20260101', cacheMs: 1000, now: () => 1000,
    fetchImpl: async (u) => { urls.push(u); return okRes('v20260929'); },
  });
  const r = await checker.check();
  assert.equal(r.ok, true);
  assert.equal(r.latest, 'v20260929');
  assert.equal(r.hasUpdate, true);
  assert.equal(r.url, UPGRADE_PAGE_URL);
  await checker.check();
  assert.equal(urls.length, 1, '缓存命中不再 fetch');
  await checker.check(true);
  assert.equal(urls.length, 2, 'refresh 强制 fetch');
});

test('createUpgradeChecker：优先取产品包 asset 作为 downloadUrl，缺省回退下载页', async () => {
  const assets = [
    { name: 'v20260929.zip', browser_download_url: 'http://x/src.zip' },
    { name: 'vscode-ai-windows-x64-v20260929.zip', browser_download_url: 'http://x/win.zip' },
    { name: 'v20260929.tar.gz', browser_download_url: 'http://x/src.tgz' },
  ];
  const checker = createUpgradeChecker({
    currentVersion: 'v20260101',
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v20260929', assets }) }),
  });
  const r = await checker.check();
  assert.equal(r.downloadUrl, 'http://x/win.zip');
  assert.equal(r.url, UPGRADE_PAGE_URL);

  const noAssets = createUpgradeChecker({
    currentVersion: 'v20260101',
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v20260929' }) }),
  });
  assert.equal((await noAssets.check()).downloadUrl, UPGRADE_PAGE_URL);
});

test('createUpgradeChecker：相同版本不提示', async () => {
  const checker = createUpgradeChecker({ currentVersion: 'v20260929', fetchImpl: async () => okRes('v20260929') });
  assert.equal((await checker.check()).hasUpdate, false);
});

test('createUpgradeChecker：失败时有缓存回退 stale；无缓存 ok:false', async () => {
  let fail = false;
  const checker = createUpgradeChecker({
    currentVersion: 'v20260101', cacheMs: 0,
    fetchImpl: async () => { if (fail) throw new Error('down'); return okRes('v20260929'); },
  });
  await checker.check();
  fail = true;
  const stale = await checker.check(true);
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  const fresh = createUpgradeChecker({ currentVersion: 'v20260101', fetchImpl: async () => { throw new Error('down'); } });
  const bad = await fresh.check();
  assert.equal(bad.ok, false);
  assert.equal(bad.hasUpdate, false);
});
