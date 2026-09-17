# 代码统计：员工分组标签 + 组比率饼图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 本仓库 AGENTS.md：默认 inline 执行。

**Goal:** 两个页签可给作者/A 分组打标签（组名由「分组管理」维护，存服务端 `code-groups.json`），按组算代码行比率并出饼图。

**Architecture:** 新 `server/code-groups.js`（归一化 + 落盘）+ `GET/POST /api/code/groups`（依赖注入 `codeGroups`）；前端 `web/src/codeGroups.ts` 模块级单例状态 + `groupSlices()` 纯函数，`GroupPie.vue`（echarts PieChart）、`GroupManager.vue`（el-dialog），两个页签消费。

**Tech Stack:** Node ESM、Vue3 + Element Plus + echarts（均已在用）、node:test、vitest。

**Spec:** `docs/superpowers/specs/2026-09-16-code-stats-groups-design.md`

---

### Task 1: server —— `code-groups.js`（TDD）

**Files:** Create `server/code-groups.js`、`server/test/code-groups.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeGroups, createCodeGroups, emptyGroups } from '../code-groups.js';

test('normalizeGroups 去空/去重/截断组名/丢弃非法成员', () => {
  const r = normalizeGroups({
    groups: ['A组', ' A组 ', '', 'x'.repeat(50), 'B组'],
    members: { 张三: 'A组', 李四: 'C组', '': 'A组', 王五: 'B组' },
  });
  assert.deepEqual(r.groups, ['A组', 'x'.repeat(40), 'B组']);
  assert.deepEqual(r.members, { 张三: 'A组', 王五: 'B组' });
});

test('normalizeGroups 非法输入 → 空', () => {
  assert.deepEqual(normalizeGroups(null), emptyGroups());
  assert.deepEqual(normalizeGroups('x'), emptyGroups());
  assert.deepEqual(normalizeGroups({ groups: 'x', members: [] }), emptyGroups());
});

test('createCodeGroups 读写往返 + 坏文件回退空', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfgrp-')), 'code-groups.json');
  const store = createCodeGroups({ file });
  assert.deepEqual(store.read(), emptyGroups());
  store.write({ groups: ['A组'], members: { 张三: 'A组' } });
  assert.deepEqual(createCodeGroups({ file }).read(), { groups: ['A组'], members: { 张三: 'A组' } });

  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createCodeGroups({ file }).read(), emptyGroups());
});

test('createCodeGroups 无 file 时纯内存', () => {
  const store = createCodeGroups({});
  store.write({ groups: ['A组'], members: {} });
  assert.deepEqual(store.read(), { groups: ['A组'], members: {} });
});
```

- [ ] **Step 2: 运行确认失败**：`node --test server/test/code-groups.test.js`

- [ ] **Step 3: 实现 `server/code-groups.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

export const MAX_GROUPS = 50;
export const MAX_GROUP_NAME_LEN = 40;

export function emptyGroups() { return { groups: [], members: {} }; }

// 归一化：组名去空/去重/截断/限量；成员只保留「有名字且在组内」的项
export function normalizeGroups(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const groups = [];
  for (const raw of Array.isArray(src.groups) ? src.groups : []) {
    const g = String(raw ?? '').trim().slice(0, MAX_GROUP_NAME_LEN);
    if (!g || groups.includes(g)) continue;
    groups.push(g);
    if (groups.length >= MAX_GROUPS) break;
  }
  const members = {};
  const srcMembers = src.members && typeof src.members === 'object' && !Array.isArray(src.members) ? src.members : {};
  for (const [k, v] of Object.entries(srcMembers)) {
    const key = String(k ?? '').trim();
    const g = String(v ?? '').trim();
    if (!key || !g || !groups.includes(g)) continue;
    members[key] = g;
  }
  return { groups, members };
}

export function createCodeGroups({ file = null, logger = console } = {}) {
  const load = () => {
    if (!file || !fs.existsSync(file)) return emptyGroups();
    try {
      return normalizeGroups(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      logger?.warn?.('code-groups load failed', (e && e.message) || e);
      return emptyGroups();
    }
  };
  let data = load();
  const save = () => {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      logger?.warn?.('code-groups save failed', (e && e.message) || e);
    }
  };
  return {
    read: () => data,
    write: (next) => { data = normalizeGroups(next); save(); return data; },
  };
}
```

