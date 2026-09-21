# Navicat 风格「新建连接」窗口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Navicat 小工具的连接对话框改成真实 Navicat「新建连接」窗口样式（竖向 label 表单 + 常规/高级分页 + 测试/取消/确定），并移除 mysql/postgres/redis 的数据库输入字段。

**Architecture:** 纯前端改造，只动 `NavicatTool.vue` 的对话框模板/脚本/样式与中英词条；后端 `navicat-store/exec/mount` 零改动。数据库仅由左栏树通过既有 `/api/navicat/schema/*` 查询得到；SQLite 的 `database`（文件路径）保留为「数据库文件」。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Element Plus（`el-dialog`/`el-tabs`/`el-tab-pane`/`el-input`/`el-switch`）、Vitest + happy-dom + `@vue/test-utils`。

**Spec:** `docs/superpowers/specs/2026-09-21-navicat-connection-dialog-design.md`

**Commit 说明:** 仓库规矩是提交前跑 `docs/learn/git仓库提交检查和提交事项.md` 清单；若本轮不想提交，跳过各 Task 的 commit 步骤即可。

---

## File Structure

- `shared/i18n/zh-CN.js` — 新增 5 个 `nv.*` 词条（中文）。
- `shared/i18n/en.js` — 同步 5 个英文词条。
- `web/src/tools/navicat/NavicatTool.vue` — 对话框重做（模板 + `dlgTab`/`ssl` 脚本 + 竖向表单样式 + `doSave` 清空 `database`）。
- `web/src/tools/navicat/NavicatTool.test.ts` — 新增/保留用例。

---

## Task 1: i18n 词条（中英同步）

**Files:**
- Modify: `shared/i18n/zh-CN.js:830`（在 `'nv.edit_title'` 行后插入）
- Modify: `shared/i18n/en.js:830`（同位置）

- [ ] **Step 1: 在 `shared/i18n/zh-CN.js` 的 `'nv.edit_title': '编辑连接',` 之后插入**

```js
  'nv.tab_general': '常规',
  'nv.tab_advanced': '高级',
  'nv.database_file': '数据库文件',
  'nv.ok': '确定',
  'nv.ssl': 'SSL',
```

- [ ] **Step 2: 在 `shared/i18n/en.js` 的 `'nv.edit_title': 'Edit connection',` 之后插入**

```js
  'nv.tab_general': 'General',
  'nv.tab_advanced': 'Advanced',
  'nv.database_file': 'Database file',
  'nv.ok': 'OK',
  'nv.ssl': 'SSL',
```

- [ ] **Step 3: 校验词条对称**

Run: `npm.cmd run check:i18n`
Expected: 通过（无 missing / 中文命中报错）。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(navicat): 连接对话框分页与数据库文件词条"
```

---

## Task 2: 连接对话框改成 Navicat 风格（TDD）

**Files:**
- Modify: `web/src/tools/navicat/NavicatTool.test.ts`
- Modify: `web/src/tools/navicat/NavicatTool.vue`

### Step 1: 写失败测试

- [ ] **Step 1.1: 在 `NavicatTool.test.ts` 末尾 `describe` 内追加以下 4 个用例**

```ts
  it('新建连接常规页不含数据库输入', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    expect(w.find('.nv-name-input input').exists()).toBe(true);
    expect(w.find('.nv-db').exists()).toBe(false);
    expect(w.find('.nv-db-file').exists()).toBe(false);
  });

  it('类型选 sqlite 时显示数据库文件输入，隐藏主机端口', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    await w.find('.nv-type').setValue('sqlite');
    await flushPromises();
    expect(w.find('.nv-db-file').exists()).toBe(true);
    expect(w.find('.nv-host').exists()).toBe(false);
  });

  it('高级页含 SSL 开关，sqlite 下不渲染高级页', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    expect(w.find('.nv-ssl').exists()).toBe(true);
    await w.find('.nv-type').setValue('sqlite');
    await flushPromises();
    expect(w.find('.nv-ssl').exists()).toBe(false);
  });

  it('保存 mysql 连接时提交空 database', async () => {
    let body: any = null;
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      if (u === '/api/navicat/profiles' && init?.method === 'POST') {
        body = init?.body ? JSON.parse(String(init.body)) : null;
      }
      return okJson({ ok: true, item: { ...P, id: '2' } });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    await w.find('.nv-name-input input').setValue('C');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(body).toBeTruthy();
    expect(body.database).toBe('');
  });
