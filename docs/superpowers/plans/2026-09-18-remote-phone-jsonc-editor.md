# 手机页 JSONC 输入面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在手机遥控页 `/?phone=1` 增加一个覆盖层面板，展示 `messages.jsonc` 的格式与真实存放路径，并支持粘贴对象/数组 JSONC 追加条目。

**Architecture:** 复用现有 `remote_coder/messages.jsonc` 单向通道：新增两个只读/写入端点（`/info`、`/messages`）与 store 纯函数（`normalizeEntries`、`entriesFromJsonc`）；前端新增 `JsoncPanel.vue` 覆盖层，`PhoneView` 用顶栏 `{}` 按钮开关。写入后由桌面端现有 `/inbox` 流程消费，与「截图/发消息/打包」按钮同构。

**Tech Stack:** Node ESM + node:test（server）、Vue 3 + `<script setup>` + vitest/happy-dom（web）、`@devflow/shared/i18n`（zh-CN + en）。

**Spec:** `docs/superpowers/specs/2026-09-18-remote-phone-jsonc-editor-design.md`

---

### Task 1: store 支持把对象/数组归一为条目

**Files:**
- Modify: `server/remote-coder-store.js`
- Test: `server/test/remote-coder-store.test.js`

- [ ] **Step 1: Write the failing test**

在 `server/test/remote-coder-store.test.js` 顶部 import 列表里加入 `normalizeEntries`、`entriesFromJsonc`：

```js
import {
  REMOTE_DIR, SCREEN_FILE, MESSAGES_FILE, dirOf, decodePng, parseJsonc,
  readMessages, writeMessages, newId, makeEntry, appendMessage, inbox, markHandled,
  saveScreen, screenRev, commitScreen,
  artifactsDir, listArtifacts, resolveArtifact,
  normalizeEntries, entriesFromJsonc,
} from '../remote-coder-store.js';
```

在文件末尾追加两个测试：

```js
test('normalizeEntries：对象/数组都接受；非法 kind、空 message 报错；忽略多余字段', () => {
  const now = 1758000000000;
  const rand = () => 0.5;
  const one = normalizeEntries({ kind: 'message', text: ' hi ', id: 'x', handled: true }, now, rand);
  assert.deepEqual(one, [{ id: 'm-1758000000000-8000', ts: now, kind: 'message', text: 'hi', handled: false }]);
  const many = normalizeEntries([{ kind: 'screenshot' }, { kind: 'deliver' }], now, rand);
  assert.deepEqual(many.map((e) => e.kind), ['screenshot', 'deliver']);
  assert.throws(() => normalizeEntries({ kind: 'nope' }, now, rand), (e) => e.code === 'bad-kind');
  assert.throws(() => normalizeEntries([{ kind: 'message', text: '   ' }], now, rand), (e) => e.code === 'bad-message');
  assert.throws(() => normalizeEntries([123], now, rand), (e) => e.code === 'bad-entry');
  assert.throws(() => normalizeEntries(['x'], now, rand), (e) => e.code === 'bad-entry');
});

test('entriesFromJsonc：解析对象或数组，坏 JSONC 抛 bad-jsonc', () => {
  const list = entriesFromJsonc('[\n  // c\n  {"kind":"message","text":"x"}\n]', 1, () => 0);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'message');
  assert.equal(list[0].text, 'x');
  assert.throws(() => entriesFromJsonc('{ nope', 1, () => 0), (e) => e.code === 'bad-jsonc');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "server/test/remote-coder-store.test.js"`
Expected: FAIL — `normalizeEntries is not a function` / import error。

- [ ] **Step 3: Write minimal implementation**

在 `server/remote-coder-store.js` 的 `makeEntry` 之后（`appendMessage` 之前）插入：

```js
// 编辑区输入：接受单个对象或对象数组，只取 kind+text，其余字段忽略。
export function normalizeEntries(raw, now = Date.now(), rand = Math.random) {
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw err('bad-entry', 'entry must be an object');
    }
    const kind = item.kind == null ? 'message' : item.kind;
    if (!KINDS.has(kind)) throw err('bad-kind', `unknown kind: ${kind}`);
    return makeEntry({ kind, text: item.text }, now, rand);
  });
}

// 原始 JSONC 文本 → 条目数组；解析失败统一抛 bad-jsonc。
export function entriesFromJsonc(text, now = Date.now(), rand = Math.random) {
  let raw;
  try {
    raw = parseJsonc(text);
  } catch {
    throw err('bad-jsonc', 'invalid jsonc');
  }
  return normalizeEntries(raw, now, rand);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "server/test/remote-coder-store.test.js"`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add server/remote-coder-store.js server/test/remote-coder-store.test.js
