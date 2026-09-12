# cURL Postman 式编辑器 + YAML 可视化节点编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `FilePreview` 中为 cURL 文件提供 Postman 式请求集合编辑器，为 YAML 文件提供「可视化 | 代码」节点树编辑，表单/节点改动写回文件并自动保存。

**Architecture:** 方案 B。`FilePreview.vue` 只做宿主（加载文本、模式切换、自动保存），新功能拆成独立组件 `CurlView.vue`/`YamlView.vue` 与纯逻辑模块 `web/src/curl.ts`（扩展）/`web/src/yaml.ts`（新增）。组件通过 `text`/`update:text` 单向通信，文件文本是唯一事实源。

**Tech Stack:** Vue 3 `<script setup>` + TS、CodeMirror 6（保留）、`yaml` 包（Document/CST API 保注释）、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-12-curl-yaml-visual-editors-design.md`

**通用约定：**
- 所有命令在仓库根 `D:\root\devflow\devflow` 执行；PowerShell 用 `;` 链接，npm 一律 `npm.cmd`。
- 仅 `git add` 本任务列出的文件，禁止 `git add -A`（工作区有其它未提交改动）。
- 用户可见文案一律进 `shared/i18n/{zh-CN,en}.js`，中英同时补齐。

---

## Task 1: 添加 yaml 依赖

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: 在 `web/package.json` 的 `dependencies` 中加入 `yaml`**

在 `"vue": "^3.5.0"` 一行后（保持字母序，放在 `"vue"` 前也可）加入：

```json
    "vue": "^3.5.0",
    "yaml": "^2.4.2"
```

即 `dependencies` 末尾变为：

```json
    "prettier": "^3.9.6",
    "vue": "^3.5.0",
    "yaml": "^2.4.2"
```

- [ ] **Step 2: 安装依赖**

Run: `npm.cmd install`
Expected: 无报错；`node_modules/yaml/package.json` 存在。

- [ ] **Step 3: 验证可解析**

Run: `npm.cmd --prefix web run test -- src/curl.test.ts`
Expected: 现有 curl 测试通过（确认工具链未坏）。

- [ ] **Step 4: Commit**

```bash
git add web/package.json package-lock.json
git commit -m "build(web): 显式引入 yaml 依赖"
```

---

## Task 2: curl.ts —— 多命令解析 `parseCurlCommands`

**Files:**
- Modify: `web/src/curl.ts`
- Test: `web/src/curl.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/curl.test.ts` 末尾追加：

```ts
import { parseCurlCommands } from './curl';