```

- [ ] **Step 1.2: 跑测试确认失败**

Run: `npm.cmd run test:web -- NavicatTool`
Expected: FAIL —— `.nv-db-file` / `.nv-ssl` 不存在（新用例失败），保存体 `database` 仍为原值。

### Step 2: 实现

- [ ] **Step 2.1: 改 `NavicatTool.vue` 的 `<script setup>`**

在 `const dlg = ref(false);` 上方加：

```ts
const dlgTab = ref('general');
```

把 `blank()` 改为带 `options`：

```ts
function blank(): NavicatProfile {
  return { name: '', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: '', password: '', options: { ssl: false } };
}
```

在 `const activeProfile = ...` 之后加 SSL computed：

```ts
const ssl = computed({
  get: () => !!form.value.options?.ssl,
  set: (v: boolean) => { form.value = { ...form.value, options: { ...(form.value.options || {}), ssl: v } }; },
});
```

`onTypeChange()` 末尾补一行（sqlite 时回到常规页）：

```ts
function onTypeChange() {
  if (!form.value.port || ['3306', '5432', '6379', ''].includes(form.value.port)) form.value.port = defaultPort(form.value.type);
  if (form.value.type === 'sqlite') dlgTab.value = 'general';
}
```

`openNew()` 加 `dlgTab.value = 'general';`：

```ts
function openNew() {
  form.value = blank();
  dlgMsg.value = '';
  dlgTab.value = 'general';
  dlg.value = true;
}
```

`openEdit()` 加 `dlgTab.value = 'general';`：

```ts
async function openEdit(p: NavicatProfile) {
  form.value = { ...blank(), ...p, password: '', options: { ssl: false, ...(p.options || {}) } };
  dlgMsg.value = '';
  dlgTab.value = 'general';
  dlg.value = true;
  if (p.hasPassword && p.id) {
    try { form.value.password = await reveal(p.id); } catch { /* ignore */ }
  }
}
```

`doSave()` 改为保存前清空非 sqlite 的 `database`：

```ts
async function doSave() {
  if (!form.value.name.trim()) { dlgMsg.value = t('nv.required_name'); return; }
  saving.value = true; dlgMsg.value = '';
  try {
    const payload = { ...form.value, database: form.value.type === 'sqlite' ? form.value.database : '' };
    const saved = await save(payload);
    dlg.value = false;
    activeId.value = saved.id || '';
    activeDatabase.value = saved.type === 'sqlite' ? '' : (saved.database || '');
    treeVersion.value += 1;
    msg.value = t('nv.saved');
  } catch (e) { dlgMsg.value = (e as Error).message; } finally { saving.value = false; }
}
```

- [ ] **Step 2.2: 用新模板替换 `<el-dialog …>…</el-dialog>` 整块（当前 `NavicatTool.vue:238-260`）**

```html
    <el-dialog v-model="dlg" :title="form.id ? $t('nv.edit_title') : $t('nv.new_title')" width="560px" class="nvdlg">
      <el-tabs v-model="dlgTab" class="nv-tabs">
        <el-tab-pane :label="$t('nv.tab_general')" name="general">
          <div class="nvform">
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.name') }}</span>
              <el-input v-model="form.name" size="small" class="nv-name-input" />
            </label>
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.type') }}</span>
              <select v-model="form.type" class="nv-type" @change="onTypeChange">
                <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
              </select>
            </label>
            <template v-if="isSqlite">
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.database_file') }}</span>
                <el-input v-model="form.database" size="small" class="nv-db-file" />
              </label>
            </template>
            <template v-else>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.host') }}</span>
                <el-input v-model="form.host" size="small" class="nv-host" />
              </label>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.port') }}</span>
                <el-input v-model="form.port" size="small" class="nv-port" />
              </label>
              <label v-if="!isRedis" class="nvrow">
                <span class="nvlbl">{{ $t('nv.user') }}</span>
                <el-input v-model="form.user" size="small" class="nv-user" />
              </label>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.password') }}</span>
                <el-input v-model="form.password" size="small" type="password" show-password class="nv-pw"
                          :placeholder="form.hasPassword && !form.password ? '••••••' : ''" />
              </label>
            </template>
          </div>
        </el-tab-pane>
        <el-tab-pane v-if="!isSqlite" :label="$t('nv.tab_advanced')" name="advanced">
          <div class="nvform">
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.ssl') }}</span>
              <el-switch v-model="ssl" class="nv-ssl" />
            </label>
          </div>
        </el-tab-pane>
      </el-tabs>
      <div v-if="dlgMsg" class="nvmsg nvdlgmsg">{{ dlgMsg }}</div>
      <template #footer>
        <button class="nvbtn nv-test" :disabled="testing" @click="doTest">{{ testing ? $t('nv.testing') : $t('nv.test') }}</button>
        <button class="nvbtn nv-cancel" @click="dlg = false">{{ $t('nv.cancel') }}</button>
        <button class="nvbtn primary nv-save" :disabled="saving" @click="doSave">{{ $t('nv.ok') }}</button>
      </template>
    </el-dialog>
