# 应用市场（App Market）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把左侧活动栏「移动」页签（`📱` + `MobileView.vue`）整体重做为「应用市场」（`🏪` + `AppMarketView.vue`），含客户端下载、扩展安装、小工具三个区块。

**Architecture:** 纯前端改造，不动后端。纯逻辑抽到 `web/src/marketApps.ts`（客户端清单、下载文件分组、大小格式化、kind 词条映射）便于 vitest 单测；`AppMarketView.vue` 只做渲染与交互，扩展数据复用既有 `useCollab().listDownloads()/installDownload()`，小工具直接嵌入 `MiniTools.vue`；`App.vue` 只改图标/import/渲染组件。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Vitest、vue-tsc、`@devflow/shared/i18n`。

**Spec:** `docs/superpowers/specs/2026-09-18-app-market-design.md`

---

## File Structure

- Create: `web/src/marketApps.ts` — 应用市场纯逻辑（无 Vue 依赖）。
- Create: `web/src/marketApps.test.ts` — 上述纯逻辑单测。
- Create: `web/src/components/AppMarketView.vue` — 应用市场页面组件。
- Modify: `shared/i18n/zh-CN.js` — 新增 `market.*`、改 `nav.mobile`、删 `mobile.*`。
- Modify: `shared/i18n/en.js` — 同上（英文）。
- Modify: `web/src/App.vue` — 图标 `📱`→`🏪`、import 与渲染组件替换。
- Delete: `web/src/components/MobileView.vue` — 被 `AppMarketView.vue` 取代。

> 提交约定：本仓库要求提交前先执行 `docs/learn/git仓库提交检查和提交事项.md` 的检查清单（尤其敏感信息扫描）。本会话默认**不自动 commit**；每个 Task 末尾的 commit 步骤仅在用户明确要求提交时执行。

---

### Task 1: 纯逻辑模块 `marketApps.ts`

**Files:**
- Create: `web/src/marketApps.ts`
- Test: `web/src/marketApps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/marketApps.test.ts`:

```ts
import { test, expect } from 'vitest';
import { fmtSize, groupDownloadFiles, installableOf, marketKindKey, MARKET_CLIENTS } from './marketApps';

test('fmtSize：B/KB/MB 分档与小数位', () => {
  expect(fmtSize(0)).toBe('0 B');
  expect(fmtSize(512)).toBe('512 B');
  expect(fmtSize(1024)).toBe('1.0 KB');
  expect(fmtSize(1536)).toBe('1.5 KB');
  expect(fmtSize(10 * 1024 * 1024)).toBe('10 MB');
});

test('installableOf / marketKindKey', () => {
  expect(installableOf({ kind: 'skill' })).toBe(true);
  expect(installableOf({ kind: 'file' })).toBe(false);
  expect(marketKindKey('skill')).toBe('market.kind.skill');
  expect(marketKindKey('workflow')).toBe('market.kind.workflow');
  expect(marketKindKey('weird')).toBe('market.kind.file');
});

test('groupDownloadFiles：skill 与其它分组，各自按 updatedAt 倒序、忽略坏项', () => {
  const g = groupDownloadFiles([
    { name: 'b.zip', kind: 'file', size: 1, updatedAt: 1 },
    { name: 'a.zip', kind: 'skill', size: 1, updatedAt: 2 },
    { name: 'c.zip', kind: 'skill', size: 1, updatedAt: 5 },
    null as unknown as { name: string; kind: string; size: number; updatedAt: number },
  ]);
  expect(g.skill.map((f) => f.name)).toEqual(['c.zip', 'a.zip']);
  expect(g.other.map((f) => f.name)).toEqual(['b.zip']);
  expect(groupDownloadFiles(undefined)).toEqual({ skill: [], other: [] });
});

test('MARKET_CLIENTS：含桌面端与手机端（手机端带二维码标记）', () => {
  expect(MARKET_CLIENTS.some((c) => c.id === 'win')).toBe(true);
  expect(MARKET_CLIENTS.some((c) => c.id === 'mac_arm')).toBe(true);
  expect(MARKET_CLIENTS.some((c) => c.qr)).toBe(true);
  expect(MARKET_CLIENTS.every((c) => c.labelKey.startsWith('market.client.'))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- marketApps`
