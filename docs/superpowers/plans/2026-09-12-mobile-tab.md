# 移动（Mobile）页签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在左侧活动栏新增「移动」页签，展示手机远程编程的介绍与 iOS/Android 两个占位下载二维码；顺带把代理页签图标从 🔌 改为 🔀。

**Architecture:** 纯前端静态页面。新增一个 `MobileView.vue` 展示组件，在 `App.vue` 的 `rail` 状态里加入 `'mobile'` 分支渲染；二维码为预生成的静态 SVG，放在 `web/public/mobile/`，运行时零依赖；全部文案走 `@devflow/shared/i18n`。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Vite 静态资源、`npx qrcode`（仅离线生成图片）。

参考规格：`docs/superpowers/specs/2026-09-12-mobile-tab-design.md`

---

### Task 1: 补齐 i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js:582`（在 `'nav.proxy'` 行之后插入）
- Modify: `shared/i18n/en.js:582`（在 `'nav.proxy'` 行之后插入）

- [ ] **Step 1: 在 zh-CN.js 的 `'nav.proxy': '代理',` 之后插入以下词条**

```js
  'nav.mobile': '移动',
  'mobile.title': '手机编程',
  'mobile.desc': '用手机远程控制你的电脑，随时继续编程。',
  'mobile.feat.terminal': '随时查看并接管电脑上的终端会话',
  'mobile.feat.review': '在手机上审阅代码改动与 diff',
  'mobile.feat.pair': '扫码即连，无需手动配置',
  'mobile.ios': 'iOS',
  'mobile.android': 'Android',
  'mobile.coming_soon': '即将推出',
  'mobile.scan_hint': '扫码或点击下载',
```

- [ ] **Step 2: 在 en.js 的 `'nav.proxy': 'Proxy',` 之后插入对应英文词条**

```js
  'nav.mobile': 'Mobile',
  'mobile.title': 'Code from your phone',
  'mobile.desc': 'Control your computer from your phone and keep coding anywhere.',
  'mobile.feat.terminal': 'View and take over terminal sessions on your computer',
  'mobile.feat.review': 'Review code changes and diffs on your phone',
  'mobile.feat.pair': 'Scan to connect, no manual setup',
  'mobile.ios': 'iOS',
  'mobile.android': 'Android',
  'mobile.coming_soon': 'Coming soon',
  'mobile.scan_hint': 'Scan or click to download',
```

- [ ] **Step 3: 校验中英键集合对称、且无中文命中**

Run: `npm.cmd run check:i18n`
Expected: 输出 `check-i18n: 未发现中文命中`，退出码 0。

- [ ] **Step 4: 交叉核对键一致性**

Run: `node -e "import('./shared/i18n/zh-CN.js').then(async z=>{const e=(await import('./shared/i18n/en.js')).messages;const zk=Object.keys(z.messages),ek=Object.keys(e);const miss=zk.filter(k=>!e[k]);const extra=ek.filter(k=>!z.messages[k]);console.log('missing-in-en',miss);console.log('extra-in-en',extra);})"`
Expected: 两个数组均为 `[]`。

---

### Task 2: 生成静态二维码 + 重生成脚本

**Files:**
- Create: `scripts/gen-mobile-qr.js`
- Create: `web/public/mobile/qr-ios.svg`（脚本产物）
- Create: `web/public/mobile/qr-android.svg`（脚本产物）

- [ ] **Step 1: 创建 `scripts/gen-mobile-qr.js`**

```js
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IOS_URL = 'https://apps.apple.com/app/id0000000000';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.devflow.app';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web', 'public', 'mobile');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { url: IOS_URL, out: path.join(outDir, 'qr-ios.svg') },
  { url: ANDROID_URL, out: path.join(outDir, 'qr-android.svg') },
];

for (const { url, out } of targets) {
  execFileSync('npx', ['--yes', 'qrcode', '-t', 'svg', '-o', out, url], { stdio: 'inherit', shell: true });
  console.log('generated', path.relative(root, out));
}
```

- [ ] **Step 2: 运行脚本生成两张 SVG**

Run: `node scripts/gen-mobile-qr.js`
Expected: 打印 `generated web\public\mobile\qr-ios.svg` 与 `generated web\public\mobile\qr-android.svg`；首次运行可能因 `npx --yes qrcode` 下载包耗时较长。