- [ ] **Step 4: 运行确认通过**

---

### Task 2: server —— 路径 + 装配 + 路由（TDD）

**Files:** Modify `server/port-paths.js`、`server/test/port-paths.test.js`、`server/index.js`、`server/http-api.js`、`server/test/http-api.test.js`

- [ ] **Step 1: 路径与装配**

`server/port-paths.js` 的返回对象加：

```js
    codeGroupsFile: path.join(dir, 'code-groups.json'),
```

`server/test/port-paths.test.js` 加一行断言：

```js
  assert.equal(p.codeGroupsFile, path.join(base, 'code-groups.json'));
```

`server/index.js`：import 追加 `import { createCodeGroups } from './code-groups.js';`；在 `const projects = new Projects(...)` 附近加：

```js
  const codeGroups = createCodeGroups({ file: paths.codeGroupsFile, logger: log });
```

`createHttpApi(...)` 调用加参数：

```js
  const httpApi = createHttpApi({ projects, saveProjects, logger: log, repoRoot: path.join(__dirname, '..'), codeGroups });
```

- [ ] **Step 2: 写失败测试**（`http-api.test.js` 末尾）

```js
test('/api/code/groups GET 默认空、POST 保存后读回', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const empty = await request(server, '/api/code/groups');
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), { groups: [], members: {} });

  const r = await post(server, '/api/code/groups', { groups: ['A组', 'A组', ''], members: { 张三: 'A组', 李四: 'B组' } });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { groups: ['A组'], members: { 张三: 'A组' } });

  const again = await request(server, '/api/code/groups');
  assert.deepEqual(JSON.parse(again.body), { groups: ['A组'], members: { 张三: 'A组' } });
});
```

- [ ] **Step 3: 实现路由**

`server/http-api.js`：import 追加：

```js
import { createCodeGroups } from './code-groups.js';
```

签名加参数：

```js
export function createHttpApi({ projects, saveProjects = null, logger = console, repoRoot = process.cwd(), codeGroups = createCodeGroups({}) }) {
```

`/api/code/stats` 分支之前加：

```js
      if (url.pathname === '/api/code/groups' && req.method === 'GET') {
        sendJson(res, 200, codeGroups.read());
        return;
      }
      if (url.pathname === '/api/code/groups' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, codeGroups.write(body));
        return;
      }
```

- [ ] **Step 4: 运行确认通过**：`node --test server/test/port-paths.test.js server/test/http-api.test.js`

---

### Task 3: web —— `codeGroups.ts`（TDD）

**Files:** Create `web/src/codeGroups.ts`、`web/src/codeGroups.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { groupSlices } from './codeGroups';

describe('groupSlices', () => {
  it('按成员分组求和并降序', () => {
    const rows = [{ key: 'Ann', value: 10 }, { key: 'Bob', value: 5 }, { key: 'Cat', value: 7 }];
    expect(groupSlices(rows, { Ann: 'A组', Cat: 'A组', Bob: 'B组' })).toEqual([
      { name: 'A组', value: 17 }, { name: 'B组', value: 5 },
    ]);
  });
  it('未归属归到空名并排最后，值为 0 的仍保留', () => {
    const rows = [{ key: 'Ann', value: 10 }, { key: 'Dan', value: 3 }];
    expect(groupSlices(rows, { Ann: 'A组' })).toEqual([{ name: 'A组', value: 10 }, { name: '', value: 3 }]);
  });
  it('空输入返回空数组', () => {
    expect(groupSlices([], {})).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npm.cmd --prefix web run test`

- [ ] **Step 3: 实现 `web/src/codeGroups.ts`**