Expected: FAIL（`Failed to resolve import "./marketApps"` / 模块不存在）

- [ ] **Step 3: Write minimal implementation**

Create `web/src/marketApps.ts`:

```ts
// 应用市场纯逻辑：客户端清单、下载文件分组/格式化（便于单测；组件只做渲染与交互）

export const DESKTOP_URL = 'https://gitee.com/slxxzh12/vscode-ai/releases';
export const MOBILE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/releases';
export const TUTORIAL_URL = 'https://space.bilibili.com/1933375113';
export const ISSUES_URL = 'https://gitee.com/slxxzh12/vscode-ai/issues';

export interface MarketClient {
  id: string;
  icon: string;
  labelKey: string;
  href: string;
  qr?: boolean;
}

export const MARKET_CLIENTS: MarketClient[] = [
  { id: 'win', icon: '🪟', labelKey: 'market.client.win', href: DESKTOP_URL },
  { id: 'mac_arm', icon: '🍎', labelKey: 'market.client.mac_arm', href: DESKTOP_URL },
  { id: 'mac_x64', icon: '🍎', labelKey: 'market.client.mac_x64', href: DESKTOP_URL },
  { id: 'android', icon: '🤖', labelKey: 'market.client.android', href: MOBILE_URL, qr: true },
  { id: 'ios', icon: '📱', labelKey: 'market.client.ios', href: MOBILE_URL, qr: true },
];

export interface DownloadFile { name: string; kind: string; size: number; updatedAt: number }

export const INSTALLABLE_KIND = 'skill';

export function installableOf(file: { kind?: string } | null | undefined): boolean {
  return !!file && file.kind === INSTALLABLE_KIND;
}

export function fmtSize(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export interface MarketGroups { skill: DownloadFile[]; other: DownloadFile[] }

export function groupDownloadFiles(files: DownloadFile[] | null | undefined): MarketGroups {
  const skill: DownloadFile[] = [];
  const other: DownloadFile[] = [];
  for (const f of files || []) {
    if (!f || !f.name) continue;
    (installableOf(f) ? skill : other).push(f);
  }
  const byNewest = (a: DownloadFile, b: DownloadFile) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  skill.sort(byNewest);
  other.sort(byNewest);
  return { skill, other };
}

const KNOWN_KINDS = new Set(['skill', 'workflow', 'group', 'usage', 'file']);

export function marketKindKey(kind: string): string {
  return KNOWN_KINDS.has(kind) ? `market.kind.${kind}` : 'market.kind.file';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- marketApps`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit（仅用户要求时）**

```bash
git add web/src/marketApps.ts web/src/marketApps.test.ts
git commit -m "feat(web): 应用市场纯逻辑 marketApps + 单测"
```

---

### Task 2: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 改 `zh-CN.js` 第一处（`nav.mobile` + 原 `mobile.*` 块 807–823 行）**

把：