```

- [ ] **Step 2.3: 替换 `<style scoped>` 里的表单样式块（当前 `NavicatTool.vue:291-300`，即 `.nvform` 起至 `.nvform .el-input { flex: none; }`）**

```css
.nv-tabs { margin-top: -6px; }
.nvform { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.nvrow { display: flex; align-items: center; gap: 10px; }
.nvlbl { flex: none; width: 96px; text-align: right; color: var(--tx3); font-size: 13px; }
.nvrow .el-input { flex: 1; }
.nv-type { flex: 1; height: 32px; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 0 8px; font-size: 13px; }
.nv-type:focus { outline: none; border-color: var(--ac2); }
.nvdlg :deep(.el-dialog__footer) { display: flex; align-items: center; }
.nv-test { margin-right: auto; }
```

### Step 3: 跑测试确认通过

- [ ] **Step 3.1:**

Run: `npm.cmd run test:web -- NavicatTool`
Expected: PASS（新老用例全绿）。

- [ ] **Step 3.2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（`ssl` computed 保证 `form.options` 不出现可选链赋值报错）。

- [ ] **Step 3.3: Commit**

```bash
git add web/src/tools/navicat/NavicatTool.vue web/src/tools/navicat/NavicatTool.test.ts
git commit -m "feat(navicat): 连接对话框改为 Navicat 风格分页并移除数据库字段"
```

---

## Task 3: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全绿。

- [ ] **Step 2: 类型 + i18n**

Run: `npm.cmd run typecheck` 然后 `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 3: 手动核对（可选，若已起 dev）**

`npm.cmd run dev` 后打开 http://localhost:5173 → 小工具 `navicat` → 点「新建连接」：
- 竖向 label 表单 + 顶部「常规 / 高级」页签；底部左「测试连接」、右「取消 / 确定」。
- mysql/postgres/redis 常规页无数据库输入；切 sqlite 出现「数据库文件」且高级页消失。
- 保存后左栏树展开仍能查到库/表（走 `/api/navicat/schema/*`）。

- [ ] **Step 4: Commit（仅上面步骤有零散改动时）**

```bash
git status
```

Expected: 除本轮已提交文件外无遗留改动。

---

## Self-Review

- **Spec coverage：** 竖向 label + 常规/高级分页 → Task 2 Step 2.2；去数据库字段 → Step 2.2/2.1（doSave 清空）；SQLite 数据库文件 → Step 2.2；高级页 SSL → Step 2.1 `ssl` + Step 2.2；底部按钮顺序 → Step 2.2 + 2.3；i18n 5 键 → Task 1；测试 → Task 2 Step 1、Task 3。全部有对应任务。
- **Placeholder scan：** 无 TBD/TODO，代码均为完整片段。
- **Type consistency：** 类名 `.nv-name-input`/`.nv-host`/`.nv-port`/`.nv-user`/`.nv-pw`/`.nv-db-file`/`.nv-ssl`/`.nv-save`/`.nv-test`/`.nv-cancel` 在模板、样式、测试中一致；`ssl` computed 绑定 `form.options.ssl`；`doSave` 使用 `payload.database`。
