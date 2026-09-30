# 升级检测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 服务端定时从 Gitee Releases 拉最新版本、与本地 `VERSION` 比对；前端顶栏徽标 + 关于页详情 + 每 10 天一次的弹窗提醒并可去下载。

**Architecture:** 新增 `server/upgrade.js` 检测器（fetch + 缓存 + 静默回退），`index.js` 启动+每 10 天检查并暴露 `GET /api/upgrade`。前端 `useUpgrade.ts` 模块级状态，`UpgradeDialog.vue` 弹窗，App 顶栏徽标，关于页手动检查。

**Tech Stack:** Node ESM（`node --test`）、Vue 3 + Vitest/happy-dom、Gitee v5 API。

**Spec:** `docs/superpowers/specs/2026-09-29-upgrade-check-design.md`

---

## File Structure

- Create: `server/upgrade.js`
- Create: `server/test/upgrade.test.js`
- Modify: `server/index.js`（import、创建检测器、启动+定时、`/api/upgrade` 路由）
- Create: `web/src/useUpgrade.ts`
- Create: `web/src/useUpgrade.test.ts`
- Create: `web/src/components/UpgradeDialog.vue`
- Create: `web/src/components/UpgradeDialog.test.ts`
- Modify: `web/src/App.vue`（顶栏徽标 + 加载 + 弹窗 + localStorage）
- Modify: `web/src/components/TerminalView.vue`（关于页「升级检测」行）
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`（`upgrade.*`）

---

### Task 1: 服务端检测器 `server/upgrade.js`

**Files:**
- Create: `server/upgrade.js`
- Test: `server/test/upgrade.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/upgrade.test.js`：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/upgrade.test.js"`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

创建 `server/upgrade.js`：

```js
export const UPGRADE_API_URL = 'https://gitee.com/api/v5/repos/slxxzh12/vscode-ai/releases/latest';
export const UPGRADE_PAGE_URL = 'https://gitee.com/slxxzh12/vscode-ai/releases';
export const CACHE_MS = 10 * 24 * 60 * 60 * 1000;   // 10 天

const norm = (v) => String(v == null ? '' : v).trim();

// 版本比较：vYYYYMMDD 按数值比；否则回退字符串比较
export function compareVersion(a, b) {
  const x = norm(a).replace(/^v/i, '');
  const y = norm(b).replace(/^v/i, '');
  if (/^\d{8}$/.test(x) && /^\d{8}$/.test(y)) {
    const nx = Number(x); const ny = Number(y);
    return nx < ny ? -1 : nx > ny ? 1 : 0;
  }
  return x < y ? -1 : x > y ? 1 : 0;
}

// 升级检测器：拉远端 latest release 的 tag 与本地版本比对；带缓存、失败静默回退。
export function createUpgradeChecker({
  apiUrl = UPGRADE_API_URL,
  pageUrl = UPGRADE_PAGE_URL,
  currentVersion = '',
  timeoutMs = 5000,
  cacheMs = CACHE_MS,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let cache = null; // { result, expiresAt }

  async function check(force = false) {
    const t = now();
    if (!force && cache && cache.expiresAt > t) return cache.result;
    const current = norm(currentVersion);
    try {
      const res = await fetchImpl(apiUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'devflow' },
      });
      if (!res.ok) throw new Error(`http-${res.status}`);
      const data = await res.json();
      const latest = norm(data && data.tag_name);
      const hasUpdate = !!latest && !!current && compareVersion(latest, current) > 0;
      const result = { ok: true, current, latest, hasUpdate, url: pageUrl, checkedAt: t };
      cache = { result, expiresAt: t + cacheMs };
      return result;
    } catch (e) {
      if (cache) return { ...cache.result, stale: true };
      return { ok: false, current, latest: '', hasUpdate: false, url: pageUrl, error: String((e && e.message) || e), checkedAt: t };
    }
  }

  return { check, status() { return cache ? cache.result : null; } };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/upgrade.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/upgrade.js server/test/upgrade.test.js
git commit -m "feat(upgrade): 新增升级检测器（Gitee releases + 缓存回退）"
```

---

### Task 2: `index.js` 接线与接口