```js
  'nav.mobile': '移动',
  'mobile.title': '手机编程',
  'mobile.desc': '用手机远程控制你的电脑，随时继续编程。',
  'mobile.pair_hint': '移动端与电脑端服务端配套使用：手机连接你电脑上的服务，即可随时随地远程操作。',
  'mobile.desktop': '桌面端',
  'mobile.mobile': '移动端',
  'mobile.desktop_hint': 'Windows 绿色免安装包',
  'mobile.tutorial': 'B 站教程',
  'mobile.feat.terminal': '随时查看并接管电脑上的终端会话',
  'mobile.feat.review': '在手机上审阅代码改动与 diff',
  'mobile.feat.pair': '扫码即连，无需手动配置',
  'mobile.download': '下载',
  'mobile.scan_hint': '扫码或点击下载',
  'mobile.git.title': '关于 git 仓库',
  'mobile.git.same': '手机端和电脑端操作的是同一个 git 仓库：代码只有一份，手机上的改动就是电脑上的那份，不会同步出两个副本。',
  'mobile.git.reachable': '前提：手机必须能访问这个仓库地址。同一局域网直接用电脑 IP；不在同一网络就用公网地址 / 内网穿透，或改用 gitee 等远端仓库。',
  'mobile.git.check': '自查：手机浏览器打开仓库地址能正常显示（或 git ls-remote <地址> 能列出分支），就说明可访问。',
```

替换为：

```js
  'nav.mobile': '应用市场',
  'market.title': '应用市场',
  'market.clients': '客户端',
  'market.extensions': '扩展',
  'market.tools': '小工具',
  'market.download': '下载',
  'market.version': '版本 {version}',
  'market.client.win': 'Windows',
  'market.client.mac_arm': 'macOS（Apple 芯片）',
  'market.client.mac_x64': 'macOS（Intel）',
  'market.client.android': 'Android',
  'market.client.ios': 'iOS',
  'market.install': '安装',
  'market.installed': '已安装',
  'market.install_failed': '安装失败：{msg}',
  'market.empty': '暂无可用扩展（加入群组或让群主发布后可在此安装）',
  'market.kind.skill': '技能',
  'market.kind.workflow': '工作流',
  'market.kind.group': '分发包',
  'market.kind.usage': '用量',
  'market.kind.file': '文件',
```

- [ ] **Step 2: 改 `zh-CN.js` 第二处（原 `mobile.*` 块 845–849 行）**

把：

```js
  'mobile.notice': '最新消息',
  'mobile.notice_empty': '暂无消息',
  'mobile.feedback.title': '问题反馈',
  'mobile.feedback.hint': '遇到问题或有功能建议？欢迎到 Gitee 提 Issue，我们会尽快跟进。',
  'mobile.feedback.link': '前往 Gitee 提 Issue',
```

替换为：

```js
  'market.notice': '最新消息',
  'market.notice_empty': '暂无消息',
  'market.feedback': '问题反馈',
  'market.tutorial': 'B 站教程',
```

- [ ] **Step 3: 改 `en.js` 第一处（对应块 807–823 行）**

把：

```js
  'nav.mobile': 'Mobile',
  'mobile.title': 'Code from your phone',
  'mobile.desc': 'Control your computer from your phone and keep coding anywhere.',
  'mobile.pair_hint': 'The mobile app works together with the desktop server: connect your phone to the service on your computer to control it anywhere.',
  'mobile.desktop': 'Desktop',
  'mobile.mobile': 'Mobile',
  'mobile.desktop_hint': 'Windows portable package',
  'mobile.tutorial': 'Bilibili tutorial',
  'mobile.feat.terminal': 'View and take over terminal sessions on your computer',
  'mobile.feat.review': 'Review code changes and diffs on your phone',
  'mobile.feat.pair': 'Scan to connect, no manual setup',
  'mobile.download': 'Download',
  'mobile.scan_hint': 'Scan or click to download',
  'mobile.git.title': 'About the git repository',
  'mobile.git.same': 'Your phone and your computer work on the same git repository: there is only one copy of the code, so a change made on the phone is the same change on the computer — no duplicate or synced copy.',
  'mobile.git.reachable': 'Prerequisite: the phone must be able to reach that repository address. On the same LAN use the computer IP directly; otherwise use a public address / tunnel, or a remote host such as Gitee.',
  'mobile.git.check': 'Quick check: if the repository address opens in the phone browser (or git ls-remote <url> lists the branches), it is reachable.',
```

替换为：

