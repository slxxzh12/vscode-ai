# Navicat 连接选择改下拉框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 Navicat 小工具左侧连接列表，改为顶部可搜索下拉框选连接；选中连接自动填充完整信息（含已保存密码）；「＋ 新建连接 / ↩ 取消新建」作为下拉末项，新建态下再选已有连接即作为模板填充。

**Architecture:** 纯前端改动。`NavicatTool.vue` 内部维护 `mode: 'edit'|'new'` 与 `selectedId`，用 `el-select`（`@change="onSelectChange"`）驱动三种行为：编辑载入、进入/退出新建态、模板填充。后端 `/api/navicat/*` 与 `useNavicat.ts` 数据层零改动。左栏组件 `NavicatList.vue` 及其测试删除。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Element Plus（`el-select`/`el-option`/`el-input`/`ElMessageBox`）、vitest + @vue/test-utils（happy-dom）。

---

## File Structure

- Modify: `shared/i18n/zh-CN.js` — 新增 `nv.select_ph`、`nv.template_ph`、`nv.cancel_new`。
- Modify: `shared/i18n/en.js` — 同上英文。
- Modify: `web/src/tools/navicat/NavicatTool.vue` — 顶部下拉框 + 三态逻辑；移除左栏与 `.nv-reveal`。
- Modify: `web/src/tools/navicat/NavicatTool.test.ts` — 用下拉交互重写用例。
- Delete: `web/src/tools/navicat/NavicatList.vue`。
- Delete: `web/src/tools/navicat/NavicatList.test.ts`。

不改动：`web/src/tools/navicat/useNavicat.ts`、所有 `server/navicat-*.js`。

---

## Task 1: i18n 新增词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:776`
- Modify: `shared/i18n/en.js:776`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 中，把：

```js
  'nv.empty': '暂无连接',
  'nv.name': '名称',
```

改为：

```js
  'nv.empty': '暂无连接',
  'nv.select_ph': '选择连接',
  'nv.template_ph': '选择模板（可选）',
  'nv.cancel_new': '取消新建',
  'nv.name': '名称',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 中，把：

```js
  'nv.empty': 'No connections',
  'nv.name': 'Name',
```

改为：

```js
  'nv.empty': 'No connections',
  'nv.select_ph': 'Select connection',
  'nv.template_ph': 'Pick a template (optional)',
  'nv.cancel_new': 'Cancel new',
  'nv.name': 'Name',
```

- [ ] **Step 3: 校验中英键集合对称**

Run: `npm.cmd run check:i18n`
Expected: 无错误输出（退出码 0）。

- [ ] **Step 4: Commit**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(navicat): 新增下拉选择/模板/取消新建词条"
```

---

## Task 2: 重写 NavicatTool 测试（先失败）

**Files:**
- Modify: `web/src/tools/navicat/NavicatTool.test.ts`（整文件替换）