- [ ] **Step 3: 校验产物存在且是 SVG**

Run: `Get-ChildItem -LiteralPath "web\public\mobile" | Select-Object Name,Length; Get-Content -LiteralPath "web\public\mobile\qr-ios.svg" -TotalCount 1`
Expected: 两个文件存在且 `Length` 大于 0；首行以 `<svg` 或 `<?xml` 开头。

- [ ] **Step 4: 目视确认二维码可扫**

用手机相机或二维码 App 扫描 `web/public/mobile/qr-ios.svg`（在文件管理器/图片查看器中打开），确认解析结果为 `https://apps.apple.com/app/id0000000000`。

---

### Task 3: 新增 `web/src/components/MobileView.vue`

**Files:**
- Create: `web/src/components/MobileView.vue`

- [ ] **Step 1: 创建组件（完整内容）**

```vue
<script setup lang="ts">
const IOS_URL = 'https://apps.apple.com/app/id0000000000';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.devflow.app';
const base = import.meta.env.BASE_URL;
const qrIos = `${base}mobile/qr-ios.svg`;
const qrAndroid = `${base}mobile/qr-android.svg`;
</script>

<template>
  <div class="mobile">
    <header class="hero">
      <h2 class="title">{{ $t('mobile.title') }}</h2>
      <p class="desc">{{ $t('mobile.desc') }}</p>
    </header>

    <ul class="feats">
      <li>{{ $t('mobile.feat.terminal') }}</li>
      <li>{{ $t('mobile.feat.review') }}</li>
      <li>{{ $t('mobile.feat.pair') }}</li>
    </ul>

    <div class="cards">
      <section class="card">
        <div class="chead">
          <span class="platform">{{ $t('mobile.ios') }}</span>
          <span class="badge">{{ $t('mobile.coming_soon') }}</span>
        </div>
        <img class="qr" :src="qrIos" :alt="$t('mobile.ios')" width="168" height="168" />
        <div class="hint">{{ $t('mobile.scan_hint') }}</div>
        <a class="link" :href="IOS_URL" target="_blank" rel="noopener">App Store</a>
      </section>

      <section class="card">
        <div class="chead">
          <span class="platform">{{ $t('mobile.android') }}</span>
          <span class="badge">{{ $t('mobile.coming_soon') }}</span>
        </div>
        <img class="qr" :src="qrAndroid" :alt="$t('mobile.android')" width="168" height="168" />
        <div class="hint">{{ $t('mobile.scan_hint') }}</div>
        <a class="link" :href="ANDROID_URL" target="_blank" rel="noopener">Google Play</a>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mobile { padding: 24px; overflow: auto; height: 100%; box-sizing: border-box; color: var(--tx); }
.hero { max-width: 560px; }
.title { margin: 0 0 8px; color: var(--tx1); font-size: 22px; }
.desc { margin: 0; color: var(--tx3); font-size: 14px; line-height: 1.6; }
.feats { margin: 18px 0 22px; padding-left: 20px; color: var(--tx2); font-size: 13px; line-height: 2; }
.cards { display: flex; flex-wrap: wrap; gap: 16px; }
.card { width: 240px; border: 1px solid var(--bd); border-radius: 8px; padding: 16px; background: var(--bg2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.chead { width: 100%; display: flex; align-items: center; justify-content: space-between; }
.platform { font-weight: 700; color: var(--tx1); }
.badge { font-size: 11px; color: var(--tx3); border: 1px solid var(--bd); border-radius: 10px; padding: 1px 8px; }
.qr { background: #fff; border-radius: 6px; padding: 8px; box-sizing: content-box; }
.hint { color: var(--tx4); font-size: 12px; }
.link { color: var(--ac2); font-size: 12px; text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
```

- [ ] **Step 2: 类型检查该组件**

Run: `npm.cmd run typecheck`
Expected: 无错误（`vue-tsc --noEmit` 退出码 0）。此时组件尚未被引用，但 `src/**/*.vue` 会被纳入检查。

---

### Task 4: 在 `App.vue` 接入页签并修正代理图标