```js
  'nav.mobile': 'App Market',
  'market.title': 'App Market',
  'market.clients': 'Clients',
  'market.extensions': 'Extensions',
  'market.tools': 'Tools',
  'market.download': 'Download',
  'market.version': 'Version {version}',
  'market.client.win': 'Windows',
  'market.client.mac_arm': 'macOS (Apple silicon)',
  'market.client.mac_x64': 'macOS (Intel)',
  'market.client.android': 'Android',
  'market.client.ios': 'iOS',
  'market.install': 'Install',
  'market.installed': 'Installed',
  'market.install_failed': 'Install failed: {msg}',
  'market.empty': 'No extensions available (join a group or wait for the host to publish)',
  'market.kind.skill': 'Skill',
  'market.kind.workflow': 'Workflow',
  'market.kind.group': 'Bundle',
  'market.kind.usage': 'Usage',
  'market.kind.file': 'File',
```

- [ ] **Step 4: 改 `en.js` 第二处（对应块 845–849 行）**

把：

```js
  'mobile.notice': 'Latest news',
  'mobile.notice_empty': 'No news yet',
  'mobile.feedback.title': 'Feedback',
  'mobile.feedback.hint': 'Found a problem or have a feature request? File an issue on Gitee and we will follow up.',
  'mobile.feedback.link': 'Open Gitee Issues',
```

替换为：

```js
  'market.notice': 'Latest news',
  'market.notice_empty': 'No news yet',
  'market.feedback': 'Feedback',
  'market.tutorial': 'Bilibili tutorial',
```

- [ ] **Step 5: 校验词条对称**

Run: `npm.cmd run check:i18n`
Expected: PASS（中英键集合对称、无写死中文）

- [ ] **Step 6: Commit（仅用户要求时）**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(web): 新增应用市场词条，移除 mobile.*"
```

---

### Task 3: 新页面组件 `AppMarketView.vue`

**Files:**
- Create: `web/src/components/AppMarketView.vue`

- [ ] **Step 1: 创建组件**

Create `web/src/components/AppMarketView.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { locale, t } from '../i18n';
import { renderRemoteMarkdown } from '../markdown';
import MiniTools from './MiniTools.vue';
import { useCollab } from '../collaboration/useCollab';
import { useVersion } from '../useVersion';
import {
  ISSUES_URL, MARKET_CLIENTS, TUTORIAL_URL,
  fmtSize, groupDownloadFiles, installableOf, marketKindKey, type DownloadFile,
} from '../marketApps';

const base = import.meta.env.BASE_URL;
const qrMobile = `${base}mobile/qr-mobile.svg`;

const collab = useCollab();
const { version, loadVersion } = useVersion();

const noticeHtml = ref('');
const noticeEmpty = ref('');
async function loadNotice() {
  try {
    const r = await fetch(`/api/notice?lang=${encodeURIComponent(locale.value)}`).then((x) => x.json());
    if (r && r.ok && typeof r.content === 'string' && r.content.trim()) {
      noticeHtml.value = renderRemoteMarkdown(r.content);
      noticeEmpty.value = '';
    } else {
      noticeHtml.value = '';
      noticeEmpty.value = t('market.notice_empty');
    }
  } catch {
    noticeHtml.value = '';
    noticeEmpty.value = t('market.notice_empty');
  }
}

const files = ref<DownloadFile[]>([]);
const groups = computed(() => groupDownloadFiles(files.value));
const installing = ref('');
const installMsg = ref('');

async function loadFiles() {
  try {
    const r = await collab.listDownloads();
    files.value = (r.manifest?.files || []) as DownloadFile[];
  } catch {
    files.value = [];
  }
}

async function install(name: string) {
  if (installing.value) return;
  installing.value = name;
  installMsg.value = '';
  try {
    const r = await collab.installDownload(name);
    installMsg.value = r.code === 'ok' ? t('market.installed') : t('market.install_failed', { msg: r.code });
  } catch (e) {
    installMsg.value = t('market.install_failed', { msg: (e as Error).message || String(e) });
  } finally {
    installing.value = '';
    await loadFiles();
  }
}