**Files:**
- Modify: `server/index.js:74-85`（import + 创建检测器）
- Modify: `server/index.js:665-671`（启动检查 + 每 10 天）
- Modify: `server/index.js:769-773`（`/api/upgrade` 路由）

- [ ] **Step 1: import 与创建检测器**

在 `server/index.js` 第 75 行 `import { createNotice } from './notice.js';` 之后加：

```js
import { createUpgradeChecker } from './upgrade.js';
```

在第 85 行 `const notice = createNotice();` 之后加：

```js
const upgradeChecker = createUpgradeChecker({ currentVersion: VERSION });
```

- [ ] **Step 2: 启动检查 + 每 10 天定时**

在第 667 行 `if (ws.usageReporter) { ws.usageReporter.stop(); ws.usageReporter.start(); }` 之后加：

```js
  // 升级检测：启动查一次，之后每 10 天一次（非阻塞、失败静默）
  upgradeChecker.check().catch(() => { /* ignore */ });
  const upgradeTimer = setInterval(() => { upgradeChecker.check().catch(() => { /* ignore */ }); }, 10 * 24 * 3600 * 1000);
  upgradeTimer.unref?.();
```

- [ ] **Step 3: 接口**

在第 769-773 行的 `/api/version` 路由块之后加：

```js
  if (url.pathname === '/api/upgrade' && req.method === 'GET') {
    const r = await upgradeChecker.check(url.searchParams.get('refresh') === '1');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(r));
    return;
  }
```

- [ ] **Step 4: 语法自检**

Run: `node --check server/index.js`
Expected: 无输出（通过）。

- [ ] **Step 5: 提交**

```bash
git add server/index.js
git commit -m "feat(upgrade): 启动+每10天检测并暴露 /api/upgrade"
```

---

### Task 3: 前端 `useUpgrade.ts`

**Files:**
- Create: `web/src/useUpgrade.ts`
- Test: `web/src/useUpgrade.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/useUpgrade.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

function fresh() { vi.resetModules(); return import('./useUpgrade'); }
afterEach(() => vi.unstubAllGlobals());

describe('useUpgrade', () => {
  it('loadUpgrade 拉 /api/upgrade 并填充', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return { ok: true, json: async () => ({ ok: true, current: 'v1', latest: 'v2', hasUpdate: true, url: 'http://d' }) }; }));
    const { loadUpgrade, useUpgrade } = await fresh();
    await loadUpgrade();
    expect(calls[0]).toBe('/api/upgrade');
    expect(useUpgrade().upgrade.value?.hasUpdate).toBe(true);
  });

  it('checkNow 强制刷新（?refresh=1）', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return { ok: true, json: async () => ({ ok: true, current: 'v1', latest: 'v3', hasUpdate: true, url: 'http://d' }) }; }));
    const { checkNow, useUpgrade } = await fresh();
    await checkNow();
    expect(calls[0]).toBe('/api/upgrade?refresh=1');
    expect(useUpgrade().upgrade.value?.latest).toBe('v3');
  });

  it('shouldPopup：跳过版本/10 天内不弹/满足条件弹', async () => {
    const { shouldPopup } = await fresh();
    const info = { ok: true, current: 'v1', latest: 'v2', hasUpdate: true, url: '', checkedAt: 0 };
    const DAY = 24 * 3600 * 1000;
    expect(shouldPopup(info, 1000, {})).toBe(true);
    expect(shouldPopup(info, 1000, { skip: 'v2' })).toBe(false);
    expect(shouldPopup(info, 1000, { popupAt: 1000 })).toBe(false);
    expect(shouldPopup(info, 1000, { popupAt: 1000 - 10 * DAY })).toBe(true);
    expect(shouldPopup(info, 1000, { popupAt: 1000 - 10 * DAY + 1 })).toBe(false);
    expect(shouldPopup(null, 1000, {})).toBe(false);
    expect(shouldPopup({ ...info, hasUpdate: false }, 1000, {})).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- useUpgrade`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

创建 `web/src/useUpgrade.ts`：