git commit -m "feat(remote): store 归一化 JSONC 条目（normalizeEntries/entriesFromJsonc）"
```

---

### Task 2: 服务端新增 `/info` 与 `/messages` 端点

**Files:**
- Modify: `server/remote-coder-mount.js`
- Test: `server/test/remote-coder-mount.test.js`

- [ ] **Step 1: Write the failing test**

在 `server/test/remote-coder-mount.test.js` 末尾追加：

```js
test('info 端点：返回 remote_coder 绝对路径', async (t) => {
  const root = tmpDir();
  const server = await start(root);
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const r = json(await req(server, '/api/remote-coder/info'));
  assert.equal(r.dir, path.join(root, 'remote_coder'));
  assert.equal(r.messagesFile, path.join(root, 'remote_coder', 'messages.jsonc'));
});

test('messages 端点：追加对象/数组；坏 jsonc 与非法 kind 400；too-large 413', async (t) => {
  const root = tmpDir();
  const server = await start(root);
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const r = json(await req(server, '/api/remote-coder/messages', {
    method: 'POST',
    body: { text: '[{"kind":"message","text":"a"},{"kind":"deliver"}]' },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.added, 2);
  assert.equal(r.ids.length, 2);
  const list = json(await req(server, '/api/remote-coder/inbox'));
  assert.deepEqual(list.entries.map((e) => e.kind), ['message', 'deliver']);
  assert.equal(list.entries[0].text, 'a');

  assert.equal((await req(server, '/api/remote-coder/messages', { method: 'POST', body: { text: '{ nope' } })).status, 400);
  assert.equal((await req(server, '/api/remote-coder/messages', { method: 'POST', body: { text: '{"kind":"nope"}' } })).status, 400);
  assert.equal((await req(server, '/api/remote-coder/messages', {
    method: 'POST',
    body: { text: JSON.stringify({ kind: 'message', text: 'x'.repeat(40000) }) },
  })).status, 413);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "server/test/remote-coder-mount.test.js"`
Expected: FAIL — `/info` 与 `/messages` 目前落到 400 `bad-request`（`added` 为 undefined）。

- [ ] **Step 3: Write minimal implementation**

在 `server/remote-coder-mount.js` 的 `/api/remote-coder/message` 分支之后、`/ack` 分支之前插入：

```js
      if (pathname === `${PREFIX}/info` && req.method === 'GET') {
        sendJson(res, 200, { dir, messagesFile: path.join(dir, store.MESSAGES_FILE) });
        return true;
      }
      if (pathname === `${PREFIX}/messages` && req.method === 'POST') {
        const body = await readJsonBody(req);
        const entries = store.entriesFromJsonc(body && body.text);
        const ids = entries.map((entry) => store.appendMessage(dir, entry).id);
        sendJson(res, 200, { ok: true, added: ids.length, ids });
        return true;
      }
```

并把 catch 里的 400 判定扩为：

```js
      if (err.code === 'bad-image' || err.code === 'bad-message' || err.code === 'bad-jsonc'
        || err.code === 'bad-entry' || err.code === 'bad-kind') {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "server/test/remote-coder-mount.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/remote-coder-mount.js server/test/remote-coder-mount.test.js
git commit -m "feat(remote): /api/remote-coder/info 与 /messages 端点"
```

---

### Task 3: i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`'remote.pick_session'` 之后，约第 39 行）
- Modify: `shared/i18n/en.js`（`'remote.pick_session'` 之后，约第 39 行）

- [ ] **Step 1: 加中文词条**

在 `shared/i18n/zh-CN.js` 的 `'remote.pick_session': '点上方页签选择要控制的会话',` 之后插入：

```js
  'remote.jsonc_open': 'JSONC',
  'remote.jsonc_title': 'JSONC 输入',
  'remote.jsonc_close': '关闭',
  'remote.jsonc_format': '格式说明',
  'remote.jsonc_ex_message': '消息',
  'remote.jsonc_ex_screenshot': '截图',
  'remote.jsonc_ex_deliver': '打包',
  'remote.jsonc_field_id': '服务端生成的唯一编号（前缀 c-/m-/d-）',
  'remote.jsonc_field_ts': '服务端生成的毫秒时间戳',
  'remote.jsonc_field_kind': 'message | screenshot | deliver',
  'remote.jsonc_field_text': '仅 message 必填，非空，≤ 32KB',
  'remote.jsonc_field_handled': '桌面端处理后置为 true，由服务端管理',
  'remote.jsonc_path': '存放位置',
  'remote.jsonc_copy': '复制',
  'remote.jsonc_copied': '已复制',
  'remote.jsonc_placeholder': '粘贴对象或数组，如 { "kind": "message", "text": "继续" }',
  'remote.jsonc_submit': '追加',
  'remote.jsonc_added': '已追加 {n} 条',
  'remote.jsonc_failed': '提交失败：{msg}',
```

- [ ] **Step 2: 加英文词条**

在 `shared/i18n/en.js` 的 `'remote.pick_session': 'Tap a tab above to pick a session.',` 之后插入：

```js
  'remote.jsonc_open': 'JSONC',
  'remote.jsonc_title': 'JSONC input',
  'remote.jsonc_close': 'Close',
  'remote.jsonc_format': 'Format',
  'remote.jsonc_ex_message': 'Message',
  'remote.jsonc_ex_screenshot': 'Capture',
  'remote.jsonc_ex_deliver': 'Build',
  'remote.jsonc_field_id': 'Server-generated id (prefix c-/m-/d-)',
  'remote.jsonc_field_ts': 'Server-generated epoch milliseconds',
  'remote.jsonc_field_kind': 'message | screenshot | deliver',
  'remote.jsonc_field_text': 'Required for message only; non-empty; <= 32KB',
  'remote.jsonc_field_handled': 'Set to true by the desktop after processing; managed by the server',
  'remote.jsonc_path': 'Location',
  'remote.jsonc_copy': 'Copy',
  'remote.jsonc_copied': 'Copied',
  'remote.jsonc_placeholder': 'Paste an object or array, e.g. { "kind": "message", "text": "hello" }',
  'remote.jsonc_submit': 'Append',
  'remote.jsonc_added': 'Appended {n}',
  'remote.jsonc_failed': 'Failed: {msg}',
```

- [ ] **Step 3: 校验键集合对称 + i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 输出 `check-i18n: 未发现中文命中`（退出码 0）。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(remote): JSONC 面板词条（中英）"
```

---

### Task 4: 手机侧客户端函数 `fetchRemoteInfo` / `appendMessages`

**Files:**
- Modify: `web/src/remote-coder/useRemoteCoder.ts`
- Test: `web/src/remote-coder/useRemoteCoder.test.ts`

- [ ] **Step 1: Write the failing test**

把 `web/src/remote-coder/useRemoteCoder.test.ts` 顶部 import 改为：

```ts
import { requestShot, fetchScreenRev, sendRemoteMessage, waitForNewScreen, screenUrl, fetchRemoteInfo, appendMessages } from './useRemoteCoder';
```

在 `describe('useRemoteCoder', ...)` 内追加：

```ts
  it('appendMessages 提交原始 JSONC 文本，失败抛错', async () => {
    const { fetchFn, calls } = mkFetch({ ok: true, added: 2, ids: ['a', 'b'] });
    const r = await appendMessages('[{"kind":"message","text":"a"}]', { fetch: fetchFn as never });
    expect(calls[0].url).toBe('/api/remote-coder/messages');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ text: '[{"kind":"message","text":"a"}]' });
    expect(r).toEqual({ added: 2, ids: ['a', 'b'] });

    const bad = mkFetch({});
    bad.fetchFn.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({ message: 'bad-jsonc' }) }));
    await expect(appendMessages('x', { fetch: bad.fetchFn as never })).rejects.toThrow('bad-jsonc');
  });

  it('fetchRemoteInfo 取真实路径，异常回退空串', async () => {
    const info = { dir: 'D:/app/remote_coder', messagesFile: 'D:/app/remote_coder/messages.jsonc' };
    const { fetchFn } = mkFetch(info);
    expect(await fetchRemoteInfo({ fetch: fetchFn as never })).toEqual(info);
    const boom = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchRemoteInfo({ fetch: boom as never })).toEqual({ dir: '', messagesFile: '' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/remote-coder/useRemoteCoder.test.ts`
Expected: FAIL — `fetchRemoteInfo is not a function` / `appendMessages is not a function`。

- [ ] **Step 3: Write minimal implementation**

在 `web/src/remote-coder/useRemoteCoder.ts` 的 `screenUrl` 函数之后插入：

```ts
export interface RemoteInfo { dir: string; messagesFile: string }

export async function fetchRemoteInfo(deps: RemoteDeps = { fetch: realFetch }): Promise<RemoteInfo> {
  try {
    const res = await deps.fetch('/api/remote-coder/info');
    const data = await res.json().catch(() => ({}));
    return {
      dir: typeof data?.dir === 'string' ? data.dir : '',
      messagesFile: typeof data?.messagesFile === 'string' ? data.messagesFile : '',
    };
  } catch {
    return { dir: '', messagesFile: '' };
  }
}

export async function appendMessages(
  text: string,
  deps: RemoteDeps = { fetch: realFetch },
): Promise<{ added: number; ids: string[] }> {
  const data = await postJson('/api/remote-coder/messages', { text }, deps);
  return { added: Number(data?.added) || 0, ids: Array.isArray(data?.ids) ? data.ids : [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/remote-coder/useRemoteCoder.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/remote-coder/useRemoteCoder.ts web/src/remote-coder/useRemoteCoder.test.ts
git commit -m "feat(remote): 手机侧 fetchRemoteInfo/appendMessages"
```

---

### Task 5: 新增 `JsoncPanel.vue` 覆盖层面板

**Files:**
- Create: `web/src/remote-coder/JsoncPanel.vue`

- [ ] **Step 1: 创建组件**

创建 `web/src/remote-coder/JsoncPanel.vue`：

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { appendMessages, fetchRemoteInfo } from './useRemoteCoder';
import { t } from '../i18n';

const emit = defineEmits<{ (e: 'close'): void }>();

const text = ref('');
const status = ref('');
const path = ref('');
const copied = ref('');

const EXAMPLES = [
  '{ "kind": "message", "text": "hello" }',
  '{ "kind": "screenshot" }',
  '{ "kind": "deliver" }',
];
const EXAMPLE_KEYS = ['remote.jsonc_ex_message', 'remote.jsonc_ex_screenshot', 'remote.jsonc_ex_deliver'];
const FIELDS = [
  { name: 'id', desc: 'remote.jsonc_field_id' },
  { name: 'ts', desc: 'remote.jsonc_field_ts' },
  { name: 'kind', desc: 'remote.jsonc_field_kind' },
  { name: 'text', desc: 'remote.jsonc_field_text' },
  { name: 'handled', desc: 'remote.jsonc_field_handled' },
];

onMounted(async () => {
  const info = await fetchRemoteInfo();
  path.value = info.messagesFile;
});

async function copy(value: string, which: string) {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = which;
    setTimeout(() => { if (copied.value === which) copied.value = ''; }, 1500);
  } catch { /* 剪贴板不可用时忽略 */ }
}

async function submit() {
  status.value = '';
  try {
    const r = await appendMessages(text.value);
    text.value = '';
    status.value = t('remote.jsonc_added', { n: r.added });
  } catch (e) {
    status.value = t('remote.jsonc_failed', { msg: (e as Error).message || String(e) });
  }
}
</script>

<template>
  <div class="jp">
    <header class="jp-head">
      <span class="jp-ttl">{{ $t('remote.jsonc_title') }}</span>
      <button class="jp-close" @click="emit('close')">{{ $t('remote.jsonc_close') }}</button>
    </header>
    <div class="jp-body">
      <section class="jp-sec">
        <h3 class="jp-h">{{ $t('remote.jsonc_format') }}</h3>
        <div v-for="(ex, i) in EXAMPLES" :key="i" class="jp-ex">
          <span class="jp-exlabel">{{ $t(EXAMPLE_KEYS[i]) }}</span>
          <code class="jp-code">{{ ex }}</code>
          <button class="jp-copy" @click="copy(ex, 'ex' + i)">
            {{ copied === 'ex' + i ? $t('remote.jsonc_copied') : $t('remote.jsonc_copy') }}
          </button>
        </div>
        <table class="jp-fields">
          <tbody>
            <tr v-for="f in FIELDS" :key="f.name">
              <td class="jp-fname">{{ f.name }}</td>
              <td class="jp-fdesc">{{ $t(f.desc) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="jp-sec">
        <h3 class="jp-h">{{ $t('remote.jsonc_path') }}</h3>
        <div class="jp-path">
          <code class="jp-code">{{ path || '...' }}</code>
          <button class="jp-copy" @click="copy(path, 'path')">
            {{ copied === 'path' ? $t('remote.jsonc_copied') : $t('remote.jsonc_copy') }}
          </button>
        </div>
      </section>
      <section class="jp-sec">
        <textarea
          v-model="text"
          class="jp-input"
          spellcheck="false"
          :placeholder="$t('remote.jsonc_placeholder')"
        />
        <div class="jp-actions">
          <button class="jp-submit" :disabled="!text.trim()" @click="submit">{{ $t('remote.jsonc_submit') }}</button>
          <span class="jp-status">{{ status }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.jp { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: var(--bg0); color: var(--tx); }
.jp-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg1); border-bottom: 1px solid var(--bd2); }
.jp-ttl { flex: 1; font-weight: 700; color: var(--tx1); }
.jp-close { background: var(--bg2); color: var(--tx1); border: 1px solid var(--bd2); border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px; }
.jp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 14px; }
.jp-sec { display: flex; flex-direction: column; gap: 8px; }
.jp-h { margin: 0; font-size: 13px; color: var(--tx2); font-weight: 600; }
.jp-ex { display: flex; align-items: center; gap: 8px; }
.jp-exlabel { flex: none; font-size: 12px; color: var(--tx3); min-width: 40px; }
.jp-code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; background: var(--bg2); border: 1px solid var(--bd2); border-radius: 6px; padding: 5px 8px; font-size: 12px; color: var(--tx1); }
.jp-copy { flex: none; background: var(--bg2); color: var(--tx2); border: 1px solid var(--bd2); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.jp-fields { width: 100%; border-collapse: collapse; font-size: 12px; }
.jp-fields td { border-top: 1px solid var(--bd2); padding: 5px 6px; vertical-align: top; }
.jp-fname { width: 64px; color: var(--ac); font-family: monospace; white-space: nowrap; }
.jp-fdesc { color: var(--tx3); }
.jp-path { display: flex; align-items: center; gap: 8px; }
.jp-input { width: 100%; min-height: 140px; box-sizing: border-box; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd2); border-radius: 6px; padding: 8px; font-family: monospace; font-size: 13px; resize: vertical; }
.jp-actions { display: flex; align-items: center; gap: 10px; }
.jp-submit { background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 6px 18px; cursor: pointer; font-size: 13px; font-weight: 600; }
.jp-submit:disabled { opacity: .6; cursor: default; }
.jp-status { flex: 1; min-width: 0; font-size: 12px; color: var(--tx3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（无新增错误）。

- [ ] **Step 3: Commit**

```bash
git add web/src/remote-coder/JsoncPanel.vue
git commit -m "feat(remote): JSONC 输入覆盖层面板组件"
```

---

### Task 6: `PhoneView` 接入面板 + 集成测试

**Files:**
- Modify: `web/src/remote-coder/PhoneView.vue`
- Test: `web/src/remote-coder/PhoneView.test.ts`

- [ ] **Step 1: Write the failing test**

在 `web/src/remote-coder/PhoneView.test.ts` 的 `describe('PhoneView', ...)` 内追加：

```ts
  it('打开 JSONC 面板：显示真实路径、提交后清空并提示已追加', async () => {
    const calls: Call[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit): Promise<any> => {
      calls.push({ url, init });
      if (url === '/api/remote-coder/info') {
        return { ok: true, status: 200, json: async () => ({ dir: 'X:/app/remote_coder', messagesFile: 'X:/app/remote_coder/messages.jsonc' }) };
      }
      if (url === '/api/remote-coder/messages') {
        return { ok: true, status: 200, json: async () => ({ ok: true, added: 2, ids: ['a', 'b'] }) };
      }
      return { ok: true, status: 200, json: async () => ({ rev: '' }) };
    });
    vi.stubGlobal('fetch', fetchFn);
    vi.stubGlobal('WebSocket', FakeWS as any);

    const w = mountC(PhoneView);
    await flushPromises();
    expect(w.find('.jp-input').exists()).toBe(false);

    await w.find('.jsonc').trigger('click');
    await flushPromises();
    expect(w.find('.jp-input').exists()).toBe(true);
    expect(w.text()).toContain('X:/app/remote_coder/messages.jsonc');

    await w.find('.jp-input').setValue('[{"kind":"message","text":"a"},{"kind":"deliver"}]');
    await w.find('.jp-submit').trigger('click');
    await flushPromises();
    const post = calls.find((c) => c.url === '/api/remote-coder/messages');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ text: '[{"kind":"message","text":"a"},{"kind":"deliver"}]' });
    expect((w.find('.jp-input').element as HTMLTextAreaElement).value).toBe('');
    expect(w.find('.jp-status').text()).toContain(t('remote.jsonc_added', { n: 2 }));

    await w.find('.jp-close').trigger('click');
    await flushPromises();
    expect(w.find('.jp-input').exists()).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/remote-coder/PhoneView.test.ts`
Expected: FAIL — 找不到 `.jsonc` 按钮。

- [ ] **Step 3: 接入面板**

在 `web/src/remote-coder/PhoneView.vue`：

1) 在 `import TerminalView ...` 之后加：

```ts
import JsoncPanel from './JsoncPanel.vue';
```

2) 在 `const center = useCenter();` 之后加：

```ts
const showJsonc = ref(false);
```

3) 把模板 header 改为（新增 `{}` 按钮，位于「截图」之前）：

```html
    <header class="ph">
      <span class="ttl">{{ $t('remote.title') }}</span>
      <button class="jsonc" :title="$t('remote.jsonc_open')" @click="showJsonc = true">{}</button>
      <button class="shot" :disabled="pending" @click="onShot">{{ $t('remote.shot') }}</button>
      <span class="st" :title="status">{{ status }}</span>
    </header>
```

4) 在 `<div class="body">...</div>` 之后、根 `</div>` 之前加：

```html
    <JsoncPanel v-if="showJsonc" @close="showJsonc = false" />
```

5) 在 `<style scoped>` 的 `.shot` 规则后加：

