# Mermaid 流程图切换 X6（第一期：只读渲染）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Mermaid flowchart 的只读渲染从 ECharts 换成按需加载的 X6，支持正交连线、缩放/平移、子图与坐标注释；编辑器与回写放到第二期。

**Architecture:** 解析仍由现有 `parseFlowchart` 完成，新增纯函数把 spec 转成 X6 图模型；X6 渲染模块独立、按需加载（Web 用 Vite 动态 import，静态页用 esbuild 单独打包的 `__devflow_flowx6__.js`）。坐标注释 `%% x6-positions` 在解析后覆盖自动布局。

**Tech Stack:** `@antv/x6`、`@dagrejs/dagre`、markdown-it、esbuild、Vitest。

---

### Task 1: 安装 X6 依赖并导出模块

**Files:**
- Modify: `web/package.json`
- Modify: `server/package.json`
- Modify: `shared/package.json`
- Create: `shared/markdown-flowchart-graph.js`
- Create: `shared/markdown-flowchart-graph.d.ts`
- Create: `shared/markdown-flowchart-x6.js`
- Create: `shared/markdown-flowchart-x6.d.ts`

- [ ] **Step 1: 安装依赖**

Run:
```bash
npm.cmd install --workspace web @antv/x6
npm.cmd install --workspace server @antv/x6
```
Expected: `web/package.json`、`server/package.json` 出现 `@antv/x6`。

- [ ] **Step 2: 增加 shared 导出**

在 `shared/package.json` 的 `exports` 加：

```json
"./markdown-flowchart-graph": { "types": "./markdown-flowchart-graph.d.ts", "default": "./markdown-flowchart-graph.js" },
"./markdown-flowchart-x6": { "types": "./markdown-flowchart-x6.d.ts", "default": "./markdown-flowchart-x6.js" },
```

- [ ] **Step 3: 写纯模型函数**

```js
// shared/markdown-flowchart-graph.js
export function buildFlowGraphModel(spec, theme = {}) {
  const text = theme.text || '#d5dae1';
  const axis = theme.axis || '#3a4250';
  const nodes = spec.nodes.map((n) => ({
    id: n.id,
    shape: 'rect',
    x: n.x - n.w / 2,
    y: n.y - n.h / 2,
    width: n.w,
    height: n.h,
    zIndex: 2,
    attrs: {
      body: { fill: n.fill, stroke: n.stroke, strokeWidth: 1.5, rx: 8, ry: 8 },
      label: { text: n.label, fill: n.color, fontSize: 12 },
    },
  }));
  const groups = (spec.groups || []).map((g) => ({
    id: g.id,
    shape: 'rect',
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
    zIndex: 0,
    attrs: {
      body: { fill: 'transparent', stroke: axis, strokeDasharray: '4 3', rx: 10, ry: 10 },
      label: { text: g.label || '', fill: text, fontSize: 11, refY: 12 },
    },
  }));
  const edges = spec.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    router: { name: 'manhattan' },
    connector: { name: 'rounded' },
    zIndex: 1,
    attrs: { line: { stroke: axis, strokeWidth: 1.4, targetMarker: { name: 'block', width: 7, height: 7 } } },
    labels: e.label ? [{ attrs: { label: { text: e.label, fill: text, fontSize: 11 } } }] : [],
  }));
  return { nodes: groups.concat(nodes), edges, width: spec.width, height: spec.height };
}
```

```ts
// shared/markdown-flowchart-graph.d.ts
export interface FlowGraphNode { id: string; shape: 'rect'; x: number; y: number; width: number; height: number; zIndex: number; attrs: Record<string, unknown>; }
export interface FlowGraphEdge { id: string; source: string; target: string; router: { name: string }; connector: { name: string }; zIndex: number; attrs: Record<string, unknown>; labels: unknown[]; }
export function buildFlowGraphModel(spec: unknown, theme?: { text?: string; axis?: string }): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[]; width: number; height: number };
```

- [ ] **Step 4: 写 X6 渲染模块**