function whenLabel(ms: number): string {
  try { return new Date(Number(ms) || 0).toLocaleDateString(); } catch { return ''; }
}

onMounted(() => { void loadNotice(); void loadVersion(); void loadFiles(); });
watch(locale, loadNotice);
</script>

<template>
  <div class="market">
    <section class="notice">
      <h3 class="ntitle">📢 {{ $t('market.notice') }}</h3>
      <div v-if="noticeHtml" class="nbody" v-html="noticeHtml"></div>
      <div v-else class="hint">{{ noticeEmpty || $t('market.notice_empty') }}</div>
    </section>

    <section class="block">
      <h3 class="btitle">🧩 {{ $t('market.clients') }}</h3>
      <div class="cards">
        <div v-for="c in MARKET_CLIENTS" :key="c.id" class="card">
          <div class="cicon">{{ c.icon }}</div>
          <div class="cname">{{ $t(c.labelKey) }}</div>
          <div class="cver">{{ version ? $t('market.version', { version }) : '' }}</div>
          <img v-if="c.qr" class="qr" :src="qrMobile" :alt="$t(c.labelKey)" width="120" height="120" />
          <a class="dl" :href="c.href" target="_blank" rel="noopener">{{ $t('market.download') }}</a>
        </div>
      </div>
    </section>

    <section class="block">
      <h3 class="btitle">📦 {{ $t('market.extensions') }}</h3>
      <div v-if="!files.length" class="empty">{{ $t('market.empty') }}</div>
      <template v-else>
        <ul v-if="groups.skill.length || groups.other.length" class="exts">
          <li v-for="f in [...groups.skill, ...groups.other]" :key="f.name" class="ext">
            <span class="ekind">{{ $t(marketKindKey(f.kind)) }}</span>
            <span class="ename" :title="f.name">{{ f.name }}</span>
            <span class="emeta">{{ fmtSize(f.size) }}</span>
            <span class="emeta">{{ whenLabel(f.updatedAt) }}</span>
            <button v-if="installableOf(f)" class="einstall" :disabled="installing === f.name" @click="install(f.name)">
              {{ installing === f.name ? $t('common.sending') : $t('market.install') }}
            </button>
          </li>
        </ul>
        <div v-else class="empty">{{ $t('market.empty') }}</div>
      </template>
      <div v-if="installMsg" class="hint">{{ installMsg }}</div>
    </section>

    <section class="block">
      <h3 class="btitle">🧰 {{ $t('market.tools') }}</h3>
      <MiniTools />
    </section>

    <footer class="foot">
      <span>🐞 {{ $t('market.feedback') }}</span>
      <a class="link" :href="ISSUES_URL" target="_blank" rel="noopener">{{ ISSUES_URL }}</a>
      <span class="sep">·</span>
      <span>🎬 {{ $t('market.tutorial') }}</span>
      <a class="link" :href="TUTORIAL_URL" target="_blank" rel="noopener">{{ TUTORIAL_URL }}</a>
    </footer>
  </div>
</template>