```css
.jsonc { background: var(--bg2); color: var(--tx1); border: 1px solid var(--bd2); border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 13px; font-family: monospace; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/remote-coder/PhoneView.test.ts`
Expected: PASS（含原有两条用例）。

- [ ] **Step 5: Commit**

```bash
git add web/src/remote-coder/PhoneView.vue web/src/remote-coder/PhoneView.test.ts
git commit -m "feat(remote): 手机页顶栏 {} 打开 JSONC 面板"
```

---

### Task 7: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 服务端 + 前端测试**

Run: `npm.cmd test`
Expected: 全绿（server `node --test` + web `vitest run`）。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 4: 前端构建**

Run: `npm.cmd run build:web`
Expected: 构建成功，产物写入 `web/dist`。

- [ ] **Step 5: 人工验收（dev，端口 33333）**

先起后端与前端（两个终端，均后台重定向到 `logs\`，遵守 AGENTS.md 启动规范）：

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -RedirectStandardOutput "logs\dev-server.log" -RedirectStandardError "logs\dev-server.err.log" -WindowStyle Hidden
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:web" -RedirectStandardOutput "logs\dev-web.log" -RedirectStandardError "logs\dev-web.err.log" -WindowStyle Hidden
```

打开 `http://localhost:5173/?phone=1` → 点顶栏 `{}` → 确认：三段示例、字段表、真实绝对路径均显示；粘贴 `[{ "kind": "message", "text": "继续" }]` → 点「追加」→ 提示「已追加 1 条」且编辑框清空；检查 `<应用目录>/remote_coder/messages.jsonc` 末尾出现该条目；桌面端打开时 `handled` 被回填为 `true`、当前会话收到「继续」。