```js
// shared/markdown-flowchart-x6.js
import { Graph } from '@antv/x6';
import { buildFlowGraphModel } from './markdown-flowchart-graph.js';

export function renderFlowchartX6(el, spec, options = {}) {
  const model = buildFlowGraphModel(spec, options.theme || {});
  el.style.height = `${Math.max(240, Math.min(760, model.height))}px`;
  const graph = new Graph({
    container: el,
    width: el.clientWidth || model.width,
    height: el.clientHeight || model.height,
    background: { color: 'transparent' },
    panning: { enabled: true },
    mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.3, maxScale: 2.5 },
    grid: { visible: false },
    interacting: false,
    connecting: { router: 'manhattan' },
  });
  graph.fromJSON({ nodes: model.nodes, edges: model.edges });
  graph.zoomToFit({ padding: 16, maxScale: 1 });
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => graph.resize(el.clientWidth || model.width, el.clientHeight || model.height))
    : null;
  if (ro) ro.observe(el);
  return {
    dispose() {
      if (ro) ro.disconnect();
      graph.dispose();
    },
  };
}
```

```ts
// shared/markdown-flowchart-x6.d.ts
export function renderFlowchartX6(el: HTMLElement, spec: unknown, options?: { theme?: { text?: string; axis?: string } }): { dispose(): void };
```

- [ ] **Step 5: 提交**

```bash
git add web/package.json server/package.json package-lock.json shared/package.json shared/markdown-flowchart-graph.js shared/markdown-flowchart-graph.d.ts shared/markdown-flowchart-x6.js shared/markdown-flowchart-x6.d.ts
git commit -m "feat(flowchart): 引入 X6 渲染模块"
```

---

### Task 2: 坐标注释解析

**Files:**
- Modify: `shared/markdown-charts.js:264-287`
- Test: `web/src/markdown-enhance/charts.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('解析 %% x6-positions 并覆盖节点/子图坐标', () => {
  const spec = parseMermaidChart([
    'flowchart TD',
    '  A[开始] --> B[结束]',
    '%% x6-positions: {"A":{"x":10,"y":20},"g1":{"x":0,"y":0,"w":200,"h":120}}',
  ].join('\n')) as any;
  const a = spec.nodes.find((n: any) => n.id === 'A');
  expect(a.x).toBe(10 + a.w / 2);
  expect(a.y).toBe(20 + a.h / 2);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web exec -- vitest run src/markdown-enhance/charts.test.ts`
Expected: FAIL，坐标仍为自动布局。

- [ ] **Step 3: 实现解析**

在 `shared/markdown-charts.js` 中加入：

```js
function readX6Positions(lines) {
  for (const line of lines) {
    const m = /^%%\s*x6-positions:\s*(\{.*\})\s*$/.exec(line);
    if (!m) continue;
    try { return JSON.parse(m[1]); } catch { return null; }
  }
  return null;
}

function applyX6Positions(spec, positions) {
  if (!spec || !positions) return spec;
  for (const n of spec.nodes) {
    const p = positions[n.id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      n.x = p.x + n.w / 2;
      n.y = p.y + n.h / 2;
    }
  }
  for (const g of spec.groups || []) {
    const p = positions[g.id];
    if (!p) continue;
    if (Number.isFinite(p.x)) g.x = p.x;
    if (Number.isFinite(p.y)) g.y = p.y;
    if (Number.isFinite(p.w)) g.width = p.w;
    if (Number.isFinite(p.h)) g.height = p.h;
  }
  return spec;
}
```

把 `parseMermaidChart` 的 flowchart 分支改成：

```js
  if (/^(flowchart|graph)\b/.test(head)) {
    return applyX6Positions(parseFlowchart(lines), readX6Positions(lines));
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web exec -- vitest run src/markdown-enhance/charts.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add shared/markdown-charts.js web/src/markdown-enhance/charts.test.ts
git commit -m "feat(flowchart): 支持 x6-positions 坐标注释"
```