```ts
import { ref } from 'vue';

export interface UpgradeInfo {
  ok: boolean; current: string; latest: string; hasUpdate: boolean;
  url: string; checkedAt: number; stale?: boolean; error?: string;
}

const upgrade = ref<UpgradeInfo | null>(null);
const loading = ref(false);
let pending: Promise<void> | null = null;

function apply(d: UpgradeInfo | null) { if (d && typeof d === 'object') upgrade.value = d; }

export function loadUpgrade(): Promise<void> {
  if (pending) return pending;
  pending = fetch('/api/upgrade')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => apply(d as UpgradeInfo | null))
    .catch(() => { /* offline: keep */ })
    .finally(() => { pending = null; });
  return pending;
}

export async function checkNow(): Promise<void> {
  loading.value = true;
  try {
    const r = await fetch('/api/upgrade?refresh=1');
    apply(r.ok ? ((await r.json()) as UpgradeInfo) : null);
  } catch { /* ignore */ }
  finally { loading.value = false; }
}

// 是否自动弹窗：有新版、未被「不再提示」、且距上次弹窗满 10 天
export function shouldPopup(
  info: Pick<UpgradeInfo, 'hasUpdate' | 'latest'> | null,
  now: number,
  opts: { skip?: string; popupAt?: number; intervalMs?: number } = {},
): boolean {
  if (!info || !info.hasUpdate || !info.latest) return false;
  if (opts.skip && opts.skip === info.latest) return false;
  const interval = opts.intervalMs ?? 10 * 24 * 3600 * 1000;
  const last = Number(opts.popupAt || 0);
  return !last || now - last >= interval;
}

export function useUpgrade() { return { upgrade, loading, loadUpgrade, checkNow }; }
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- useUpgrade`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/useUpgrade.ts web/src/useUpgrade.test.ts
git commit -m "feat(upgrade): 前端 useUpgrade（加载/手动检测/弹窗判定）"
```

---

### Task 4: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文**

在 `shared/i18n/zh-CN.js` 的 `'usage.last_report'` 之前（或任意词条块内）加：

```js
  'upgrade.title': '发现新版本',
  'upgrade.check': '升级检测',
  'upgrade.check_now': '检查更新',
  'upgrade.checking': '检查中…',
  'upgrade.current': '当前版本',
  'upgrade.latest': '最新版本',
  'upgrade.new': '新版本',
  'upgrade.up_to_date': '已是最新',
  'upgrade.failed': '检测失败',
  'upgrade.go': '去下载',
  'upgrade.later': '关闭',
  'upgrade.skip': '不再提示',
```

- [ ] **Step 2: 英文**

在 `shared/i18n/en.js` 的对应位置加：

```js
  'upgrade.title': 'New version available',
  'upgrade.check': 'Update check',
  'upgrade.check_now': 'Check for updates',
  'upgrade.checking': 'Checking…',
  'upgrade.current': 'Current version',
  'upgrade.latest': 'Latest version',
  'upgrade.new': 'New version',
  'upgrade.up_to_date': 'Up to date',
  'upgrade.failed': 'Check failed',
  'upgrade.go': 'Download',
  'upgrade.later': 'Close',
  'upgrade.skip': 'Don\'t remind',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 新增 upgrade.* 词条"
```

---

### Task 5: 弹窗组件 `UpgradeDialog.vue`

**Files:**
- Create: `web/src/components/UpgradeDialog.vue`
- Test: `web/src/components/UpgradeDialog.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/UpgradeDialog.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import UpgradeDialog from './UpgradeDialog.vue';

