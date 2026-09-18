# 协作群成员「自己 / 群主」标识 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在协作群右侧成员表和群聊消息两处，同时标识「自己」与「群主」。

**Architecture:** 纯前端增量。成员表复用已有 `hubId` 判定群主，新增 `me` 判定自己并加徽标；群聊消息把 `.who` 改为始终显示用户名，并追加「群主」「我」两个徽标。身份数据全部来自现有 `snap.identity.machineId` 与 `group.hubId`，无需后端改动。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript + Vitest（`@vue/test-utils` + happy-dom），共享 i18n 词条 `shared/i18n/*.js`。

**Spec:** `docs/superpowers/specs/2026-09-18-collab-member-self-owner-badges-design.md`

---

## 前置说明

- `AGENTS.md` 规定：执行实现计划默认 **inline（本会话内执行）**，不使用 subagent；一律在 `master` 操作。
- 提交前执行 `docs/learn/git仓库提交检查和提交事项.md` 的检查清单（敏感信息扫描、`env/` 为空、只暂存本次文件）。
- 命令一律用 `npm.cmd`（PowerShell 5.1，`npm.ps1` 被拦截）。

---

## File Structure

- Modify: `shared/i18n/zh-CN.js` — 新增 `collab.member.me`。
- Modify: `shared/i18n/en.js` — 新增对应英文词条。
- Modify: `web/src/collaboration/MemberUsageTable.vue` — 新增 `me` 与「我」徽标。
- Modify: `web/src/collaboration/MemberUsageTable.test.ts` — 补自身徽标用例。
- Modify: `web/src/collaboration/GroupChatView.vue` — `.who` 显示用户名 + 「群主」「我」徽标。
- Create: `web/src/collaboration/GroupChatView.test.ts` — 群聊身份标识用例。

---

## Task 1: 新增 i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`collab.member.master` 之后）
- Modify: `shared/i18n/en.js`（`collab.member.master` 之后）

- [ ] **Step 1: zh-CN 新增词条**

把 `shared/i18n/zh-CN.js` 中：

```javascript
  'collab.member.master': '群主',
```

改为：

```javascript
  'collab.member.master': '群主',
  'collab.member.me': '我',
```

- [ ] **Step 2: en 新增词条**

把 `shared/i18n/en.js` 中：

```javascript
  'collab.member.master': 'Master',
```

改为：

```javascript
  'collab.member.master': 'Master',
  'collab.member.me': 'Me',
```

- [ ] **Step 3: 校验词条对称**