```ts
import { ref } from 'vue';

export interface CodeGroups { groups: string[]; members: Record<string, string>; }

const groups = ref<string[]>([]);
const members = ref<Record<string, string>>({});
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function fetchGroups(): Promise<CodeGroups> {
  const res = await fetch('/api/code/groups');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CodeGroups>;
}

async function putGroups(data: CodeGroups): Promise<CodeGroups> {
  const res = await fetch('/api/code/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CodeGroups>;
}

// 纯函数：把 [{key,value}] 按成员归属汇总成饼图数据；未归属 name=''
export function groupSlices(items: { key: string; value: number }[], map: Record<string, string>): { name: string; value: number }[] {
  const acc = new Map<string, number>();
  for (const it of items) {
    const name = map[it.key] || '';
    acc.set(name, (acc.get(name) || 0) + it.value);
  }
  return [...acc.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => (a.name === '') === (b.name === '') ? b.value - a.value : (a.name === '' ? 1 : -1));
}

export function useCodeGroups() {
  async function load(force = false) {
    if (loaded && !force) return;
    try {
      const d = await fetchGroups();
      groups.value = d.groups || [];
      members.value = d.members || {};
      loaded = true;
    } catch { /* 保留现状 */ }
  }

  async function save() {
    const d = await putGroups({ groups: groups.value, members: members.value });
    groups.value = d.groups || [];
    members.value = d.members || {};
    return d;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void save().catch(() => { /* ignore */ }); }, 400);
  }

  function addGroup(name: string) {
    const g = name.trim();
    if (!g || groups.value.includes(g)) return false;
    groups.value = [...groups.value, g];
    scheduleSave();
    return true;
  }

  function removeGroup(name: string) {
    groups.value = groups.value.filter((g) => g !== name);
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(members.value)) if (v !== name) next[k] = v;
    members.value = next;
    scheduleSave();
  }

  function assign(author: string, group: string) {
    const next = { ...members.value };
    if (group) next[author] = group; else delete next[author];
    members.value = next;
    scheduleSave();
  }

  return { groups, members, load, save, addGroup, removeGroup, assign, groupOf: (a: string) => members.value[a] || '' };
}
```

- [ ] **Step 4: 运行确认通过**

---

### Task 4: web —— `GroupPie.vue` + `GroupManager.vue`

**Files:** Create `web/src/components/GroupPie.vue`、`web/src/components/GroupManager.vue`

- [ ] **Step 1: `GroupPie.vue`**（照 `web/src/collaboration/UsageTrendChart.vue` 的 echarts 用法）

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '../theme';
import { t } from '../i18n';

echarts.use([PieChart, TooltipComponent, LegendComponent, CanvasRenderer]);

const props = defineProps<{ slices: { name: string; value: number }[]; title?: string }>();
const { isDark } = useTheme();
const el = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

const label = (name: string) => (name ? name : t('codestat.groups.ungrouped'));

function draw() {
  if (!el.value || !props.slices.length) return;
  if (!chart) chart = echarts.init(el.value, isDark.value ? 'dark' : null);
  chart.setOption({
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${p.value} (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: isDark.value ? '#8b96a5' : '#6b7280', fontSize: 11 } },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '42%'],
      data: props.slices.map((s) => ({ name: label(s.name), value: s.value })),
      label: { formatter: '{b} {d}%', fontSize: 11 },
    }],
  }, true);
  chart.resize();
}

onMounted(async () => { await nextTick(); draw(); });
watch(() => [props.slices, isDark.value], async () => { await nextTick(); draw(); }, { deep: true });
function onResize() { chart?.resize(); }
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); chart?.dispose(); chart = null; });
</script>

<template>
  <section v-if="slices.length" class="pie">
    <h3 v-if="title" class="sub">{{ title }}</h3>
    <div ref="el" class="chart" />
  </section>
</template>