<style scoped>
.market { padding: 14px; overflow: auto; height: 100%; box-sizing: border-box; color: var(--tx); }
.block { margin: 0 0 18px; }
.btitle { margin: 0 0 10px; color: var(--tx1); font-size: 14px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.card { border: 1px solid var(--bd); border-radius: 10px; padding: 14px; background: var(--bg2); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.cicon { font-size: 34px; line-height: 1; }
.cname { font-weight: 700; color: var(--tx1); font-size: 13px; text-align: center; }
.cver { color: var(--tx4); font-size: 11px; min-height: 14px; }
.qr { background: #fff; border-radius: 6px; padding: 6px; box-sizing: content-box; }
.dl { color: var(--ac2); font-size: 12px; font-weight: 600; text-decoration: none; }
.dl:hover { text-decoration: underline; }
.exts { list-style: none; margin: 0; padding: 0; }
.ext { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--bd2); font-size: 12px; }
.ekind { flex: none; background: var(--bg4); color: var(--tx3); border-radius: 4px; padding: 1px 8px; font-size: 11px; }
.ename { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx2); }
.emeta { flex: none; color: var(--tx4); font-size: 11px; }
.einstall { flex: none; background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 4px 14px; cursor: pointer; font-size: 12px; }
.einstall:disabled { opacity: .55; cursor: default; }
.empty { color: var(--tx4); font-size: 12px; }
.hint { color: var(--tx3); font-size: 12px; margin-top: 6px; }
.notice { margin: 0 0 18px; border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; background: var(--bg2); }
.ntitle { margin: 0 0 6px; color: var(--tx1); font-size: 13px; }
.nbody { color: var(--tx2); font-size: 12px; line-height: 1.6; }
.nbody :deep(h1) { font-size: 16px; margin: 0.5em 0 0.3em; }
.nbody :deep(h2) { font-size: 14px; margin: 0.5em 0 0.3em; }
.nbody :deep(h3) { font-size: 13px; margin: 0.5em 0 0.3em; }
.nbody :deep(p) { margin: 0.4em 0; }
.nbody :deep(a) { color: var(--ac2); text-decoration: none; }
.nbody :deep(a:hover) { text-decoration: underline; }
.nbody :deep(ul), .nbody :deep(ol) { margin: 0.4em 0; padding-left: 1.5em; }
.nbody :deep(li) { margin: 0.1em 0; }
.nbody :deep(code) { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; background: var(--bg1); padding: 1px 5px; border-radius: 4px; }
.nbody :deep(pre) { background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; overflow: auto; }
.nbody :deep(pre code) { background: transparent; padding: 0; }
.nbody :deep(blockquote) { margin: 0.5em 0; padding: 0.1em 0.8em; border-left: 3px solid var(--ac2); color: var(--tx3); }
.nbody :deep(img) { max-width: 100%; border-radius: 6px; }
.nbody :deep(hr) { border: none; border-top: 1px solid var(--bd); margin: 0.8em 0; }
.nbody :deep(table) { border-collapse: collapse; margin: 0.5em 0; }
.nbody :deep(th), .nbody :deep(td) { border: 1px solid var(--bd); padding: 3px 8px; }
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--tx3); font-size: 12px; padding-top: 6px; border-top: 1px solid var(--bd2); }
.foot .link { color: var(--ac2); text-decoration: none; word-break: break-all; }
.foot .link:hover { text-decoration: underline; }
.foot .sep { color: var(--tx5); }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（无 TS 报错；若 `common.sending` 词条缺失，改用 `market.install`）

> 说明：`common.sending` 已在协作分发里使用（`SkillDistributor.vue`），此处复用；若 typecheck 或运行期发现词条不存在，则把按钮文案统一改为 `$t('market.install')`。

- [ ] **Step 3: Commit（仅用户要求时）**

```bash
git add web/src/components/AppMarketView.vue
git commit -m "feat(web): 新增应用市场页面 AppMarketView"
```

---

### Task 4: 接线 `App.vue` 并删除旧页面

**Files:**
- Modify: `web/src/App.vue:18`, `web/src/App.vue:565`, `web/src/App.vue:590`
- Delete: `web/src/components/MobileView.vue`

- [ ] **Step 1: 替换 import**

`web/src/App.vue:18`：

```ts
import MobileView from './components/MobileView.vue';
```

改为：

```ts
import AppMarketView from './components/AppMarketView.vue';
```

- [ ] **Step 2: 换图标**

`web/src/App.vue:565`：

```html
<button class="a-btn" :class="{ on: rail === 'mobile' }" :title="$t('nav.mobile')" @click="rail = 'mobile'">📱</button>
```

改为：