describe('UpgradeDialog', () => {
  it('三按钮分别 emit go / close / skip', async () => {
    const w = mountC(UpgradeDialog, { props: { open: true, current: 'v1', latest: 'v2' } });
    expect(w.text()).toContain('v2');
    await w.find('.upg-go').trigger('click');
    await w.find('.upg-close').trigger('click');
    await w.find('.upg-skip').trigger('click');
    expect(w.emitted('go')).toHaveLength(1);
    expect(w.emitted('close')).toHaveLength(1);
    expect(w.emitted('skip')).toHaveLength(1);
  });

  it('open=false 不渲染', () => {
    const w = mountC(UpgradeDialog, { props: { open: false, current: 'v1', latest: 'v2' } });
    expect(w.find('.ep-box').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- UpgradeDialog`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现**

创建 `web/src/components/UpgradeDialog.vue`：

```vue
<script setup lang="ts">
defineProps<{ open: boolean; current: string; latest: string }>();
const emit = defineEmits<{ (e: 'go'): void; (e: 'close'): void; (e: 'skip'): void }>();
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="ep-mask" @click.self="emit('close')">
      <div class="ep-box" role="dialog" aria-modal="true">
        <div class="ep-head"><span class="ep-ico">↑</span><span class="ep-title">{{ $t('upgrade.title') }}</span></div>
        <div class="ep-body">
          <div class="urow"><span class="uk">{{ $t('upgrade.current') }}</span><span class="uv">{{ current || '-' }}</span></div>
          <div class="urow"><span class="uk">{{ $t('upgrade.latest') }}</span><span class="uv">{{ latest || '-' }}</span></div>
        </div>
        <div class="ep-foot">
          <button class="ep-btn upg-skip" @click="emit('skip')">{{ $t('upgrade.skip') }}</button>
          <button class="ep-btn upg-close" @click="emit('close')">{{ $t('upgrade.later') }}</button>
          <button class="ep-btn ep-primary upg-go" @click="emit('go')">{{ $t('upgrade.go') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.ep-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3100; }
.ep-box { width: 420px; max-width: 90vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.ep-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.ep-ico { width: 22px; height: 22px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; background: var(--ac); }
.ep-title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.ep-body { display: flex; flex-direction: column; gap: 6px; }
.urow { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.uk { color: var(--tx3); width: 84px; flex: none; }
.uv { color: var(--tx1); font-family: ui-monospace, Consolas, monospace; }
.ep-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.ep-btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.ep-btn:hover { border-color: var(--ac); color: var(--ac); }
.ep-primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.ep-primary:hover { filter: brightness(1.08); color: #fff; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- UpgradeDialog`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/UpgradeDialog.vue web/src/components/UpgradeDialog.test.ts
git commit -m "feat(upgrade): 新增升级提示弹窗组件"
```

---

### Task 6: App 顶栏徽标 + 关于页 + 弹窗接入

**Files:**
- Modify: `web/src/App.vue`
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: App.vue —— import 与状态**

在 `web/src/App.vue` 第 27 行 `import { useVersion } from './useVersion';` 之后加：

```js
import { useUpgrade, shouldPopup } from './useUpgrade';
import UpgradeDialog from './components/UpgradeDialog.vue';
```

在 `const { version: appVersion, loadVersion } = useVersion();`（约第 83 行）之后加：

```js
const { upgrade: upgradeInfo, loadUpgrade } = useUpgrade();
const showUpgrade = ref(false);
const UPGRADE_POPUP_KEY = 'devflow-upgrade-popup-at';
const UPGRADE_SKIP_KEY = 'devflow-upgrade-skip';
function openUpgrade() { const u = upgradeInfo.value?.url; if (u) window.open(u, '_blank', 'noopener'); }
function markUpgradePopup() { try { localStorage.setItem(UPGRADE_POPUP_KEY, String(Date.now())); } catch { /* ignore */ } }
function upgradeGo() { openUpgrade(); markUpgradePopup(); showUpgrade.value = false; }
function upgradeClose() { markUpgradePopup(); showUpgrade.value = false; }
function upgradeSkip() { try { localStorage.setItem(UPGRADE_SKIP_KEY, upgradeInfo.value?.latest || ''); } catch { /* ignore */ } showUpgrade.value = false; }
function maybeUpgradePopup() {
  let skip = ''; let popupAt = 0;
  try { skip = localStorage.getItem(UPGRADE_SKIP_KEY) || ''; popupAt = Number(localStorage.getItem(UPGRADE_POPUP_KEY) || 0); } catch { /* ignore */ }
  showUpgrade.value = shouldPopup(upgradeInfo.value, Date.now(), { skip, popupAt });
}
```

- [ ] **Step 2: App.vue —— 加载触发**

在 `onMounted` 的 `loadVersion();`（第 658 行）之后加：

```js
  void loadUpgrade().finally(maybeUpgradePopup);
```

- [ ] **Step 3: App.vue —— 顶栏徽标**

把第 712 行：

```html
      <span v-if="appVersion" class="app-ver">{{ appVersion }}</span>
```

替换为：

```html
      <span v-if="appVersion" class="app-ver">{{ appVersion }}</span>
      <button v-if="upgradeInfo?.hasUpdate" class="upg-badge" :title="$t('upgrade.new')" @click="openUpgrade">↑ {{ $t('upgrade.new') }}</button>
```

- [ ] **Step 4: App.vue —— 挂载弹窗**

把第 798 行 `<DistTaskNotifier :terminal="terminal" />` 之后、`</div>` 之前加：

```html
    <UpgradeDialog :open="showUpgrade" :current="appVersion" :latest="upgradeInfo?.latest || ''" @go="upgradeGo" @close="upgradeClose" @skip="upgradeSkip" />
```

- [ ] **Step 5: App.vue —— 徽标样式**

在 `<style scoped>` 内加：

```css
.upg-badge { background: var(--warn); color: #fff; border: none; border-radius: 8px; padding: 1px 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
.upg-badge:hover { filter: brightness(1.08); }
```

- [ ] **Step 6: TerminalView 关于页**

在 `web/src/components/TerminalView.vue` 第 24 行 `import { useVersion } from '../useVersion';` 之后加：

```js
import { useUpgrade } from '../useUpgrade';
```

在 `const { version: appVersion } = useVersion();`（约第 352 行）之后加：

```js
const { upgrade: upgradeInfo, loading: upgradeLoading, checkNow } = useUpgrade();
```

在关于页「下载」区块 `</div>` 之后（第 1344 行后）插入：

```html
            <div class="setsec">
              <div class="settitle">{{ $t('upgrade.check') }}</div>
              <div class="aboutrow"><span class="aboutk">{{ $t('upgrade.current') }}</span><span class="aboutv">{{ appVersion || '-' }}</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('upgrade.latest') }}</span><span class="aboutv">{{ upgradeInfo?.latest || '-' }}</span></div>
              <div class="aboutrow"><span class="aboutk"></span>
                <button class="upgbtn" :disabled="upgradeLoading" @click="checkNow">{{ upgradeLoading ? $t('upgrade.checking') : $t('upgrade.check_now') }}</button>
              </div>
            </div>
```

在 `<style scoped>` 加：

```css
.upgbtn { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.upgbtn:hover { border-color: var(--ac); color: var(--ac); }
.upgbtn:disabled { opacity: .55; cursor: default; }
```

- [ ] **Step 7: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。

- [ ] **Step 8: 提交**

```bash
git add web/src/App.vue web/src/components/TerminalView.vue
git commit -m "feat(upgrade): 顶栏徽标 + 关于页升级检测 + 弹窗接入"
```

---

### Task 7: 全量校验

**Files:** 无（验证）

- [ ] **Step 1: 单测**

Run: `npm.cmd test`
Expected: server + web 全部通过。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。

- [ ] **Step 3: i18n**

Run: `npm.cmd run check:i18n`
Expected: 通过。

- [ ] **Step 4: 手动（dev）**

`npm.cmd run dev` 后：
- `GET http://127.0.0.1:33333/api/upgrade` 返回 `{ ok, current, latest, hasUpdate, ... }`。
- 本地版本低于远端时顶栏出现「↑ 新版本」，点击打开下载页。
- 关于页显示当前/最新 + 「检查更新」可用。
- 首次加载且有新版弹窗；点「关闭」后刷新不再弹（10 天内）；点「不再提示」后该版本不再弹。

---

## Self-Review

**Spec coverage：**
- 服务端检测器 → Task 1；启动+定时+接口 → Task 2。
- 前端状态与弹窗判定 → Task 3；弹窗组件 → Task 5。
- 顶栏徽标 + 关于页 + 本地记录 → Task 6。
- i18n → Task 4。
- 测试/验收 → 各任务 + Task 7。

**Placeholder scan：** 无 TBD；每步含完整代码/命令。

**Type consistency：** `createUpgradeChecker` 返回 `{ ok, current, latest, hasUpdate, url, checkedAt, stale? , error? }`，与 `UpgradeInfo` 及 `shouldPopup` 入参一致；`useUpgrade` 暴露 `{ upgrade, loading, loadUpgrade, checkNow }`，与 App/TerminalView 解构一致；弹窗 `@go/@close/@skip` 与 App 处理函数一致。