- [ ] **Step 1: 用下方内容整体替换测试文件**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { mountC } from '../../test-utils';
import NavicatTool from './NavicatTool.vue';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const P = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: true };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  return mountC(NavicatTool, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

function pick(w: any, value: string) {
  return w.findComponent('.nv-conn').vm.$emit('change', value);
}

describe('NavicatTool', () => {
  it('下拉可选连接：填充表单并 reveal 已保存密码', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(String(u));
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: 'pw' });
      return okJson({});
    }));
    const w = mount();
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    expect((w.find('.nv-name-input input').element as HTMLInputElement).value).toBe('A');
    expect(calls).toContain('/api/navicat/reveal');
    expect((w.find('.nv-pw input').element as HTMLInputElement).value).toBe('pw');
  });

  it('执行读语句渲染结果表格', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: '' });
      return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
    }));
    const w = mount();
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    await w.find('.nv-sql').setValue('SELECT 1');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(w.find('.nv-table').exists()).toBe(true);
    expect(w.find('.nv-table').text()).toContain('1');
  });

  it('写语句先弹确认，确认后执行', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: '' });
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (b.confirm) return okJson({ ok: true, result: { columns: [], rows: [], affected: 1, truncated: false, durationMs: 1 } });
      return okJson({ needConfirm: true, kind: 'write' });
    }));
    const w = mount();
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    await w.find('.nv-sql').setValue('INSERT INTO t VALUES (1)');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(w.find('.nv-meta').text()).toContain('1');
  });

  it('新建态选模板填充字段，保存走 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method]);
      if (String(u) === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: 'pw' });
      return okJson({ ok: true, item: { ...P, id: '2', name: 'B' } });
    }));
    const w = mount();
    await flushPromises();
    pick(w, '__new__');
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    expect((w.find('.nv-host input').element as HTMLInputElement).value).toBe('h');
    expect((w.find('.nv-pw input').element as HTMLInputElement).value).toBe('pw');
    await w.find('.nv-name-input input').setValue('B');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'POST')).toBe(true);
  });

  it('编辑态保存走 PATCH', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method]);
      if (String(u) === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: '' });
      return okJson({ ok: true, item: P });
    }));
    const w = mount();
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    await w.find('.nv-name-input input').setValue('A2');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'PATCH')).toBe(true);
  });

  it('重命名/删除按钮仅编辑已保存连接时出现', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: '' });
      return okJson({});
    }));
    const w = mount();
    await flushPromises();
    expect(w.find('.nv-rename').exists()).toBe(false);
    pick(w, '1');
    await flushPromises();
    expect(w.find('.nv-rename').exists()).toBe(true);
    expect(w.find('.nv-del').exists()).toBe(true);
    pick(w, '__new__');
    await flushPromises();
    expect(w.find('.nv-rename').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败（组件尚未改造）**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTool.test.ts`
Expected: FAIL —— 例如 `findComponent('.nv-conn')` 找不到（组件还是旧的 `.nv-row` 布局）。

---

## Task 3: 改造 NavicatTool.vue 使其通过

**Files:**
- Modify: `web/src/tools/navicat/NavicatTool.vue`（整文件替换）

- [ ] **Step 1: 用下方内容整体替换组件**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { useNavicat, type ExecResult, type NavicatProfile, type NavicatType } from './useNavicat';

const { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx } = useNavicat();

const TYPES: NavicatType[] = ['mysql', 'postgres', 'sqlite', 'redis'];
const NEW_SENTINEL = '__new__';

const form = ref<NavicatProfile>(blank());
const sql = ref('');
const busy = ref(false);
const testing = ref(false);
const msg = ref('');
const result = ref<ExecResult | null>(null);
const mode = ref<'edit' | 'new'>('edit');
const selectedId = ref('');

function blank(): NavicatProfile {
  return { name: '', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: '', password: '' };
}

const isSqlite = computed(() => form.value.type === 'sqlite');
const isRedis = computed(() => form.value.type === 'redis');
const dbLabel = computed(() => (isSqlite.value ? t('nv.database') : isRedis.value ? t('nv.db_index') : t('nv.database')));
const selectPlaceholder = computed(() => (mode.value === 'new' ? t('nv.template_ph') : t('nv.select_ph')));
const sentinelLabel = computed(() => (mode.value === 'new' ? t('nv.cancel_new') : t('nv.new')));
const showActions = computed(() => mode.value === 'edit' && !!form.value.id);

function defaultPort(type: NavicatType): string {
  return type === 'mysql' ? '3306' : type === 'postgres' ? '5432' : type === 'redis' ? '6379' : '';
}

function onTypeChange() {
  if (!form.value.port || ['3306', '5432', '6379', ''].includes(form.value.port)) form.value.port = defaultPort(form.value.type);
}

function resetOutput() {
  result.value = null;
  msg.value = '';
}

async function selectProfile(id: string) {
  const p = profiles.value.find((x) => x.id === id);
  if (!p) return;
  mode.value = 'edit';
  selectedId.value = id;
  form.value = { ...blank(), ...p, password: '' };
  resetOutput();
  if (p.hasPassword) {
    try { form.value.password = await reveal(id); } catch { /* ignore */ }
  }
}

function newProfile() {
  mode.value = 'new';
  selectedId.value = '';
  form.value = blank();
  resetOutput();
}

function cancelNew() {
  mode.value = 'edit';
  selectedId.value = '';
  form.value = blank();
  resetOutput();
}

async function applyTemplate(id: string) {
  const p = profiles.value.find((x) => x.id === id);
  if (!p) return;
  selectedId.value = '';
  form.value = { ...blank(), ...p, id: undefined, name: '', password: '' };
  resetOutput();
  if (p.hasPassword) {
    try { form.value.password = await reveal(id); } catch { /* ignore */ }
  }
}

function onSelectChange(id: string) {
  if (id === NEW_SENTINEL) {
    if (mode.value === 'new') cancelNew(); else newProfile();
    return;
  }
  if (mode.value === 'new') void applyTemplate(id);
  else void selectProfile(id);
}

async function doSave() {
  if (!form.value.name.trim()) { msg.value = t('nv.required_name'); return; }
  busy.value = true; msg.value = '';
  try {
    const saved = await save({ ...form.value });
    form.value = { ...form.value, id: saved.id, hasPassword: saved.hasPassword, password: '' };
    selectedId.value = saved.id || '';
    mode.value = 'edit';
    msg.value = t('nv.saved');
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function doTest() {
  testing.value = true; msg.value = '';
  try {
    if (form.value.id && !form.value.password) await test({ id: form.value.id });
    else await test({ profile: form.value });
    msg.value = t('nv.test_ok');
  } catch (e) { msg.value = (e as Error).message; } finally { testing.value = false; }
}

async function doExec() {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  if (!sql.value.trim()) return;
  busy.value = true; msg.value = '';
  try {
    let out = await exec(form.value.id, sql.value);
    if (out.needConfirm) {
      try {
        await ElMessageBox.confirm(t('nv.confirm_write'), t('nv.confirm_title'), { type: 'warning' });
      } catch { busy.value = false; return; }
      out = await exec(form.value.id, sql.value, true);
    }
    result.value = out.result || null;
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function copyConn(withPassword: boolean) {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  try {
    const text = await connstr(form.value.id, withPassword);
    await navigator.clipboard.writeText(text);
    msg.value = t('nv.copied');
  } catch (e) { msg.value = (e as Error).message; }
}

async function doExport() {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  try {
    const xml = await exportNcx([form.value.id]);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'navicat.ncx';
    a.click();
    URL.revokeObjectURL(a.href);
    msg.value = t('nv.exported');
  } catch (e) { msg.value = (e as Error).message; }
}

async function onRename(id: string) {
  try {
    const res = await ElMessageBox.prompt(t('nv.rename'), t('nv.rename_ph'), { inputValue: profiles.value.find((p) => p.id === id)?.name || '' }) as any;
    if (res?.value) await rename(id, res.value);
  } catch { /* cancelled */ }
}

async function onRemove(id: string) {
  try {
    await ElMessageBox.confirm(t('nv.delete_confirm'), t('nv.delete'), { type: 'warning' });
  } catch { return; }
  await remove(id);
  if (form.value.id === id) newProfile();
}

function exportCsv() {
  if (!result.value) return;
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [result.value.columns.map(esc).join(',')];
  for (const row of result.value.rows) lines.push(row.map(esc).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'result.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="nvbody">
    <div class="nvtop">
      <el-select
        v-model="selectedId"
        class="nv-conn"
        size="small"
        filterable
        :placeholder="selectPlaceholder"
        @change="onSelectChange"
      >
        <el-option v-for="p in profiles" :key="p.id" :value="p.id" :label="p.name">
          <span class="nv-badge">{{ p.type }}</span>
          <span>{{ p.name }}</span>
        </el-option>
        <el-option :value="NEW_SENTINEL" :label="sentinelLabel" />
      </el-select>
      <button v-if="showActions" class="nvbtn nv-rename" @click="onRename(form.id!)">{{ $t('nv.rename') }}</button>
      <button v-if="showActions" class="nvbtn nv-del" @click="onRemove(form.id!)">{{ $t('nv.delete') }}</button>
    </div>

    <div class="nvform">
      <el-input v-model="form.name" class="nv-name-input" size="small" :placeholder="$t('nv.name')" />
      <select v-model="form.type" class="nv-type" @change="onTypeChange">
        <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
      </select>
      <template v-if="!isSqlite">
        <el-input v-model="form.host" size="small" class="nv-host" :placeholder="$t('nv.host')" />
        <el-input v-model="form.port" size="small" class="nv-port" :placeholder="$t('nv.port')" />
        <el-input v-if="!isRedis" v-model="form.user" size="small" class="nv-user" :placeholder="$t('nv.user')" />
        <div v-if="!isRedis" class="nv-pw">
          <el-input v-model="form.password" size="small" type="password" show-password :placeholder="form.hasPassword && !form.password ? '••••••' : $t('nv.password')" />
        </div>
      </template>
      <el-input v-model="form.database" size="small" class="nv-db" :placeholder="dbLabel" />
      <div class="nvactions">
        <button class="nvbtn primary nv-save" :disabled="busy" @click="doSave">{{ $t('nv.save') }}</button>
        <button class="nvbtn nv-test" :disabled="testing" @click="doTest">{{ testing ? $t('nv.testing') : $t('nv.test') }}</button>
        <button class="nvbtn nv-copy" @click="copyConn(false)">{{ $t('nv.copy_connstr') }}</button>
        <button class="nvbtn nv-copy-pw" @click="copyConn(true)">{{ $t('nv.copy_with_pw') }}</button>
        <button class="nvbtn nv-export" @click="doExport">{{ $t('nv.export_ncx') }}</button>
      </div>
    </div>

    <div v-if="msg" class="nvmsg">{{ msg }}</div>

    <textarea v-model="sql" class="nv-sql" :placeholder="$t('nv.sql_ph')" spellcheck="false" />

    <div class="nvresbar">
      <button class="nvbtn primary nv-run" :disabled="busy" @click="doExec">{{ busy ? $t('nv.running') : $t('nv.exec') }}</button>
      <button class="nvbtn" @click="sql = ''; result = null; msg = ''">{{ $t('nv.clear') }}</button>
      <span class="nv-meta">
        <template v-if="result">
          <span v-if="result.truncated">{{ $t('nv.truncated', { n: result.rows.length }) }} · </span>
          <span v-if="result.affected !== null">{{ $t('nv.affected', { n: result.affected }) }} · </span>
          <span>{{ $t('nv.duration', { ms: result.durationMs }) }}</span>
        </template>
      </span>
      <button v-if="result && result.columns.length" class="nvbtn nvexport" style="margin-left:auto" @click="exportCsv">CSV</button>
    </div>

    <div class="nvresult">
      <table v-if="result && result.columns.length" class="nv-table">
        <thead><tr><th v-for="c in result.columns" :key="c">{{ c }}</th></tr></thead>
        <tbody><tr v-for="(row, i) in result.rows" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></tbody>
      </table>
      <pre v-else-if="result && result.raw" class="nv-raw">{{ result.raw }}</pre>
      <div v-else class="nv-noresult">{{ $t('nv.no_result') }}</div>
    </div>
  </div>
</template>

<style scoped>
.nvbody { display: flex; flex-direction: column; gap: 8px; height: calc(100vh - 150px); }
.nvtop { display: flex; align-items: center; gap: 6px; }
.nv-conn { width: 240px; }
.nv-badge { font-size: 10px; color: var(--tx4); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; margin-right: 6px; text-transform: uppercase; }
.nvform { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.nv-name-input { width: 150px; }
.nv-type { width: 110px; height: 28px; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 0 6px; font-size: 13px; }
.nv-type:focus { outline: none; border-color: var(--ac2); }
.nv-host { width: 140px; }
.nv-port { width: 80px; }
.nv-user { width: 100px; }
.nv-db { width: 170px; }
.nv-pw { display: flex; gap: 4px; align-items: center; width: 190px; }
.nvform .el-input { flex: none; }
.nvactions { display: flex; flex-wrap: wrap; gap: 6px; }
.nvbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.nvbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.nvbtn:disabled { opacity: .55; cursor: default; }
.nvmsg { color: var(--tx3); font-size: 12px; }
.nv-sql { flex: none; min-height: 110px; resize: vertical; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.nv-sql:focus { outline: none; border-color: var(--ac2); }
.nvresbar { display: flex; gap: 8px; align-items: center; }
.nv-meta { color: var(--tx4); font-size: 12px; }
.nvresult { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.nv-table { border-collapse: collapse; font-size: 12px; font-family: ui-monospace, Consolas, monospace; width: max-content; min-width: 100%; }
.nv-table th, .nv-table td { border: 1px solid var(--bd); padding: 4px 8px; text-align: left; white-space: nowrap; color: var(--tx); }
.nv-table th { background: var(--bg4); position: sticky; top: 0; }
.nv-raw { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--tx); white-space: pre-wrap; }
.nv-noresult { color: var(--tx4); font-size: 12px; padding: 14px; text-align: center; }
</style>
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTool.test.ts`
Expected: PASS（6 个用例全绿）。

- [ ] **Step 3: Commit**

```powershell
git add web/src/tools/navicat/NavicatTool.vue web/src/tools/navicat/NavicatTool.test.ts
git commit -m "feat(navicat): 顶部下拉框选连接+模板新建，移除左栏"
```

---

## Task 4: 删除左栏组件

**Files:**
- Delete: `web/src/tools/navicat/NavicatList.vue`
- Delete: `web/src/tools/navicat/NavicatList.test.ts`

- [ ] **Step 1: 确认无其他引用**

Run: `git grep -n "NavicatList" -- web/src`
Expected: 无输出（`NavicatTool.vue` 已在 Task 3 移除 import）。

- [ ] **Step 2: 删除文件**

```powershell
Remove-Item -LiteralPath "web/src/tools/navicat/NavicatList.vue"
Remove-Item -LiteralPath "web/src/tools/navicat/NavicatList.test.ts"
```

- [ ] **Step 3: 跑 navicat 全部前端测试**

Run: `npm.cmd --prefix web run test -- src/tools/navicat`
Expected: PASS，无 `NavicatList` 相关失败。

- [ ] **Step 4: Commit**

```powershell
git add -A web/src/tools/navicat/NavicatList.vue web/src/tools/navicat/NavicatList.test.ts
git commit -m "refactor(navicat): 删除被下拉框取代的左栏列表组件"
```

---

## Task 5: 全量校验与提交前检查

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误。

- [ ] **Step 2: i18n 校验**

Run: `npm.cmd run check:i18n`
Expected: 无错误。

- [ ] **Step 3: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全部 PASS。

- [ ] **Step 4: 提交前敏感信息与状态检查**（`docs/learn/git仓库提交检查和提交事项.md`）

```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat_|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
git status --short
```
Expected: 敏感扫描无命中；`git ls-files env` 为空。

---

## Self-Review

**Spec coverage：**
- 去左栏 + 顶部下拉：Task 3 + Task 4。
- 选中连接填充完整信息（含密码 reveal）：Task 3 `selectProfile` + Task 2 用例 1。
- 「＋ 新建连接」进入新建态、下拉切模板：Task 3 `onSelectChange`/`newProfile` + 用例 4。
- 模板填充不带 id、保存 POST：Task 3 `applyTemplate` + 用例 4。
- 编辑态保存 PATCH：Task 3 `doSave` + 用例 5。
- 重命名/删除移到顶栏、仅编辑态出现：Task 3 `showActions` + 用例 6。
- 退出新建态（↩ 取消新建）：Task 3 `cancelNew` + `sentinelLabel`。
- i18n 三词条：Task 1。
- 删 NavicatList：Task 4。
- 后端零改动：未涉及 server 文件。

**Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码。

**Type consistency：** `mode: 'edit'|'new'`、`selectedId`、`NEW_SENTINEL`、`selectPlaceholder`/`sentinelLabel`/`showActions`、`onSelectChange`/`selectProfile`/`newProfile`/`cancelNew`/`applyTemplate` 在各 Task 中命名一致；测试选择器 `.nv-conn`/`.nv-rename`/`.nv-del`/`.nv-pw input`/`.nv-name-input input`/`.nv-host input`/`.nv-sql`/`.nv-run`/`.nv-save`/`.nv-meta` 与组件模板一致。