```html
<button class="a-btn" :class="{ on: rail === 'mobile' }" :title="$t('nav.mobile')" @click="rail = 'mobile'">🏪</button>
```

- [ ] **Step 3: 换渲染组件**

`web/src/App.vue:588-592`：

```html
      <template v-else-if="rail === 'mobile'">
        <section class="center">
          <MobileView />
        </section>
      </template>
```

改为：

```html
      <template v-else-if="rail === 'mobile'">
        <section class="center">
          <AppMarketView />
        </section>
      </template>
```

- [ ] **Step 4: 删除旧组件**

```bash
git rm web/src/components/MobileView.vue
```

（若未暂存，等价于删除文件 `web/src/components/MobileView.vue`。）

- [ ] **Step 5: 全量校验**

Run: `npm.cmd test`
Expected: PASS（server + web 全绿，含新 `marketApps` 用例）

Run: `npm.cmd run typecheck`
Expected: PASS

Run: `npm.cmd run check:i18n`
Expected: PASS

- [ ] **Step 6: Commit（仅用户要求时）**

```bash
git add web/src/App.vue web/src/components/AppMarketView.vue web/src/marketApps.ts web/src/marketApps.test.ts shared/i18n/zh-CN.js shared/i18n/en.js
git rm web/src/components/MobileView.vue
git commit -m "feat(web): 左侧「移动」页签重做为「应用市场」"
```

---

### Task 5: 人工验收

**Files:** 无（仅运行）

- [ ] **Step 1: 起开发环境**

后台起服务（异步，日志写 `logs\`）：

```powershell
Start-Process npm.cmd -ArgumentList 'run','dev' -RedirectStandardOutput 'logs\dev-server.log' -RedirectStandardError 'logs\dev-server.err.log' -WindowStyle Hidden
```

访问 http://localhost:5173 。

- [ ] **Step 2: 逐项核对**

- 左侧活动栏出现 `🏪`，悬停提示「应用市场 / App Market」。
- 顶部公告正常（有内容显示 markdown，无内容显示「暂无消息」）。
- 客户端卡片：Windows / macOS(arm64) / macOS(Intel) / Android / iOS；桌面显示版本号；Android/iOS 有二维码；「下载」可点开 releases。
- 扩展区：未入群时显示空态文案；入群/有 `downloads/` 文件时列出，`skill` 行有「安装」按钮，点击后提示「已安装」或失败原因。
- 小工具区：翻译 / YAML / JS / 排序四个工具可打开并使用。
- 底部反馈、B 站教程链接可点。
- 顶栏「中/EN」切换后页面文案即时更新。
- 深浅色主题下样式正常。

- [ ] **Step 3: 最终提交（仅用户要求时）**

按 `docs/learn/git仓库提交检查和提交事项.md` 清单自查后提交。

---

## Self-Review

**Spec coverage：**
- §2 决策 1（图标）→ Task 4 Step 2。
- §2 决策 2（提示）→ Task 2。
- §2 决策 3（rail id 不变）→ Task 4 只改组件与图标，未动 `Rail`/`RAILS`。
- §2 决策 4/5/6/7（三区块 + 数据源）→ Task 3。
- §2 决策 8/9/10（公告保留、反馈/教程底部、删除 hero 等）→ Task 3 组件内容 + Task 4 删旧组件。
- §4.3 纯逻辑 → Task 1。
- §4.4 i18n → Task 2。
- §5 测试/验收 → Task 4 Step 5 + Task 5。

**Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码。

**Type consistency：** `DownloadFile`、`MarketGroups`、`groupDownloadFiles`、`fmtSize`、`installableOf`、`marketKindKey`、`MARKET_CLIENTS` 在 Task 1 定义，Task 1 测试与 Task 3 组件使用一致；`useCollab().listDownloads()` 返回的 `manifest.files` 结构按 `useCollab.ts:91` 的类型使用；`useVersion()` 返回 `{ version, loadVersion }` 按 `useVersion.ts` 使用。