<style scoped>
.pie { margin: 8px 0 12px; }
.sub { color: var(--tx1); font-size: 13px; margin: 4px 0 6px; }
.chart { height: 240px; }
</style>
```

- [ ] **Step 2: `GroupManager.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useCodeGroups } from '../codeGroups';
import { t } from '../i18n';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const { groups, addGroup, removeGroup, save } = useCodeGroups();
const draft = ref('');
const msg = ref('');

function onAdd() {
  if (!addGroup(draft.value)) { msg.value = t('codestat.groups.dup'); return; }
  draft.value = '';
  msg.value = '';
}
async function onSave() {
  try { await save(); emit('close'); } catch (e: any) { msg.value = t('codestat.groups.save_failed', { msg: e?.message || String(e) }); }
}
</script>

<template>
  <el-dialog :model-value="open" :title="$t('codestat.groups.title')" width="420px" @close="emit('close')">
    <div class="row">
      <input v-model="draft" class="ginput" :placeholder="$t('codestat.groups.placeholder')" @keyup.enter="onAdd" />
      <button class="btn" @click="onAdd">{{ $t('codestat.groups.add') }}</button>
    </div>
    <ul class="glist">
      <li v-for="g in groups" :key="g">
        <span>{{ g }}</span>
        <button class="rm" @click="removeGroup(g)">✕</button>
      </li>
    </ul>
    <div v-if="!groups.length" class="hint">{{ $t('codestat.groups.empty') }}</div>
    <div v-if="msg" class="err">{{ msg }}</div>
    <template #footer>
      <button class="btn ghost" @click="emit('close')">{{ $t('common.cancel') }}</button>
      <button class="btn primary" @click="onSave">{{ $t('common.ok') }}</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.row { display: flex; gap: 8px; }