**Files:**
- Modify: `web/src/App.vue:19`（新增组件 import）
- Modify: `web/src/App.vue:147`（`rail` 联合类型）
- Modify: `web/src/App.vue:456`（代理按钮 emoji）与新增移动按钮
- Modify: `web/src/App.vue:474-478` 附近（新增渲染分支）

- [ ] **Step 1: 在 `import ProxyView from './components/ProxyView.vue';` 之后新增 import**

```ts
import MobileView from './components/MobileView.vue';
```

- [ ] **Step 2: 扩展 `rail` 联合类型**

把：
```ts
const rail = ref<'explorer' | 'history' | 'contacts' | 'stat' | 'scheduler' | 'proxy'>('explorer');
```
改为：
```ts
const rail = ref<'explorer' | 'history' | 'contacts' | 'stat' | 'scheduler' | 'proxy' | 'mobile'>('explorer');
```

- [ ] **Step 3: 代理按钮 emoji 改为 🔀，并在其后新增移动按钮**

> 补充（评审追加）：同时把代理页签名称由「代理」改为「中转站」，即 `nav.proxy`、`llm.title`、`llm.proxy.title`、`llm.proxy.enable` 中文改「中转站/中转…」，英文改 `Relay` 系列（见 Task 1 词条区）。

把：
```html
        <button class="a-btn" :class="{ on: rail === 'proxy' }" :title="$t('nav.proxy')" @click="rail = 'proxy'">🔌</button>
```
改为：
```html
        <button class="a-btn" :class="{ on: rail === 'proxy' }" :title="$t('nav.proxy')" @click="rail = 'proxy'">🔀</button>
        <button class="a-btn" :class="{ on: rail === 'mobile' }" :title="$t('nav.mobile')" @click="rail = 'mobile'">📱</button>
```

- [ ] **Step 4: 新增移动页渲染分支**

在 `rail === 'proxy'` 的 `<template>` 块之后、`<template v-else>` 之前插入：
```html
      <template v-else-if="rail === 'mobile'">
        <section class="center">
          <MobileView />
        </section>
      </template>
```

- [ ] **Step 5: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 退出码 0，无报错。

---

### Task 5: 全量验证与人工验收

**Files:** 无（验证）

- [ ] **Step 1: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 2: 前端测试不回归**

Run: `npm.cmd test:web`
Expected: vitest 全部通过。

- [ ] **Step 3: 构建（确认静态资源被打包）**

Run: `npm.cmd run build:web`
Expected: 构建成功；`web/dist/mobile/qr-ios.svg` 与 `web/dist/mobile/qr-android.svg` 存在。

Run: `Get-ChildItem -LiteralPath "web\dist\mobile" | Select-Object Name`
Expected: 列出两个 svg。

- [ ] **Step 4: 人工验收（异步启动开发前端）**

按 AGENTS.md 规范后台启动：`npm.cmd run dev:web`，访问 http://localhost:5173 ，确认：
1. 左侧活动栏出现 📱，代理图标为 🔀；
2. 点 📱 进入「手机编程」介绍页，看到 3 条要点与 iOS/Android 两张二维码卡片；
3. 扫描二维码得到占位 URL；
4. 点顶栏「中/EN」切换，页面文案即时切换；
5. 切换深浅色主题，页面配色正常。

---

## Self-Review

**Spec coverage:**
- 导航接入（rail + 按钮 + 分支）→ Task 4。
- `MobileView.vue` 结构 → Task 3。
- 静态二维码资源 → Task 2。
- 重生成脚本 → Task 2。
- i18n 词条 → Task 1。
- 代理图标 🔌→🔀 → Task 4 Step 3。
- 验证（typecheck / check:i18n / test:web / build:web / 人工）→ Task 5。
- 全部 spec 要求均有对应任务，无遗漏。

**Placeholder scan:** 无 TBD/TODO；所有代码步骤均给出完整代码与确切命令。

**Type consistency:** `MobileView` 组件名、`IOS_URL`/`ANDROID_URL`、`qrIos`/`qrAndroid`、i18n 键名在各任务间保持一致；`rail` 新增字面量 `'mobile'` 与按钮 `@click="rail = 'mobile'"` 一致。

**说明：** 本功能为纯静态展示，无业务逻辑，故不新增单元测试；以 `typecheck` + `check:i18n` + `build:web` + 人工验收作为验证手段。