---

### Task 3: 图模型单元测试

**Files:**
- Create: `web/src/markdown-enhance/flowchart-graph.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from 'vitest';
import { buildFlowGraphModel } from '@devflow/shared/markdown-flowchart-graph';

const spec = {
  kind: 'flowchart',
  direction: 'TD',
  nodes: [{ id: 'A', label: '开始', group: '', x: 100, y: 80, w: 120, h: 44, fill: '#fff', stroke: '#000', color: '#111' }],
  groups: [{ id: 'g1', label: '阶段', x: 20, y: 20, width: 220, height: 140 }],
  edges: [{ source: 'A', target: 'B', label: '是' }],
  width: 300,
  height: 200,
};

describe('buildFlowGraphModel', () => {
  it('节点从中心坐标转左上角，边使用 manhattan 路由', () => {
    const m = buildFlowGraphModel(spec as any, { text: '#fff', axis: '#333' });
    const a = m.nodes.find((n) => n.id === 'A')!;
    expect(a.x).toBe(40);
    expect(a.y).toBe(58);
    const e = m.edges[0];
    expect(e.router.name).toBe('manhattan');
    expect(e.labels[0]).toMatchObject({ attrs: { label: { text: '是' } } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web exec -- vitest run src/markdown-enhance/flowchart-graph.test.ts`
Expected: FAIL（模块尚未导出或结构不符）。

- [ ] **Step 3: 修正模型实现**