.ginput { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; font-size: 13px; }
.glist { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.glist li { display: flex; align-items: center; justify-content: space-between; background: var(--bg2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 10px; font-size: 13px; color: var(--tx); }
.rm { background: none; border: none; color: var(--tx3); cursor: pointer; }
.rm:hover { color: var(--err); }
.hint { color: var(--tx4); font-size: 12px; margin-top: 8px; }
.err { color: var(--err); font-size: 12px; margin-top: 8px; }
.btn { background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.btn:hover { color: var(--tx1); border-color: var(--ac); }
.btn.primary { background: var(--ac); color: var(--onac); border: none; font-weight: 600; }
.btn.ghost { background: none; }
</style>
```

- [ ] **Step 3:** `npm.cmd run typecheck` → 0

---

### Task 5: web —— 页面接线（Git 页签饼图、实代码按作者表 + 饼图、分组管理入口）

**Files:** Modify `web/src/components/CodeStats.vue`、`GitStat.vue`、`GitAuthorTable.vue`、`RealCodeStat.vue`

- [ ] **Step 1: `CodeStats.vue`**

- import：`import GroupManager from './GroupManager.vue';`、`import { useCodeGroups } from '../codeGroups';`
- `const groupOpen = ref(false);`、`const { load: loadGroups } = useCodeGroups();`，`onMounted` 里 `void loadGroups();`
- 共享过滤行加按钮：

```html
        <button class="add" @click="groupOpen = true">{{ $t('codestat.groups.manage') }}</button>
```

- 模板末尾（pick 弹窗旁）加：

```html
    <GroupManager :open="groupOpen" @close="groupOpen = false" />
```

- [ ] **Step 2: `GitAuthorTable.vue`**

- import `useCodeGroups`；`const { groups, groupOf, assign } = useCodeGroups();`，`onMounted(() => void load())`（从 `useCodeGroups()` 取 `load` 调一次）。
- 表头加 `<th>{{ $t('codestat.groups.col') }}</th>`；行加：

```html
          <td class="group">
            <select class="gsel" :value="groupOf(r.author)" @change="(e) => assign(r.author, (e.target as HTMLSelectElement).value)">
              <option value="">{{ $t('codestat.groups.ungrouped') }}</option>
              <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
            </select>
          </td>
```

- 样式：`.gsel { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 6px; font-size: 12px; }`

- [ ] **Step 3: `GitStat.vue`** 饼图

- import：`import GroupPie from './GroupPie.vue';`、`import { useCodeGroups, groupSlices } from '../codeGroups';`
- `const { members, load: loadGroups } = useCodeGroups();`，`onMounted` 里追加 `void loadGroups();`
- computed：

```ts
const pieSlices = computed(() => groupSlices(authorRows.value.map((r) => ({ key: r.author, value: r.linesAdded })), members.value));
```

- 模板 `GitAuthorTable` 之后加 `<GroupPie :slices="pieSlices" :title="$t('codestat.groups.by_group')" />`

- [ ] **Step 4: `RealCodeStat.vue`** 按首次提交人表 + 饼图

- import：`import GroupPie from './GroupPie.vue';`、`import { useCodeGroups, groupSlices } from '../codeGroups';`
- `const { groups, members, groupOf, assign, load: loadGroups } = useCodeGroups();`，`onMounted(() => void loadGroups());`
- computed：

```ts
const totalReal = computed(() => okResults.value.reduce((s, r) => s + r.totals.real, 0));

// 按首次提交人聚合实代码行（无首次作者 → 未知作者）
const authorRows = computed(() => {
  const acc = new Map<string, number>();
  for (const e of okResults.value) {
    for (const f of e.result ? e.result.files : []) {
      const who = f.firstAuthor || '';
      acc.set(who, (acc.get(who) || 0) + f.real);
    }
  }
  return [...acc.entries()]
    .map(([author, real]) => ({ author, real, pct: totalReal.value ? (real / totalReal.value) * 100 : 0 }))
    .sort((a, b) => b.real - a.real);
});

const pieSlices = computed(() => groupSlices(authorRows.value.map((r) => ({ key: r.author, value: r.real })), members.value));
```

> 上面 `e.result ? e.result.files : []` 应简化为 `e.result?.files || []`；`okResults` 已是只含成功的 result，直接遍历 `okResults.value` 的 `r.files`。

- 模板在总卡片之后加「按首次提交人」表（作者 | 实代码行 | 占比 | 组下拉，未知作者显示 `—` 且 `assign` 用空 key 时不渲染下拉），再接 `<GroupPie :slices="pieSlices" :title="$t('codestat.groups.by_group')" />`。

- [ ] **Step 5:** `npm.cmd run typecheck` → 0

---

### Task 6: i18n

**Files:** Modify `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] 新增（中英同步）：

```js
// zh-CN
'codestat.groups.manage': '分组管理',
'codestat.groups.title': '分组管理',
'codestat.groups.placeholder': '输入组名，回车添加',
'codestat.groups.add': '添加',
'codestat.groups.empty': '还没有分组',
'codestat.groups.dup': '组名重复或为空',
'codestat.groups.save_failed': '保存失败：{msg}',
'codestat.groups.col': '组',
'codestat.groups.ungrouped': '未分组',
'codestat.groups.unknown_author': '未知作者',
'codestat.groups.by_group': '按组比率',
'codestat.author_title': '按首次提交人统计',
// en
'codestat.groups.manage': 'Manage groups',
'codestat.groups.title': 'Manage groups',
'codestat.groups.placeholder': 'Group name, press Enter to add',
'codestat.groups.add': 'Add',
'codestat.groups.empty': 'No groups yet',
'codestat.groups.dup': 'Duplicate or empty group name',
'codestat.groups.save_failed': 'Save failed: {msg}',
'codestat.groups.col': 'Group',
'codestat.groups.ungrouped': 'Ungrouped',
'codestat.groups.unknown_author': 'Unknown author',
'codestat.groups.by_group': 'Share by group',
'codestat.author_title': 'By first author',
```

- [ ] `npm.cmd run check:i18n` → 0

---

### Task 7: 验证

- [ ] `node --test server/test/code-groups.test.js server/test/port-paths.test.js server/test/http-api.test.js`
- [ ] `npm.cmd run test:server`、`npm.cmd --prefix web run test`
- [ ] `npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web`
- [ ] 手工：分组管理加「A组/B组」→ 作者表选组 → 饼图按组出比率且含「未分组」；实代码页签按首次提交人同样出组比率；刷新/重启后端后分组仍在（文件 `<数据目录>/code-groups.json`）。

---

### Task 8: 过滤值服务端持久化 + 后缀/排除补齐（同日追加）

**Files:** Create `server/json-store.js`、`server/code-prefs.js`、`server/test/code-prefs.test.js`、`web/src/codePrefs.ts`、`web/src/codePrefs.test.ts`；Modify `server/code-groups.js`（改用通用 store）、`server/port-paths.js`、`server/test/port-paths.test.js`、`server/index.js`、`server/http-api.js`、`server/test/http-api.test.js`、`web/src/components/CodeStats.vue`、`web/src/components/GitStat.vue`、`shared/git-filter.js`、`shared/git-filter.d.ts`、`scripts/count-code.js`、`server/test/code-count.test.js`

- [ ] `server/json-store.js`：`createJsonStore({file,logger,normalize,defaults})` → `{read,write}`；`code-groups.js` 改为调用它（对外 API 不变，测试保持通过）。
- [ ] `server/code-prefs.js` + 测试：`normalizeCodePrefs` 只留 `exts/excludeDirs/hugeCommitLimit`（字符串截断 4000）+ `excludeTestFiles/codeOnly`（布尔）；`createCodePrefs`。
- [ ] `port-paths.js` 增 `codePrefsFile`（含测试）；`index.js` 装配 `createCodePrefs` 并随 `createCodeApi` 注入；`http-api.js` 增 `GET/POST /api/code/prefs`（含 http 测试）。
- [ ] `web/src/codePrefs.ts`（`defaultPrefs`/`mergePrefs`/`useCodePrefs` + 深度 watch 去抖 500ms）+ 单测（默认含 `.sql/.xml`、`node_modules`）。
- [ ] `CodeStats.vue`：移除 ext/excludeDirs/excludeTestFiles 的 localStorage 与对应 watch，改绑 `prefs.*`；`onMounted` 调 `loadPrefs()`/`loadGroups()`。
- [ ] `GitStat.vue`：移除 `codeOnly`/`hugeLimitText` 的 localStorage（含 `nodeFp` 依赖），改绑 `prefs.codeOnly`/`prefs.hugeCommitLimit`。
- [ ] `shared/git-filter.js`：`DEFAULT_CODE_EXTS` 补 `.xml`；`DEFAULT_EXCLUDE_DIRS` 补 `node_modules`；新增 `SKIP_BASENAMES` 并在 `makeKeepPath` 内置排除；`.d.ts` 声明 `SKIP_BASENAMES`。
- [ ] `scripts/count-code.js`：`EXT` 补 `.sql`、`.xml`。
- [ ] `server/test/code-count.test.js`：清单/锁文件即使后缀含 `.json/.yaml/.lock` 也排除。
- [ ] 验证：`npm.cmd run test:server`、`npm.cmd --prefix web run test`、`typecheck`、`check:i18n`、`build:web`。

## Self-Review

- 存储服务端 + 同端口共享（Task 1/2，spec 决策 4）。
- 两页签共用一份分组、按作者名匹配（Task 3 的 `groupSlices` 用 `members[key]`；Task 5 两页签都调 `useCodeGroups()`）。
- 组管理先定义后下拉（Task 4 `GroupManager` + Task 5 下拉）。
- 口径：Git=linesAdded、实代码=real（Task 5）。
- 未分组/未知作者单独成片（`groupSlices` 返回 `name: ''` → `GroupPie` 显示「未分组」）。
- 单组、无历史趋势（spec 第 5 节）。
- 过滤值服务端持久化与后缀/排除补齐 → Task 8（spec 第 8 节）。
- i18n 中英同步（Task 6）。