Run: `npm.cmd run check:i18n`
Expected: 输出 `check-i18n: 未发现中文命中`，无报错。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 新增协作群「我」成员标识词条"
```

---

## Task 2: 成员表标识「自己」

**Files:**
- Test: `web/src/collaboration/MemberUsageTable.test.ts`
- Modify: `web/src/collaboration/MemberUsageTable.vue`

- [ ] **Step 1: 写失败测试**

在 `web/src/collaboration/MemberUsageTable.test.ts` 的 `mount` 辅助函数之后，新增一个可注入 `machineId` 的辅助函数与用例（放在 `describe('MemberUsageTable', ...)` 内、最后一个用例之后）：

```typescript
  function mountWithIdentity(peers: Record<string, CollabUsage>, group: unknown, machineId: string) {
    const snap = { ...EMPTY_SNAPSHOT, group: group as never, identity: { ...EMPTY_SNAPSHOT.identity, machineId } };
    const collab = { state: ref(snap) } as unknown as CollabApi;
    return mountC(MemberUsageTable, { props: { collab, peers, group: group as never }, global: { plugins: [ElementPlus], stubs: { teleport: true } } });
  }

  it('自己所在行显示「我」徽标', async () => {
    const now = Date.now();
    const w = mountWithIdentity(
      { m1: { agent: '*', days: 1, machineId: 'm1', username: 'alice', host: 'h', port: 1, messages: 1, receivedAt: now } },
      { id: 'g', name: 'G', hubId: 'hub2', createdAt: 1, members: [{ machineId: 'm1' }, { machineId: 'hub2' }] },
      'm1',
    );
    await flushPromises();
    expect(w.text()).toContain(t('collab.member.me'));
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/collaboration/MemberUsageTable.test.ts`
Expected: FAIL —— 渲染文本不含「我」（`collab.member.me` 徽标尚未实现）。

- [ ] **Step 3: 实现 `me` 与徽标**

在 `web/src/collaboration/MemberUsageTable.vue` 中，把：

```typescript
const hubId = computed(() => activeGroup.value?.hubId || '');
```

改为：

```typescript
const hubId = computed(() => activeGroup.value?.hubId || '');
const me = computed(() => snap.value.identity.machineId);
```

在模板中，把：

```html
          <span v-if="row.machineId === hubId" class="crown">👑 {{ $t('collab.member.master') }}</span>
          <span class="mname" :title="machineLabel(row)">{{ machineLabel(row) }}</span>
```

改为：

```html
          <span v-if="row.machineId === hubId" class="crown">👑 {{ $t('collab.member.master') }}</span>
          <span v-if="row.machineId === me" class="mebadge">{{ $t('collab.member.me') }}</span>
          <span class="mname" :title="machineLabel(row)">{{ machineLabel(row) }}</span>
```

在 `<style scoped>` 中 `.crown` 规则之后新增：

```css
.mebadge { flex: none; margin-right: 6px; padding: 0 6px; border-radius: 4px; background: var(--ac); color: var(--onac); font-size: 11px; font-weight: 700; line-height: 18px; white-space: nowrap; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/collaboration/MemberUsageTable.test.ts`
Expected: PASS（含新增用例与原有 3 条用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/collaboration/MemberUsageTable.vue web/src/collaboration/MemberUsageTable.test.ts
git commit -m "feat(collab): 成员表标识「自己」"
```

---

## Task 3: 群聊消息标识「自己」与「群主」

**Files:**
- Create: `web/src/collaboration/GroupChatView.test.ts`
- Modify: `web/src/collaboration/GroupChatView.vue`

- [ ] **Step 1: 写失败测试**

新建 `web/src/collaboration/GroupChatView.test.ts`：

```typescript
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { mountC } from '../test-utils';
import GroupChatView from './GroupChatView.vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import type { CollabChatMessage, CollabGroup } from './types';
import { t } from '../i18n';

function mountChat(messages: CollabChatMessage[]) {
  const group: CollabGroup = {
    id: 'g', name: 'G', hubId: 'hub', createdAt: 1,
    members: [
      { machineId: 'me', username: 'alice', host: 'h', port: 1, publicKey: 'k' },
      { machineId: 'hub', username: 'bob', host: 'h', port: 2, publicKey: 'k2' },
    ],
  };
  const snap = { ...EMPTY_SNAPSHOT, identity: { ...EMPTY_SNAPSHOT.identity, machineId: 'me' }, groups: [group], group };
  const collab = {
    state: ref(snap),
    chatState: ref({ g: { messages } }),
    pendingCmdState: ref([]),
    chat: async () => {},
    pullChat: async () => {},
    loadPendingCmds: async () => {},
  } as unknown as CollabApi;
  return mountC(GroupChatView, { props: { collab, groupId: 'g' } });
}

const msg = (over: Partial<CollabChatMessage>): CollabChatMessage => ({
  id: 'x', groupId: 'g', kind: 'text', fromId: 'me', text: 'hi', toId: null, meta: null, ts: 1, seq: 1, ...over,
});

describe('GroupChatView 身份标识', () => {
  it('群主消息显示用户名与群主徽标', async () => {
    const w = mountChat([msg({ id: 'a', fromId: 'hub', text: 'from hub' })]);
    await flushPromises();
    const meta = w.find('.msg .meta');
    expect(meta.text()).toContain('bob');
    expect(meta.text()).toContain(t('collab.member.master'));
  });

  it('自己消息显示用户名与我徽标', async () => {
    const w = mountChat([msg({ id: 'b', fromId: 'me', text: 'from me' })]);
    await flushPromises();
    const meta = w.find('.msg .meta');
    expect(meta.text()).toContain('alice');
    expect(meta.text()).toContain(t('collab.chat.me'));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/collaboration/GroupChatView.test.ts`
Expected: FAIL —— 群主消息不含 `t('collab.member.master')`；自己消息显示「我」而非用户名 `alice`。

- [ ] **Step 3: 实现徽标与用户名显示**

在 `web/src/collaboration/GroupChatView.vue` 中，把：

```typescript
const me = computed(() => snap.value.identity.machineId);
```

改为：

```typescript
const me = computed(() => snap.value.identity.machineId);
const hubId = computed(() => group.value?.hubId || '');
```

在模板中，把：

```html
        <div class="meta">
          <span class="who">{{ isMine(m) ? $t('collab.chat.me') : nameOf(m.fromId) }}</span>
          <span class="time">{{ fmtTime(m.ts) }}</span>
          <span v-if="m.kind === 'system'" class="tag sys">{{ $t('collab.chat.system') }}</span>
        </div>
```

改为：

```html
        <div class="meta">
          <span class="who">{{ nameOf(m.fromId) }}</span>
          <span v-if="m.fromId === hubId" class="tag master">{{ $t('collab.member.master') }}</span>
          <span v-if="isMine(m)" class="tag me">{{ $t('collab.chat.me') }}</span>
          <span class="time">{{ fmtTime(m.ts) }}</span>
          <span v-if="m.kind === 'system'" class="tag sys">{{ $t('collab.chat.system') }}</span>
        </div>
```

在 `<style scoped>` 中，把：

```css
.tag.sys { background: var(--bg5); color: var(--tx2); padding: 0 6px; border-radius: 8px; font-size: 10px; }
```

改为：

```css
.tag { padding: 0 6px; border-radius: 8px; font-size: 10px; }
.tag.sys { background: var(--bg5); color: var(--tx2); }
.tag.master { background: var(--warn); color: #fff; font-weight: 700; }
.tag.me { background: var(--ac); color: var(--onac); font-weight: 700; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/collaboration/GroupChatView.test.ts`
Expected: PASS（2 条用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/collaboration/GroupChatView.vue web/src/collaboration/GroupChatView.test.ts
git commit -m "feat(collab): 群聊消息标识「自己」与「群主」"
```

---

## Task 4: 全量校验

- [ ] **Step 1: 前端测试全量**

Run: `npm.cmd run test:web`
Expected: 全部 PASS。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: `vue-tsc` 无报错。

- [ ] **Step 3: i18n 校验**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 4: 手动验收（dev）**

按 `AGENTS.md` 异步后台起 `npm.cmd run dev`（日志写 `logs\`），访问 http://localhost:5173：
- 右侧成员表：自己行出现蓝色「我」徽标；群主行仍有 `👑群主`。
- 群聊：群主消息显示用户名 + `群主` 徽标；自己的消息显示用户名 + `我` 徽标（气泡仍靠右）。

---

## Self-Review

- **Spec coverage**：成员表自己徽标（Task 2）、群聊用户名+群主/自己徽标（Task 3）、i18n（Task 1）、样式（Task 2/3）、测试（Task 2/3）均有对应任务；非目标未触碰。
- **Placeholder scan**：无 TBD/TODO；所有代码步骤给出完整前后代码。
- **Type consistency**：`me`、`hubId` 命名与 spec 一致；类名 `.mebadge`、`.tag.master`、`.tag.me` 前后一致；i18n 键 `collab.member.me` 一致。