describe('parseCurlCommands', () => {
  it('解析多条命令并给出源码区间', () => {
    const text = [
      "curl -X GET 'https://a.test/x'",
      "curl -X POST 'https://b.test/y' \\",
      "  -H 'Content-Type: application/json' \\",
      "  -d '{\"a\":1}'",
    ].join('\n');
    const entries = parseCurlCommands(text);
    expect(entries).toHaveLength(2);
    expect(entries[0].request.url).toBe('https://a.test/x');
    expect(entries[1].request.method).toBe('POST');
    expect(entries[1].request.headers[0]).toEqual({ name: 'Content-Type', value: 'application/json' });
    expect(entries[1].request.body).toBe('{"a":1}');
    expect(text.slice(entries[0].start, entries[0].end)).toBe("curl -X GET 'https://a.test/x'");
  });

  it('无 curl 返回空数组', () => {
    expect(parseCurlCommands('echo hi')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/curl.test.ts`
Expected: FAIL，`parseCurlCommands is not a function`（或 import 报错）。

- [ ] **Step 3: 实现**

在 `web/src/curl.ts` 末尾追加：

```ts
export interface CurlEntry {
  request: CurlRequest;
  start: number;
  end: number;
}

function commandEnd(text: string, start: number, hardEnd: number): number {
  let quote: string | null = null;
  for (let i = start; i < hardEnd; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '\\' && text[i + 1] === '\n') { i++; continue; }
    if (ch === '\n') return i;
  }
  return hardEnd;
}

export function parseCurlCommands(text: string): CurlEntry[] {
  const out: CurlEntry[] = [];
  const re = /(^|[^A-Za-z0-9_])curl\b/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    starts.push(m.index + (m[1] ? m[1].length : 0));
  }
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const hardEnd = i + 1 < starts.length ? starts[i + 1] : text.length;
    const end = commandEnd(text, start, hardEnd);
    const req = parseCurl(text.slice(start, end));
    if (req) out.push({ request: req, start, end });
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/curl.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add web/src/curl.ts web/src/curl.test.ts
git commit -m "feat(web): curl 多命令解析 parseCurlCommands"
```

---

## Task 3: curl.ts —— 序列化与区间替换

**Files:**
- Modify: `web/src/curl.ts`
- Test: `web/src/curl.test.ts`

- [ ] **Step 1: 写失败测试**

追加：

```ts
import { buildCurl, replaceCurlCommand } from './curl';

describe('buildCurl / replaceCurlCommand', () => {
  it('序列化后再次解析得到等价请求', () => {
    const req = {
      method: 'POST',
      url: 'https://a.test/x?q=1',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: '{"a":1}',
      raw: '',
    };
    const cmd = buildCurl(req);
    expect(cmd).toContain('curl -X POST');
    expect(cmd).toContain('-H');
    const back = parseCurlCommands(cmd)[0].request;
    expect(back.method).toBe('POST');
    expect(back.url).toBe('https://a.test/x?q=1');
    expect(back.headers).toEqual(req.headers);
    expect(back.body).toBe('{"a":1}');
  });

  it('替换区间只改目标命令', () => {
    const text = "curl -X GET 'https://a.test/x'\ncurl -X GET 'https://b.test/y'";
    const entries = parseCurlCommands(text);
    const next = replaceCurlCommand(text, entries[0], { ...entries[0].request, method: 'DELETE' });
    expect(next).toContain("-X DELETE 'https://a.test/x'");
    expect(next).toContain("curl -X GET 'https://b.test/y'");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/curl.test.ts`
Expected: FAIL，`buildCurl is not a function`。

- [ ] **Step 3: 实现**

在 `web/src/curl.ts` 末尾追加：

```ts
function sq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function buildCurl(request: CurlRequest): string {
  const method = (request.method || 'GET').toUpperCase();
  const lines = [`curl -X ${method} ${sq(request.url)}`];
  for (const h of request.headers) {
    if (h.name) lines.push(`  -H ${sq(`${h.name}: ${h.value}`)}`);
  }
  if (request.body && !['GET', 'HEAD'].includes(method)) {
    lines.push(`  -d ${sq(request.body)}`);
  }
  return lines.join(' \\\n');
}

export function replaceCurlCommand(text: string, entry: CurlEntry, request: CurlRequest): string {
  return text.slice(0, entry.start) + buildCurl(request) + text.slice(entry.end);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/curl.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/curl.ts web/src/curl.test.ts
git commit -m "feat(web): curl 序列化 buildCurl 与区间替换"
```

---

## Task 4: curl.ts —— URL/Query 拆分合并

**Files:**
- Modify: `web/src/curl.ts`
- Test: `web/src/curl.test.ts`

- [ ] **Step 1: 写失败测试**

追加：

```ts
import { splitUrl, joinUrl } from './curl';

describe('splitUrl / joinUrl', () => {
  it('拆分查询参数', () => {
    expect(splitUrl('https://a.test/x?q=1&lang=zh')).toEqual({
      base: 'https://a.test/x',
      params: [{ name: 'q', value: '1' }, { name: 'lang', value: 'zh' }],
    });
  });
  it('无参数时 base 原样', () => {
    expect(splitUrl('https://a.test/x')).toEqual({ base: 'https://a.test/x', params: [] });
  });
  it('合并时忽略空名', () => {
    expect(joinUrl('https://a.test/x', [{ name: 'q', value: '1' }, { name: '', value: 'z' }])).toBe('https://a.test/x?q=1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/curl.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

在 `web/src/curl.ts` 末尾追加：

```ts
export interface QueryParam {
  name: string;
  value: string;
}

export function splitUrl(url: string): { base: string; params: QueryParam[] } {
  const i = url.indexOf('?');
  if (i < 0) return { base: url, params: [] };
  const base = url.slice(0, i);
  const params: QueryParam[] = [];
  for (const pair of url.slice(i + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) params.push({ name: decodeURIComponent(pair), value: '' });
    else params.push({ name: decodeURIComponent(pair.slice(0, eq)), value: decodeURIComponent(pair.slice(eq + 1)) });
  }
  return { base, params };
}

export function joinUrl(base: string, params: QueryParam[]): string {
  const q = params
    .filter((p) => p.name)
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
    .join('&');
  return q ? `${base}?${q}` : base;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/curl.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/curl.ts web/src/curl.test.ts
git commit -m "feat(web): URL 查询参数拆分合并"
```

---

## Task 5: yaml.ts —— 解析 / 序列化 / 视图树

**Files:**
- Create: `web/src/yaml.ts`
- Test: `web/src/yaml.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `web/src/yaml.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseYamlDoc, serializeYamlDoc, yamlTree } from './yaml';

const SAMPLE = [
  '# top comment',
  'name: demo',
  'count: 3',
  'on: true',
  'tags:',
  '  - a',
  '  - b',
  'nested:',
  '  k: v',
  '',
].join('\n');

describe('parseYamlDoc / serializeYamlDoc', () => {
  it('解析合法 YAML 并保留注释', () => {
    const { doc, error } = parseYamlDoc(SAMPLE);
    expect(error).toBe('');
    expect(doc).not.toBeNull();
    expect(serializeYamlDoc(doc!)).toContain('# top comment');
  });
  it('解析非法 YAML 返回 error', () => {
    const { doc, error } = parseYamlDoc('a: [1, 2');
    expect(doc).toBeNull();
    expect(error.length).toBeGreaterThan(0);
  });
});

describe('yamlTree', () => {
  it('构建映射/数组/标量节点', () => {
    const { doc } = parseYamlDoc(SAMPLE);
    const tree = yamlTree(doc!);
    const byKey = Object.fromEntries(tree.map((n) => [n.key, n]));
    expect(byKey.name.kind).toBe('scalar');
    expect(byKey.name.value).toBe('demo');
    expect(byKey.count.valueType).toBe('number');
    expect(byKey.on.valueType).toBe('boolean');
    expect(byKey.tags.kind).toBe('seq');
    expect(byKey.tags.children.map((c) => c.value)).toEqual(['a', 'b']);
    expect(byKey.nested.kind).toBe('map');
    expect(byKey.nested.children[0].key).toBe('k');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/yaml.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `web/src/yaml.ts`：

```ts
import { parseDocument, isMap, isSeq, isScalar, type Document } from 'yaml';

export type YamlValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export interface YamlNode {
  path: Array<string | number>;
  key: string;
  kind: 'map' | 'seq' | 'scalar';
  valueType: YamlValueType;
  value?: string;
  children: YamlNode[];
}

export function parseYamlDoc(text: string): { doc: Document | null; error: string } {
  try {
    const doc = parseDocument(text);
    if (doc.errors && doc.errors.length) return { doc: null, error: String(doc.errors[0].message || doc.errors[0]) };
    return { doc, error: '' };
  } catch (e: any) {
    return { doc: null, error: String(e?.message || e) };
  }
}

export function serializeYamlDoc(doc: Document): string {
  return String(doc);
}

function keyOf(k: unknown): string {
  if (isScalar(k)) return String(k.value ?? '');
  return String(k ?? '');
}

function scalarType(v: unknown): YamlValueType {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
}

function nodeFor(n: unknown, path: Array<string | number>, key: string): YamlNode {
  if (isMap(n)) {
    const children = (n.items as any[]).map((p) => nodeFor(p.value, [...path, keyOf(p.key)], keyOf(p.key)));
    return { path, key, kind: 'map', valueType: 'object', children };
  }
  if (isSeq(n)) {
    const children = (n.items as any[]).map((it, i) => nodeFor(it, [...path, i], String(i)));
    return { path, key, kind: 'seq', valueType: 'array', children };
  }
  const v = isScalar(n) ? (n.value ?? null) : n;
  return { path, key, kind: 'scalar', valueType: scalarType(v), value: v === null ? 'null' : String(v), children: [] };
}

export function yamlTree(doc: Document): YamlNode[] {
  const c = doc.contents;
  if (!c) return [];
  if (isMap(c)) return (c.items as any[]).map((p) => nodeFor(p.value, [keyOf(p.key)], keyOf(p.key)));
  if (isSeq(c)) return (c.items as any[]).map((it, i) => nodeFor(it, [i], String(i)));
  return [nodeFor(c, [], '')];
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/yaml.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/yaml.ts web/src/yaml.test.ts
git commit -m "feat(web): YAML 解析与视图树模型"
```

---

## Task 6: yaml.ts —— 编辑操作（保留注释）

**Files:**
- Modify: `web/src/yaml.ts`
- Test: `web/src/yaml.test.ts`

- [ ] **Step 1: 写失败测试**

追加：

```ts
import { setScalar, addKey, deleteAt, addSeqItem, moveAt } from './yaml';

const BASE = ['# keep me', 'a: 1', 'b:', '  - x', '  - y', ''].join('\n');

describe('YAML 编辑操作', () => {
  it('setScalar 改值并保留注释', () => {
    const { doc } = parseYamlDoc(BASE);
    setScalar(doc!, ['a'], '5', 'number');
    const out = serializeYamlDoc(doc!);
    expect(out).toContain('a: 5');
    expect(out).toContain('# keep me');
  });
  it('addKey 新增键', () => {
    const { doc } = parseYamlDoc(BASE);
    addKey(doc!, [], 'c', 'hi');
    expect(serializeYamlDoc(doc!)).toContain('c: hi');
  });
  it('deleteAt 删除键', () => {
    const { doc } = parseYamlDoc(BASE);
    deleteAt(doc!, ['a']);
    expect(serializeYamlDoc(doc!).includes('a: 1')).toBe(false);
  });
  it('addSeqItem 追加数组元素', () => {
    const { doc } = parseYamlDoc(BASE);
    addSeqItem(doc!, ['b'], 'z');
    const tree = yamlTree(doc!);
    const b = tree.find((n) => n.key === 'b')!;
    expect(b.children.map((c) => c.value)).toEqual(['x', 'y', 'z']);
  });
  it('moveAt 交换数组元素', () => {
    const { doc } = parseYamlDoc(BASE);
    moveAt(doc!, ['b'], 0, 1);
    const tree = yamlTree(doc!);
    const b = tree.find((n) => n.key === 'b')!;
    expect(b.children.map((c) => c.value)).toEqual(['y', 'x']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/yaml.test.ts`
Expected: FAIL，未导出这些函数。

- [ ] **Step 3: 实现**

在 `web/src/yaml.ts` 末尾追加：

```ts
export function setScalar(doc: Document, path: Array<string | number>, raw: string, valueType: YamlValueType): void {
  let v: unknown = raw;
  if (valueType === 'number') v = Number(raw);
  else if (valueType === 'boolean') v = raw === 'true';
  else if (valueType === 'null') v = null;
  doc.setIn(path, v);
}

export function addKey(doc: Document, mapPath: Array<string | number>, key: string, value: unknown = ''): void {
  doc.setIn([...mapPath, key], value);
}

export function deleteAt(doc: Document, path: Array<string | number>): void {
  doc.deleteIn(path);
}

export function addSeqItem(doc: Document, seqPath: Array<string | number>, value: unknown = ''): void {
  doc.addIn(seqPath, value);
}

export function moveAt(doc: Document, parentPath: Array<string | number>, index: number, dir: number): void {
  const node = parentPath.length ? doc.getIn(parentPath, true) : doc.contents;
  if (!isSeq(node)) return;
  const items = node.items as any[];
  const j = index + dir;
  if (j < 0 || j >= items.length) return;
  const a = items[index];
  items[index] = items[j];
  items[j] = a;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/yaml.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/yaml.ts web/src/yaml.test.ts
git commit -m "feat(web): YAML 增删改与排序操作（保留注释）"
```

---

## Task 7: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 加中文词条**

在 `shared/i18n/zh-CN.js` 中 `'fp.curl': '⇀ curl 转请求',` 附近追加（键名不得重复）：

```js
  'fp.view.visual': '可视化',
  'fp.view.curl': 'cURL',
  'fp.curl.editor': '⇀ cURL 编辑器',
  'fp.curl.collection': '请求列表',
  'fp.curl.add': '新增请求',
  'fp.curl.delete': '删除请求',
  'fp.curl.query': '查询参数',
  'fp.curl.add_param': '添加参数',
  'fp.curl.response': '响应',
  'fp.yaml.new_key': '新键名',
  'fp.yaml.add_child': '添加子项',
  'fp.yaml.add_root': '添加键',
  'fp.yaml.delete': '删除',
  'fp.yaml.up': '上移',
  'fp.yaml.down': '下移',
  'fp.yaml.parse_error': 'YAML 解析失败：{msg}',
  'fp.yaml.readonly': '该 YAML 暂不支持可视化编辑，请用代码模式',
```

- [ ] **Step 2: 加英文词条（同键）**

在 `shared/i18n/en.js` 对应位置追加：

```js
  'fp.view.visual': 'Visual',
  'fp.view.curl': 'cURL',
  'fp.curl.editor': '⇀ cURL editor',
  'fp.curl.collection': 'Requests',
  'fp.curl.add': 'Add request',
  'fp.curl.delete': 'Delete request',
  'fp.curl.query': 'Query params',
  'fp.curl.add_param': 'Add param',
  'fp.curl.response': 'Response',
  'fp.yaml.new_key': 'New key',
  'fp.yaml.add_child': 'Add child',
  'fp.yaml.add_root': 'Add key',
  'fp.yaml.delete': 'Delete',
  'fp.yaml.up': 'Move up',
  'fp.yaml.down': 'Move down',
  'fp.yaml.parse_error': 'YAML parse error: {msg}',
  'fp.yaml.readonly': "This YAML can't be edited visually; use code mode",
```

- [ ] **Step 3: 校验键集合与中文命中**

Run: `npm.cmd run check:i18n`
Expected: `未发现中文命中`，无键缺失报错。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n: cURL/YAML 可视化编辑器词条"
```

---

## Task 8: CurlView.vue

**Files:**
- Create: `web/src/components/CurlView.vue`

- [ ] **Step 1: 创建组件**

新建 `web/src/components/CurlView.vue`：

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import {
  parseCurlCommands, replaceCurlCommand, splitUrl, joinUrl,
  type CurlEntry, type CurlRequest, type QueryParam,
} from '../curl';
import { t } from '../i18n';

const props = defineProps<{ projectId: string; path: string; text: string }>();
const emit = defineEmits<{ (e: 'update:text', text: string): void }>();

const localText = ref(props.text);
const entries = computed<CurlEntry[]>(() => parseCurlCommands(localText.value));
const selected = ref(0);
const method = ref('GET');
const baseUrl = ref('');
const params = ref<QueryParam[]>([]);
const headersText = ref('');
const bodyRaw = ref('');
const sending = ref(false);
const err = ref('');
const respStatus = ref<number | null>(null);
const respText = ref('');

watch(() => props.text, (tx) => {
  if (tx !== localText.value) { localText.value = tx; syncFromEntries(); }
});
watch(selected, syncForm);
watch(entries, () => {
  if (selected.value >= entries.value.length) selected.value = Math.max(0, entries.value.length - 1);
  syncForm();
});
onMounted(syncFromEntries);

function current(): CurlEntry | undefined { return entries.value[selected.value]; }
function syncFromEntries() {
  if (selected.value >= entries.value.length) selected.value = Math.max(0, entries.value.length - 1);
  syncForm();
}
function syncForm() {
  const e = current();
  if (!e) { method.value = 'GET'; baseUrl.value = ''; params.value = []; headersText.value = ''; bodyRaw.value = ''; return; }
  method.value = e.request.method;
  const s = splitUrl(e.request.url);
  baseUrl.value = s.base;
  params.value = s.params;
  headersText.value = e.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n');
  bodyRaw.value = e.request.body;
}
function readHeaders(): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const line of headersText.value.split('\n')) {
    const c = line.indexOf(':');
    if (c > 0) out.push({ name: line.slice(0, c).trim(), value: line.slice(c + 1).trim() });
  }
  return out;
}
function commit(next: string) {
  localText.value = next;
  emit('update:text', next);
}
function applyForm() {
  const e = current();
  if (!e) return;
  const req: CurlRequest = { method: method.value.toUpperCase(), url: joinUrl(baseUrl.value, params.value), headers: readHeaders(), body: bodyRaw.value, raw: '' };
  commit(replaceCurlCommand(localText.value, e, req));
}
function addRequest() {
  const tpl = "curl -X GET 'https://example.com'";
  const sep = localText.value && !localText.value.endsWith('\n') ? '\n' : '';
  const next = `${localText.value}${sep}${tpl}\n`;
  commit(next);
  selected.value = parseCurlCommands(next).length - 1;
}
function deleteRequest() {
  const e = current();
  if (!e) return;
  const next = (localText.value.slice(0, e.start) + localText.value.slice(e.end)).replace(/\n{3,}/g, '\n\n');
  commit(next);
  selected.value = Math.max(0, selected.value - 1);
}
function addParam() { params.value.push({ name: '', value: '' }); applyForm(); }
function removeParam(i: number) { params.value.splice(i, 1); applyForm(); }
async function send() {
  if (!current()) return;
  const url = joinUrl(baseUrl.value, params.value);
  if (!url) { err.value = t('fp.curl_url_required'); return; }
  err.value = ''; sending.value = true; respStatus.value = null; respText.value = '';
  try {
    const headers: Record<string, string> = {};
    for (const h of readHeaders()) if (h.name) headers[h.name] = h.value;
    const m = method.value.toUpperCase();
    const r = await fetch(url, { method: m, headers, body: ['GET', 'HEAD'].includes(m) ? undefined : (bodyRaw.value || undefined) });
    respStatus.value = r.status;
    const body = await r.text();
    respText.value = body.length > 300000 ? body.slice(0, 300000) + t('fp.truncated') : body;
  } catch (ex: any) {
    err.value = t('fp.request_failed', { msg: ex?.message || ex });
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="curlview">
    <div class="cvlist">
      <div class="cvhead">
        <span>{{ $t('fp.curl.collection') }}</span>
        <button class="cvx" @click="addRequest">＋</button>
      </div>
      <button v-for="(e, i) in entries" :key="i" class="cvitem" :class="{ on: i === selected }" @click="selected = i">
        <b>{{ e.request.method }}</b> {{ e.request.url }}
      </button>
    </div>
    <div class="cvform">
      <div v-if="!entries.length" class="cvempty">{{ $t('fp.curl_no_command') }}</div>
      <template v-else>
        <div class="cvrow">
          <input v-model="method" class="cvm" @change="applyForm" />
          <input v-model="baseUrl" class="cvu" placeholder="https://…" @change="applyForm" />
          <button class="cvbtn" :disabled="sending" @click="send">{{ sending ? $t('fp.curl.sending') : $t('fp.curl.send') }}</button>
          <button class="cvbtn danger" @click="deleteRequest">{{ $t('fp.curl.delete') }}</button>
        </div>
        <label class="cvlab">{{ $t('fp.curl.query') }}</label>
        <div v-for="(p, i) in params" :key="i" class="cvparam">
          <input v-model="p.name" class="cvpn" placeholder="name" @change="applyForm" />
          <input v-model="p.value" class="c vp" placeholder="value" @change="applyForm" />
          <button class="cvx" @click="removeParam(i)">×</button>
        </div>
        <button class="cvmini" @click="addParam">＋ {{ $t('fp.curl.add_param') }}</button>
        <label class="cvlab">{{ $t('fp.curl.headers') }}</label>
        <textarea v-model="headersText" class="cvta" rows="3" :placeholder="$t('fp.curl.headers_placeholder')" @change="applyForm" />
        <label class="cvlab">{{ $t('fp.curl.body') }}</label>
        <textarea v-model="bodyRaw" class="cvta" rows="4" :placeholder="$t('fp.curl.body_placeholder')" @change="applyForm" />
        <div v-if="err" class="cverr">{{ err }}</div>
        <label class="cvlab">{{ $t('fp.curl.response') }}</label>
        <div v-if="respStatus !== null" class="cvstat">HTTP {{ respStatus }}</div>
        <pre v-if="respText" class="cvpre">{{ respText }}</pre>
      </template>
    </div>
  </div>
</template>

<style scoped>
.curlview { display: flex; flex: 1; min-height: 0; }
.cvlist { width: 220px; flex: none; border-right: 1px solid var(--bd); overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.cvhead { display: flex; align-items: center; justify-content: space-between; color: var(--tx3); font-size: 12px; padding: 2px 4px; }
.cvitem { text-align: left; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--tx2); padding: 4px 6px; font-size: 12px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: inherit; }
.cvitem:hover { background: var(--bg5); }
.cvitem.on { background: var(--ac); color: var(--onac); border-color: var(--ac); }
.cvform { flex: 1; min-width: 0; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.cvrow { display: flex; gap: 6px; align-items: center; }
.cvm { width: 90px; }
.cvu { flex: 1; min-width: 0; }
.cvpn { width: 140px; }
.cvp { flex: 1; min-width: 0; }
.cvparam { display: flex; gap: 6px; align-items: center; }
.cvempty { color: var(--tx4); font-size: 13px; padding: 20px; }
.cvlab { color: var(--tx3); font-size: 12px; margin-top: 4px; }
.cvta, .cvform input { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.cvbtn { background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
.cvbtn.danger { background: var(--bg5); color: var(--tx2); border-color: var(--bd); }
.cvmini { align-self: flex-start; background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: inherit; }
.cvx { background: none; border: none; color: var(--tx3); cursor: pointer; font-size: 14px; }
.cvstat { color: var(--tx3); font-size: 12px; }
.cvpre { background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px; font-size: 12px; overflow: auto; max-height: 40vh; white-space: pre-wrap; word-break: break-all; }
.cverr { color: var(--err); font-size: 12px; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（此组件尚未被引用，若不通过先修类型）。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/CurlView.vue
git commit -m "feat(web): CurlView Postman 式请求编辑器"
```

---

## Task 9: YamlView.vue

**Files:**
- Create: `web/src/components/YamlView.vue`

- [ ] **Step 1: 创建组件**

新建 `web/src/components/YamlView.vue`：

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  parseYamlDoc, serializeYamlDoc, yamlTree, setScalar, addKey, deleteAt, addSeqItem, moveAt,
  type YamlNode,
} from '../yaml';
import { t } from '../i18n';

const props = defineProps<{ text: string }>();
const emit = defineEmits<{ (e: 'update:text', text: string): void }>();

const localText = ref(props.text);
const parsed = computed(() => parseYamlDoc(localText.value));
const error = computed(() => parsed.value.error);
const collapsed = ref<Set<string>>(new Set());

watch(() => props.text, (tx) => { if (tx !== localText.value) localText.value = tx; });

interface FlatNode extends YamlNode { depth: number; }
function pathKey(p: Array<string | number>): string { return p.join('\u0000'); }
function isCollapsed(n: YamlNode): boolean { return collapsed.value.has(pathKey(n.path)); }
function toggle(n: YamlNode) {
  const s = new Set(collapsed.value);
  const k = pathKey(n.path);
  if (s.has(k)) s.delete(k); else s.add(k);
  collapsed.value = s;
}
const flat = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (nodes: YamlNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.children.length && !isCollapsed(n)) walk(n.children, depth + 1);
    }
  };
  walk(yamlTree(parsed.value.doc!), 0);
  return out;
});

function commit(next: string) {
  localText.value = next;
  emit('update:text', next);
}
function withDoc(fn: (doc: NonNullable<ReturnType<typeof parseYamlDoc>['doc']>) => void) {
  const d = parsed.value.doc;
  if (!d) return;
  fn(d);
  commit(serializeYamlDoc(d));
}
function onScalar(n: YamlNode, val: string) { withDoc((d) => setScalar(d, n.path, val, n.valueType)); }
function onAddChild(n: YamlNode) {
  if (n.kind === 'seq') { withDoc((d) => addSeqItem(d, n.path, '')); return; }
  const key = window.prompt(t('fp.yaml.new_key')) || '';
  if (key) withDoc((d) => addKey(d, n.path, key, ''));
}
function onAddRoot() {
  const key = window.prompt(t('fp.yaml.new_key')) || '';
  if (key) withDoc((d) => addKey(d, [], key, ''));
}
function onDelete(n: YamlNode) { withDoc((d) => deleteAt(d, n.path)); }
function onMove(n: YamlNode, dir: number) {
  const parent = n.path.slice(0, -1);
  const idx = Number(n.path[n.path.length - 1]);
  withDoc((d) => moveAt(d, parent, idx, dir));
}
</script>

<template>
  <div class="yamlview">
    <div v-if="error" class="yverr">{{ $t('fp.yaml.parse_error', { msg: error }) }}</div>
    <template v-else>
      <div class="yvbar"><button class="yvmini" @click="onAddRoot">＋ {{ $t('fp.yaml.add_root') }}</button></div>
      <div class="yvtree">
        <div v-for="n in flat" :key="pathKey(n.path)" class="yvrow" :style="{ paddingLeft: (n.depth * 16 + 6) + 'px' }">
          <span class="yvtog" @click="n.children.length && toggle(n)">{{ n.children.length ? (isCollapsed(n) ? '▸' : '▾') : '' }}</span>
          <span class="yvkey">{{ n.key }}</span>
          <template v-if="n.kind === 'scalar'">
            <input class="yvval" :value="n.value" @change="onScalar(n, ($event.target as HTMLInputElement).value)" />
          </template>
          <template v-else>
            <span class="yvtype">{{ n.kind === 'seq' ? '[ ]' : '{ }' }}</span>
          </template>
          <span class="yvacts">
            <button class="yvmini" @click="onAddChild(n)">＋</button>
            <button v-if="n.kind === 'seq'" class="yvmini" @click="onMove(n, -1)">↑</button>
            <button v-if="n.kind === 'seq'" class="yvmini" @click="onMove(n, 1)">↓</button>
            <button class="yvmini danger" @click="onDelete(n)">×</button>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.yamlview { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; }
.yvbar { padding: 6px 10px; border-bottom: 1px solid var(--bd); }
.yvtree { padding: 6px 4px; }
.yvrow { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 3px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.yvrow:hover { background: var(--bg5); }
.yvtog { width: 12px; flex: none; color: var(--tx3); cursor: pointer; }
.yvkey { color: var(--tx2); }
.yvtype { color: var(--tx3); }
.yvval { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 3px; padding: 2px 6px; font-size: 12px; font-family: inherit; min-width: 120px; }
.yvacts { margin-left: auto; display: flex; gap: 3px; opacity: 0; }
.yvrow:hover .yvacts { opacity: 1; }
.yvmini { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 3px; padding: 1px 6px; font-size: 11px; cursor: pointer; font-family: inherit; }
.yvmini.danger:hover { border-color: var(--err); color: var(--err); }
.yverr { color: var(--err); padding: 12px; font-size: 13px; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（`parsed.value.doc!` 在 `error===''` 时非空）。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/YamlView.vue
git commit -m "feat(web): YamlView 可视化节点树编辑"
```

---

## Task 10: FilePreview 集成 + 文件树图标

**Files:**
- Modify: `web/src/components/FilePreview.vue`
- Modify: `web/src/components/TreeNode.vue`

- [ ] **Step 1: FilePreview —— 引入组件与判定**

在 `FilePreview.vue` 的 import 区（`import { parseCurl, type CurlRequest } from '../curl';` 附近）改为：

```ts
import { parseCurlCommands, type CurlRequest } from '../curl';
import CurlView from './CurlView.vue';
import YamlView from './YamlView.vue';
```

- [ ] **Step 2: FilePreview —— 类型与模式判定**

把第 60 行附近的：

```ts
const viewMode = ref<'preview' | 'code'>(isMarkdownFile(props.name) || isHtmlFile.value ? 'preview' : 'code');
const showEditor = computed(() => kind.value === 'text' && (!hasPreviewToggle.value || viewMode.value === 'code'));
```

替换为：

```ts
const isYaml = computed(() => ['yml', 'yaml'].includes(ext.value));
const isCurlFile = computed(() => ['http', 'rest', 'curl'].includes(ext.value));
type ViewMode = 'preview' | 'code' | 'visual' | 'curl';
function defaultMode(): ViewMode {
  if (isMarkdownFile(props.name) || isHtmlFile.value) return 'preview';
  if (isCurlFile.value) return 'curl';
  return 'code';
}
const viewMode = ref<ViewMode>(defaultMode());
const showEditor = computed(() => kind.value === 'text' && viewMode.value === 'code');
```

- [ ] **Step 3: FilePreview —— 加载时重置模式**

在 `load()` 的 `status.value = 'ok';` 之后、`if (f.binary === true)` 之前，插入：

```ts
    viewMode.value = defaultMode();
```

- [ ] **Step 4: FilePreview —— 外部文本写回 + 无编辑器时也能保存**

在 `function onRetrySave()` 之前插入：

```ts
function applyExternalText(next: string) {
  raw.value = next;
  if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  scheduleSave();
}
```

同时把 `flush()` 改为以 `raw.value` 为准（`raw` 已在 `docChanged`/`load` 中与编辑器同步），
使 curl/visual 模式下（编辑器未挂载）也能落盘：

```ts
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!dirty.value) return;
  const snapshot = raw.value;
  saveChain = saveChain.then(() => doWrite(snapshot)).catch(() => { /* doWrite 已处理 */ });
}
```

并把 `saveNow()` 的守卫改为不依赖 `view`：

```ts
function saveNow() {
  if (!dirty.value) return;
  saveState.value = 'idle';
  flush();
}
```

- [ ] **Step 5: FilePreview —— 工具菜单改为切到 curl 视图**

把 `runTools` 中 `else if (t === 'curl') openCurl();` 改为：

```ts
  else if (t === 'curl') openCurlView();
```

在 `runTools` 之后新增：

```ts
function openCurlView() {
  if (!parseCurlCommands(raw.value).length) { setToolMsg(t('fp.curl_no_command'), false); return; }
  viewMode.value = 'curl';
}
```

- [ ] **Step 6: FilePreview —— 删除旧 curl 弹窗逻辑**

删除第 698-748 行整段 `// —— curl → 构建请求 ——`（`curlOpen`、`curlErr`、`req`、`headerLines`、`sending`、`respStatus`、`respText`、`curlUrl`、`reqBody`、`openCurl`、`applyHeaderEdits`、`sendRequest`）。

- [ ] **Step 7: FilePreview —— 模板：模式切换段**

把第 828-831 行的 seg：

```html
          <div v-if="hasPreviewToggle" class="seg">
            <button type="button" :class="{ on: viewMode === 'preview' }" @click="viewMode = 'preview'">{{ $t('fp.preview') }}</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">{{ isHtmlFile ? $t('fp.source') : $t('fp.code') }}</button>
          </div>
```

替换为：

```html
          <div v-if="hasPreviewToggle" class="seg">
            <button type="button" :class="{ on: viewMode === 'preview' }" @click="viewMode = 'preview'">{{ $t('fp.preview') }}</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">{{ isHtmlFile ? $t('fp.source') : $t('fp.code') }}</button>
          </div>
          <div v-else-if="isYaml" class="seg">
            <button type="button" :class="{ on: viewMode === 'visual' }" @click="viewMode = 'visual'">{{ $t('fp.view.visual') }}</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">{{ $t('fp.code') }}</button>
          </div>
          <div v-else-if="isCurlFile" class="seg">
            <button type="button" :class="{ on: viewMode === 'curl' }" @click="viewMode = 'curl'">{{ $t('fp.view.curl') }}</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">{{ $t('fp.code') }}</button>
          </div>
```

- [ ] **Step 8: FilePreview —— 模板：挂载新视图**

在 `<div v-show="showEditor" ref="editorHost" class="editor" />` 之后插入：

```html
        <CurlView v-if="viewMode === 'curl' && status === 'ok' && !isBinary" :project-id="projectId" :path="path" :text="raw" @update:text="applyExternalText" />
        <YamlView v-else-if="viewMode === 'visual' && status === 'ok' && !isBinary" :text="raw" @update:text="applyExternalText" />
```

- [ ] **Step 9: FilePreview —— 模板：删除旧 curl 面板**

删除第 904-917 行的 `<div v-if="curlOpen" class="curlpanel"> … </div>` 整块。样式中的 `.curlpanel` 等规则可保留（无引用不影响），也可一并删除。

- [ ] **Step 10: FilePreview —— 菜单项文案**

把 `{{ $t('fp.curl') }}` 这一项保留（触发 `openCurlView`），确保它仍指向 `runTools('curl')`。

- [ ] **Step 11: TreeNode —— 图标**

在 `TreeNode.vue` 的 `CODE` 常量后追加：

```ts
const YAML = new Set(['yml', 'yaml']);
const CURL = new Set(['http', 'rest', 'curl']);
```

在 `fileIcon()` 中，`if (CODE[e]) return CODE[e];` 之后插入：

```ts
  if (YAML.has(e)) return '📐';
  if (CURL.has(e)) return '⇀';
```

- [ ] **Step 12: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 13: Commit**

```bash
git add web/src/components/FilePreview.vue web/src/components/TreeNode.vue
git commit -m "feat(web): FilePreview 接入 cURL/YAML 视图与文件树图标"
```

---

## Task 11: 全量验证与人工验收

**Files:**
- 无（验证）

- [ ] **Step 1: 单元测试 + 类型 + i18n + 构建**

Run: `npm.cmd test`
Expected: server 与 web 全部 PASS。

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd run check:i18n`
Expected: `未发现中文命中`。

Run: `npm.cmd run build:web`
Expected: 构建成功。

- [ ] **Step 2: 人工验收（可选，需重启 web dev）**

后台启动（非阻塞）：`Start-Process -FilePath npm.cmd -ArgumentList 'run','dev:web' -RedirectStandardOutput dev-web.log -RedirectStandardError dev-web.err.log`。打开 http://localhost:5173：

1. 打开含 curl 的文件或 `.http` 文件 → 左侧出现请求集合；改表单后切「代码」文本同步；点发送能看到状态与响应。
2. 打开含注释的 `.yaml` → 「可视化」树可增删改、数组上下移；切「代码」文本同步且注释仍在；Ctrl+S 保存后重开仍正确。
3. 打开非法 YAML → 显示解析错误，不崩溃，可切代码模式。

- [ ] **Step 3: Commit（如验收中有微调）**

```bash
git add <按实际改动文件>
git commit -m "fix(web): cURL/YAML 视图验收修正"
```

---

## Self-Review 记录

- **Spec 覆盖：** cURL 解析/序列化/替换/查询（Task 2-4）＋ CurlView（Task 8）＋ 触发/双模式（Task 10）；YAML 解析/树/编辑/保注释（Task 5-6）＋ YamlView（Task 9）＋ 双模式（Task 10）；i18n（Task 7）；文件树图标（Task 10）；验收（Task 11）。Spec §4-12 均有对应任务。
- **占位符：** 无 TBD/TODO；每步含完整代码与命令。
- **类型一致性：** `CurlEntry`/`CurlRequest`/`QueryParam`（Task 2-4）在 Task 8 使用；`YamlNode`/`YamlValueType` 及 `parseYamlDoc/serializeYamlDoc/yamlTree/setScalar/addKey/deleteAt/addSeqItem/moveAt`（Task 5-6）在 Task 9 使用；`viewMode` 取值 `'preview'|'code'|'visual'|'curl'` 在 Task 10 一致。
- **已知取舍：** `buildCurl` 值内含同种引号时转义不完美（Spec §10 已声明边界）；多文档 YAML 降级只读由 `parseYamlDoc` 的 `error` 分支覆盖（错误条 + 可切代码模式）。