确认 `shared/markdown-flowchart-graph.js` 与 `shared/package.json` 导出一致；若测试失败按断言调整。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web exec -- vitest run src/markdown-enhance/flowchart-graph.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/markdown-enhance/flowchart-graph.test.ts
git commit -m "test(flowchart): 覆盖 X6 图模型转换"
```

---

### Task 4: enhanceCharts 接入 X6

**Files:**
- Modify: `shared/markdown-charts.js:528-639`
- Modify: `shared/markdown-charts.d.ts`
- Modify: `web/src/markdown-enhance/index.ts`
- Modify: `server/markdown-page.js`

- [ ] **Step 1: 修改 enhanceCharts**

在 `shared/markdown-charts.js` 里，`enhanceCharts` 增加 `options.loadFlowX6`：

```js
export async function enhanceCharts(container, echarts, options = {}) {
  const items = [];
  for (const pre of Array.from(container.querySelectorAll('pre.mermaid'))) {
    const spec = parseMermaidChart(pre.textContent || '');
    if (!spec) continue;
    if (spec.kind === 'flowchart') {
      if (!options.loadFlowX6) continue;
      const host = document.createElement('div');
      host.className = 'md-echart';
      host.dataset.flowSrc = pre.textContent || '';
      pre.before(host);
      try {
        const mod = await options.loadFlowX6();
        const chart = mod.renderFlowchartX6(host, spec, { theme: options.flowTheme });
        pre.remove();
        items.push({ host, ...chart });
      } catch {
        host.remove();
      }
      continue;
    }
    if (!echarts) continue;
    const host = document.createElement('div');
    host.className = 'md-echart';
    pre.before(host);
    try {
      const chart = await renderChart(host, spec, echarts, options);
      pre.remove();
      items.push({ host, ...chart });
    } catch {
      host.remove();
      try { pre.dataset.processed = 'error'; } catch { /* ignore */ }
    }
  }
  return items;
}
```

- [ ] **Step 2: Web 注入加载器**

`web/src/markdown-enhance/index.ts` 调用 `enhanceCharts` 时加：

```ts
loadFlowX6: () => import('@devflow/shared/markdown-flowchart-x6'),
```

- [ ] **Step 3: 静态页注入加载器**

`server/markdown-page.js` 的页面脚本 `opts` 中加：

```js
'loadFlowX6:()=>import(\'./__devflow_flowx6__.js\'),'
```

- [ ] **Step 4: 跑测试**

Run:
```bash
npm.cmd --prefix web exec -- vitest run src/markdown-enhance/charts.test.ts
npm.cmd run typecheck
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add shared/markdown-charts.js shared/markdown-charts.d.ts web/src/markdown-enhance/index.ts server/markdown-page.js
git commit -m "feat(flowchart): 预览接入 X6 只读渲染"
```

---

### Task 5: 静态页 X6 资源

**Files:**
- Modify: `server/mermaid-asset.js`
- Modify: `server/proxy-static.js:7-230`
- Modify: `server/markdown-page.js`
- Test: `server/test/markdown-page.test.js`

- [ ] **Step 1: 写失败测试**

```js
test('流程图页面注入 X6 资源与加载器', () => {
  const html = renderMarkdownDocument('flowchart TD\n  A-->B', 't');
  assert.match(html, /__devflow_flowx6__\.js/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/markdown-page.test.js`
Expected: FAIL。

- [ ] **Step 3: 增加资源与路由**

`server/mermaid-asset.js`：

```js
export const FLOW_X6_SCRIPT_NAME = '__devflow_flowx6__.js';

let flowX6Cached = null;
export function readFlowX6Script() {
  if (flowX6Cached) return flowX6Cached;
  const require = createRequire(import.meta.url);
  const sharedDir = path.dirname(require.resolve('@devflow/shared'));
  const entry = path.join(sharedDir, 'markdown-flowchart-x6.js');
  const result = buildSync({
    entryPoints: [entry],
    absWorkingDir: sharedDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  flowX6Cached = Buffer.from(result.outputFiles[0].text, 'utf8');
  return flowX6Cached;
}
```

`server/proxy-static.js` 的脚本分支增加：

```js
: assetName === FLOW_X6_SCRIPT_NAME
  ? readFlowX6Script()
```

`server/markdown-page.js` 的 script 注入条件加上流程图：

```js
const hasFlowchart = /<pre class="[^"]*\bmermaid\b[^>]*>\s*(?:flowchart|graph)\b/.test(body);
if (hasFlowchart) tags.push(`<script type="module">window.__dfFlowX6Url='./${FLOW_X6_SCRIPT_NAME}';</script>`);
```

并把加载器改成：

```js
'loadFlowX6:()=>import(window.__dfFlowX6Url||\'./__devflow_flowx6__.js\'),'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/markdown-page.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/mermaid-asset.js server/proxy-static.js server/markdown-page.js server/test/markdown-page.test.js
git commit -m "feat(flowchart): 静态页按需加载 X6"
```

---

### Task 6: 文案、README 与全量验证

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `test/markdown_data/mermaid-flowchart.md`（可选示例）

- [ ] **Step 1: 更新 README**

中文加：流程图改用 X6 渲染，支持正交连线、缩放/平移、子图与坐标注释。英文对应。

- [ ] **Step 2: 全量验证**

Run:
```bash
npm.cmd run check:i18n
npm.cmd --prefix web exec -- vitest run src/markdown-enhance/charts.test.ts src/markdown-enhance/flowchart-graph.test.ts
node --test server/test/markdown-page.test.js
npm.cmd run typecheck
```
Expected: 全部 PASS。

- [ ] **Step 3: 提交**

```bash
git add README.md README.zh-CN.md test/markdown_data/mermaid-flowchart.md
git commit -m "docs(flowchart): 说明 X6 渲染能力"
```

---

## 第二期（编辑器，另开计划）

- 全屏编辑器、拖拽/连线/增删、子图编辑。
- Mermaid 原文保留与序列化（除拓扑/坐标外不改原属性）。
- 应用内回写 `.md`；静态页复制 + 下载当前块。
- 坐标注释由编辑器生成。

## 自审

- 覆盖：X6 渲染、坐标注释、Web/静态页加载、测试、文档均有任务；编辑器明确放第二期。
- 占位符：无 TBD；关键代码已给出。
- 一致性：`buildFlowGraphModel`、`renderFlowchartX6`、`loadFlowX6`、`__devflow_flowx6__.js` 命名在任务间保持一致。