---

## Self-Review

**1. Spec coverage**

- 顶栏 `{}` 按钮 + 覆盖层面板 → Task 5/6。
- 格式说明（三段示例 + 字段表）→ Task 5。
- 真实绝对路径展示 → Task 2（`/info`）+ Task 5。
- 对象或数组、kind 白名单、只取 kind+text、忽略多余字段 → Task 1（`normalizeEntries`）。
- 追加语义 + 桌面端 `/inbox` 消费 → Task 2（`appendMessage` 复用现有流程）。
- i18n 中英对称 → Task 3。
- 错误映射 400/413 → Task 2。
- 测试与验收（store/mount/web/人工）→ Task 1/2/4/6/7。

**2. Placeholder scan**

无 TBD/TODO；每个代码步骤均给出完整代码与命令。

**3. Type consistency**

- `normalizeEntries(raw, now, rand)`、`entriesFromJsonc(text, now, rand)`：Task 1 定义，Task 2 调用。
- `fetchRemoteInfo` 返回 `{ dir, messagesFile }`：Task 4 定义，Task 5 使用。
- `appendMessages(text)` 返回 `{ added, ids }`：Task 4 定义，Task 5 使用 `r.added`。
- 端点路径 `/api/remote-coder/info`、`/api/remote-coder/messages`：Task 2/4/6 一致。
- 选择器 `.jsonc` / `.jp-input` / `.jp-submit` / `.jp-status` / `.jp-close`：Task 5 定义，Task 6 使用一致。
