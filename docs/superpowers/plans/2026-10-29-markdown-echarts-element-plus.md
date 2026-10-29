# Markdown 图表与表格增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让前端 Markdown 里的 Mermaid `xychart-beta` / `pie` 用 ECharts 渲染，所有 Markdown 表格用 Element Plus `<el-table>` 渲染，其余 Mermaid 类型保持原样。

**Architecture:** 新增 `web/src/markdown-enhance/` 目录，在 HTML 插入 DOM 后做一次增强：解析表格并挂载 `el-table`，解析支持的 Mermaid 图并用 ECharts 渲染，不支持的回落现有 `renderMermaid`。`shared/markdown.js` 与服务端静态页不动。

**Tech Stack:** Vue 3、TypeScript、ECharts 6、Element Plus 2、Mermaid 11、Vitest + happy-dom。

---

## 文件结构

- 新建 `web/src/markdown-enhance/charts.ts`：Mermaid 图表解析（纯函数）+ ECharts 渲染
- 新建 `web/src/markdown-enhance/charts.test.ts`：解析单测
- 新建 `web/src/markdown-enhance/table.ts`：原生表格提取（纯函数）+ `el-table` 挂载
- 新建 `web/src/markdown-enhance/table.test.ts`：提取单测
- 新建 `web/src/markdown-enhance/index.ts`：`enhanceMarkdown` / `disposeMarkdown` 编排
- 新建 `web/src/markdown-enhance/useEnhance.ts`：Vue 组合式接入
- 修改 `web/src/components/DocViewer.vue`：`renderMermaid` → `enhanceMarkdown`
- 修改 `web/src/components/AppMarketView.vue`、`web/src/jobs/JobsView.vue`、`web/src/scheduler/SchedulerReportView.vue`、`web/src/scheduler/SchedulerView.vue`、`web/src/components/WorkflowFilesTab.vue`：接入 `useMarkdownEnhance`
- 修改 `shared/markdown.css`：`.md-el-table` / `.md-echart` 间距与高度
- 修改 `AGENTS.md`：目录速览补一行

---

### Task 1: Mermaid 图表解析

**Files:**
- Create: `web/src/markdown-enhance/charts.ts`
- Test: `web/src/markdown-enhance/charts.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/markdown-enhance/charts.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseMermaidChart } from './charts';

describe('parseMermaidChart', () => {
  it('解析 xychart 的标题、坐标轴与混合系列', () => {
    const spec = parseMermaidChart([
      'xychart-beta',
      '    title "Sales Revenue"',
      '    x-axis "Quarter" [Q1, Q2, Q3]',
      '    y-axis "Revenue" 0 --> 100',
      '    bar [10, 30, 20]',
      '    line [15, 25, 35]',
    ].join('\n'));
    expect(spec).toEqual({
      kind: 'xychart',
      title: 'Sales Revenue',
      xTitle: 'Quarter',
      categories: ['Q1', 'Q2', 'Q3'],
      yTitle: 'Revenue',
      yMin: 0,
      yMax: 100,
      series: [
        { type: 'bar', data: [10, 30, 20] },
        { type: 'line', data: [15, 25, 35] },
      ],
    });
  });

  it('解析只有 line、没有轴标题的 xychart', () => {
    const spec = parseMermaidChart([
      'xychart-beta',
      '  x-axis [a, b]',
      '  line [1, 2]',
    ].join('\n'));
    expect(spec).toMatchObject({
      kind: 'xychart',
      title: '',
      xTitle: '',
      categories: ['a', 'b'],
      series: [{ type: 'line', data: [1, 2] }],
    });
  });

  it('类目与数据长度不一致时返回 null', () => {
    const spec = parseMermaidChart([
      'xychart-beta',
      '  x-axis [a, b, c]',
      '  line [1, 2]',
    ].join('\n'));
    expect(spec).toBeNull();
  });

  it('解析 pie 的标题与数据', () => {
    const spec = parseMermaidChart([
      'pie title Pets adopted',
      '    "Dogs" : 386',
      '    "Cats" : 85',
    ].join('\n'));
    expect(spec).toEqual({
      kind: 'pie',
      title: 'Pets adopted',
      data: [
        { name: 'Dogs', value: 386 },
        { name: 'Cats', value: 85 },
      ],
    });
  });

  it('pie 没有数据项时返回 null', () => {
    expect(parseMermaidChart('pie title Empty')).toBeNull();
  });

  it('非目标类型返回 null', () => {
    expect(parseMermaidChart('graph LR\nA-->B')).toBeNull();
    expect(parseMermaidChart('sequenceDiagram\nA->>B: hi')).toBeNull();
    expect(parseMermaidChart('')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web test -- run src/markdown-enhance/charts.test.ts`

Expected: FAIL，`Failed to resolve import "./charts"` 或 `parseMermaidChart is not a function`。

- [ ] **Step 3: 写实现**

创建 `web/src/markdown-enhance/charts.ts`：

```ts
export type ChartSeries = { type: 'line' | 'bar'; data: number[] };

export type ChartSpec =
  | {
      kind: 'xychart';
      title: string;
      xTitle: string;
      categories: string[];
      yTitle: string;
      yMin?: number;
      yMax?: number;
      series: ChartSeries[];
    }
  | { kind: 'pie'; title: string; data: { name: string; value: number }[] };

export type ChartHandle = { dispose(): void };

function unquote(text: string): string {
  const s = text.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseNumberList(text: string): number[] | null {
  const m = text.match(/\[([^\]]*)\]/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const out = parts.map(Number);
  if (!out.length || out.some((n) => !Number.isFinite(n))) return null;
  return out;
}

function parseCategories(text: string): { label: string; items: string[] } | null {
  const m = text.match(/\[([^\]]*)\]/);
  if (!m) return null;
  const items = m[1].split(',').map((s) => unquote(s)).filter((s) => s.length > 0);
  if (!items.length) return null;
  const label = text.match(/^\s*"([^"]*)"/) || text.match(/^\s*'([^']*)'/);
  return { label: label ? label[1] : '', items };
}

function parseXyChart(lines: string[]): ChartSpec | null {
  let title = '';
  let xTitle = '';
  let yTitle = '';
  let yMin: number | undefined;
  let yMax: number | undefined;
  let categories: string[] | null = null;
  const series: ChartSeries[] = [];

  for (const line of lines.slice(1)) {
    const low = line.toLowerCase();
    if (low.startsWith('title')) {
      title = unquote(line.slice(5));
      continue;
    }
    if (low.startsWith('x-axis')) {
      const parsed = parseCategories(line.slice(6));
      if (parsed) {
        xTitle = parsed.label;
        categories = parsed.items;
      }
      continue;
    }
    if (low.startsWith('y-axis')) {
      const rest = line.slice(6);
      const label = rest.match(/^\s*"([^"]*)"/) || rest.match(/^\s*'([^']*)'/);
      yTitle = label ? label[1] : '';
      const range = rest.match(/(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?)/);
      if (range) {
        yMin = Number(range[1]);
        yMax = Number(range[2]);
      }
      continue;
    }
    if (low.startsWith('line ') || low.startsWith('bar ')) {
      const data = parseNumberList(line.slice(line.indexOf(' ')));
      const type = low.startsWith('line') ? 'line' : 'bar';
      if (data) series.push({ type, data });
    }
  }

  if (!categories || !series.length) return null;
  if (series.some((s) => s.data.length !== categories!.length)) return null;
  return { kind: 'xychart', title, xTitle, categories, yTitle, yMin, yMax, series };
}

function parsePie(lines: string[]): ChartSpec | null {
  let title = '';
  const titleMatch = lines[0].match(/\btitle\s+(.+)$/i);
  if (titleMatch) title = unquote(titleMatch[1]);
  const data: { name: string; value: number }[] = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^["']?([^"':]+)["']?\s*:\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) data.push({ name: m[1].trim(), value: Number(m[2]) });
  }
  if (!data.length) return null;
  return { kind: 'pie', title, data };
}

export function parseMermaidChart(code: string): ChartSpec | null {
  const lines = String(code || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const head = lines[0].toLowerCase();
  if (head.startsWith('pie')) return parsePie(lines);
  if (head.startsWith('xychart-beta')) return parseXyChart(lines);
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web test -- run src/markdown-enhance/charts.test.ts`

Expected: PASS（6 tests）。

- [ ] **Step 5: 提交**

```powershell
git add web/src/markdown-enhance/charts.ts web/src/markdown-enhance/charts.test.ts
git commit -m "feat(markdown): 解析 Mermaid xychart/pie 图表"
```

---

### Task 2: ECharts 渲染器

**Files:**
- Modify: `web/src/markdown-enhance/charts.ts`（追加渲染函数）

- [ ] **Step 1: 追加渲染实现**

在 `charts.ts` 末尾追加：

```ts
type EChartsCore = typeof import('echarts/core');

let echartsCore: EChartsCore | null = null;

async function loadEcharts(): Promise<EChartsCore> {
  if (echartsCore) return echartsCore;
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]);
  core.use([
    charts.LineChart,
    charts.BarChart,
    charts.PieChart,
    components.GridComponent,
    components.TooltipComponent,
    components.LegendComponent,
    components.TitleComponent,
    renderers.CanvasRenderer,
  ]);
  echartsCore = core;
  return core;
}

function chartTheme() {
  const dark = document.documentElement.dataset.theme !== 'light';
  return {
    text: dark ? '#d5dae1' : '#1f2937',
    axis: dark ? '#3a4250' : '#d7dce3',
    split: dark ? '#242b36' : '#eef1f5',
  };
}

export async function renderChart(el: HTMLElement, spec: ChartSpec): Promise<ChartHandle> {
  const core = await loadEcharts();
  const th = chartTheme();
  const chart = core.init(el);
  const base = {
    backgroundColor: 'transparent',
    textStyle: { color: th.text },
    title: spec.title
      ? { text: spec.title, left: 'center', textStyle: { color: th.text, fontSize: 14 } }
      : undefined,
  };

  if (spec.kind === 'xychart') {
    const multiple = spec.series.length > 1;
    chart.setOption({
      ...base,
      tooltip: { trigger: 'axis' },
      legend: multiple ? { bottom: 0, textStyle: { color: th.text } } : undefined,
      grid: {
        left: 12,
        right: 18,
        top: spec.title ? 42 : 16,
        bottom: multiple ? 42 : 12,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: spec.categories,
        name: spec.xTitle,
        nameLocation: 'middle',
        nameGap: 26,
        axisLine: { lineStyle: { color: th.axis } },
        axisLabel: { color: th.text },
        splitLine: { lineStyle: { color: th.split } },
      },
      yAxis: {
        type: 'value',
        name: spec.yTitle,
        min: spec.yMin,
        max: spec.yMax,
        axisLine: { lineStyle: { color: th.axis } },
        axisLabel: { color: th.text },
        splitLine: { lineStyle: { color: th.split } },
      },
      series: spec.series.map((s, i) => ({
        name: `${s.type} ${i + 1}`,
        type: s.type,
        data: s.data,
        smooth: s.type === 'line',
        symbolSize: 6,
      })),
    });
  } else {
    chart.setOption({
      ...base,
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: th.text } },
      series: [
        {
          type: 'pie',
          radius: ['38%', '65%'],
          center: ['50%', '46%'],
          data: spec.data,
          label: { color: th.text, formatter: '{b}: {c} ({d}%)' },
        },
      ],
    });
  }

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
  return {
    dispose() {
      ro.disconnect();
      chart.dispose();
    },
  };
}
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`

Expected: PASS；若报 `echarts/charts` 等子路径类型错误，改为 `import type` + 保持运行时 `import()` 不变。

- [ ] **Step 3: 提交**

```powershell
git add web/src/markdown-enhance/charts.ts
git commit -m "feat(markdown): 用 ECharts 渲染 xychart/pie"
```

---

### Task 3: 表格提取与 Element Plus 挂载

**Files:**
- Create: `web/src/markdown-enhance/table.ts`
- Test: `web/src/markdown-enhance/table.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/markdown-enhance/table.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { extractTable } from './table';

function makeTable(html: string): HTMLTableElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  return wrap.querySelector('table') as HTMLTableElement;
}

describe('extractTable', () => {
  it('提取表头与单元格 HTML', () => {
    const table = makeTable(
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
      '<tbody><tr><td><b>Alice</b></td><td>30</td></tr>' +
      '<tr><td>Bob</td><td><code>25</code></td></tr></tbody></table>',
    );
    expect(extractTable(table)).toEqual({
      headers: ['Name', 'Age'],
      rows: [
        ['<b>Alice</b>', '30'],
        ['Bob', '<code>25</code>'],
      ],
    });
  });

  it('合并单元格返回 null', () => {
    const table = makeTable(
      '<table><thead><tr><th colspan="2">Wide</th></tr></thead>' +
      '<tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    );
    expect(extractTable(table)).toBeNull();
  });

  it('嵌套表格返回 null', () => {
    const table = makeTable(
      '<table><thead><tr><th>A</th></tr></thead>' +
      '<tbody><tr><td><table><tr><td>x</td></tr></table></td></tr></tbody></table>',
    );
    expect(extractTable(table)).toBeNull();
  });

  it('没有 thead 返回 null', () => {
    const table = makeTable('<table><tbody><tr><td>a</td></tr></tbody></table>');
    expect(extractTable(table)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web test -- run src/markdown-enhance/table.test.ts`

Expected: FAIL，`Failed to resolve import "./table"`。

- [ ] **Step 3: 写实现**

创建 `web/src/markdown-enhance/table.ts`：

```ts
import { computed, createApp, defineComponent, h, type PropType } from 'vue';
import { ElTable, ElTableColumn } from 'element-plus';

export type TableData = { headers: string[]; rows: string[][] };

function isPlainCell(node: Element): node is HTMLTableCellElement {
  const tag = node.tagName;
  if (tag !== 'TH' && tag !== 'TD') return false;
  const cell = node as HTMLTableCellElement;
  return cell.rowSpan <= 1 && cell.colSpan <= 1;
}

export function extractTable(table: HTMLTableElement): TableData | null {
  if (table.querySelector('table')) return null;
  const headRow = table.querySelector('thead tr');
  if (!headRow) return null;
  const cells = Array.from(headRow.children);
  if (!cells.length || !cells.every(isPlainCell)) return null;
  const headers = cells.map((c) => c.innerHTML.trim());

  const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
  if (!bodyRows.length) return null;
  const rows: string[][] = [];
  for (const tr of bodyRows) {
    const tds = Array.from(tr.children);
    if (tds.length !== headers.length || !tds.every(isPlainCell)) return null;
    rows.push(tds.map((c) => c.innerHTML.trim()));
  }
  return { headers, rows };
}

const TableHost = defineComponent({
  props: {
    headers: { type: Array as PropType<string[]>, required: true },
    rows: { type: Array as PropType<string[][]>, required: true },
  },
  setup(props) {
    const data = computed(() =>
      props.rows.map((cells) => {
        const obj: Record<string, string> = {};
        cells.forEach((cell, i) => { obj[`c${i}`] = cell; });
        return obj;
      }),
    );
    return () =>
      h(
        ElTable,
        { data: data.value, border: true, stripe: true, size: 'small', maxHeight: 420 },
        () =>
          props.headers.map((label, i) =>
            h(
              ElTableColumn,
              { key: i, prop: `c${i}`, showOverflowTooltip: true },
              {
                header: () => h('span', { innerHTML: label }),
                default: ({ row }: { row: Record<string, string> }) =>
                  h('span', { innerHTML: row[`c${i}`] ?? '' }),
              },
            ),
          ),
      );
  },
});

export function mountTable(host: HTMLElement, data: TableData): { dispose(): void } {
  const app = createApp(TableHost, data);
  app.mount(host);
  return { dispose: () => app.unmount() };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web test -- run src/markdown-enhance/table.test.ts`

Expected: PASS（4 tests）。

- [ ] **Step 5: 提交**

```powershell
git add web/src/markdown-enhance/table.ts web/src/markdown-enhance/table.test.ts
git commit -m "feat(markdown): 表格提取为 Element Plus 数据"
```

---

### Task 4: 增强编排与组合式接入

**Files:**
- Create: `web/src/markdown-enhance/index.ts`
- Create: `web/src/markdown-enhance/useEnhance.ts`

- [ ] **Step 1: 写编排实现**

创建 `web/src/markdown-enhance/index.ts`：

```ts
import { renderMermaid } from '../markdown';
import { parseMermaidChart, renderChart, type ChartHandle } from './charts';
import { extractTable, mountTable } from './table';

type Item = { host: HTMLElement; dispose(): void };
type State = { items: Item[] };

const states = new WeakMap<HTMLElement, State>();

export function disposeMarkdown(container: HTMLElement): void {
  const prev = states.get(container);
  if (!prev) return;
  for (const item of prev.items) {
    try { item.dispose(); } catch { /* ignore */ }
    if (item.host.isConnected) item.host.remove();
  }
  states.delete(container);
}

export async function enhanceMarkdown(container: HTMLElement): Promise<void> {
  disposeMarkdown(container);
  const state: State = { items: [] };
  states.set(container, state);

  for (const table of Array.from(container.querySelectorAll<HTMLTableElement>('table'))) {
    const data = extractTable(table);
    if (!data) continue;
    const host = document.createElement('div');
    host.className = 'md-el-table';
    table.replaceWith(host);
    state.items.push({ host, ...mountTable(host, data) });
  }

  for (const pre of Array.from(container.querySelectorAll<HTMLElement>('pre.mermaid'))) {
    const spec = parseMermaidChart(pre.textContent || '');
    if (!spec) continue;
    const host = document.createElement('div');
    host.className = 'md-echart';
    pre.before(host);
    try {
      const chart: ChartHandle = await renderChart(host, spec);
      pre.remove();
      state.items.push({ host, ...chart });
    } catch {
      host.remove();
    }
  }

  await renderMermaid(container);
}
```

创建 `web/src/markdown-enhance/useEnhance.ts`：

```ts
import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';
import { disposeMarkdown, enhanceMarkdown } from './index';

export function useMarkdownEnhance(html: Ref<string>, el: Ref<HTMLElement | null>): void {
  watch(
    html,
    async () => {
      await nextTick();
      if (el.value) {
        try {
          await enhanceMarkdown(el.value);
        } catch {
          /* 增强失败不影响原始 Markdown 展示 */
        }
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (el.value) disposeMarkdown(el.value);
  });
}
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`

Expected: PASS。

- [ ] **Step 3: 提交**

```powershell
git add web/src/markdown-enhance/index.ts web/src/markdown-enhance/useEnhance.ts
git commit -m "feat(markdown): 统一增强入口与 Vue 接入"
```

---

### Task 5: 接入所有 Markdown 展示位置

**Files:**
- Modify: `web/src/components/DocViewer.vue`
- Modify: `web/src/components/AppMarketView.vue`
- Modify: `web/src/jobs/JobsView.vue`
- Modify: `web/src/scheduler/SchedulerReportView.vue`
- Modify: `web/src/scheduler/SchedulerView.vue`
- Modify: `web/src/components/WorkflowFilesTab.vue`

- [ ] **Step 1: DocViewer 改用 enhanceMarkdown**

`web/src/components/DocViewer.vue`：

把 import 里的 `renderMermaid` 去掉：

```ts
import { isMarkdownFile, renderMarkdown, printMarkdown, collectAssetRefs } from '../markdown';
import { enhanceMarkdown } from '../markdown-enhance';
```

把 `applyPreview()` 里的：

```ts
    await renderMermaid(body);
```

改为：

```ts
    await enhanceMarkdown(body);
```

- [ ] **Step 2: AppMarketView 接入**

`web/src/components/AppMarketView.vue`：

```ts
import { useMarkdownEnhance } from '../markdown-enhance/useEnhance';
// 在 const noticeHtml = ref(''); 之后
const noticeBody = ref<HTMLElement | null>(null);
useMarkdownEnhance(noticeHtml, noticeBody);
```

模板：

```html
<div v-if="noticeHtml" ref="noticeBody" class="nbody" v-html="noticeHtml"></div>
```

- [ ] **Step 3: JobsView 接入**

`web/src/jobs/JobsView.vue`：

```ts
import { useMarkdownEnhance } from '../markdown-enhance/useEnhance';
const detailReportBody = ref<HTMLElement | null>(null);
useMarkdownEnhance(detailReportHtml, detailReportBody);
```

模板：

```html
<div v-if="detailReport" ref="detailReportBody" class="report md-body" v-html="detailReportHtml" />
```

- [ ] **Step 4: SchedulerReportView 接入**

`web/src/scheduler/SchedulerReportView.vue`：

```ts
import { useMarkdownEnhance } from '../markdown-enhance/useEnhance';
const reportBody = ref<HTMLElement | null>(null);
useMarkdownEnhance(reportHtml, reportBody);
```

模板：

```html
<div v-if="report" ref="reportBody" class="md-body" v-html="reportHtml" />
```

- [ ] **Step 5: SchedulerView 接入**

`web/src/scheduler/SchedulerView.vue`：

```ts
import { useMarkdownEnhance } from '../markdown-enhance/useEnhance';
const chatReportBody = ref<HTMLElement | null>(null);
useMarkdownEnhance(chatReportHtml, chatReportBody);
```

模板：

```html
<div v-if="chatReport" ref="chatReportBody" class="chat-report md-body" v-html="chatReportHtml" />
```

- [ ] **Step 6: WorkflowFilesTab 接入**

`web/src/components/WorkflowFilesTab.vue`：

```ts
import { useMarkdownEnhance } from '../markdown-enhance/useEnhance';
const mdBody = ref<HTMLElement | null>(null);
useMarkdownEnhance(html, mdBody);
```

模板：

```html
<div v-else ref="mdBody" class="md-body" v-html="html" />
```

- [ ] **Step 7: 类型检查**

Run: `npm.cmd run typecheck`

Expected: PASS。

- [ ] **Step 8: 提交**

```powershell
git add web/src/components/DocViewer.vue web/src/components/AppMarketView.vue web/src/jobs/JobsView.vue web/src/scheduler/SchedulerReportView.vue web/src/scheduler/SchedulerView.vue web/src/components/WorkflowFilesTab.vue
git commit -m "feat(markdown): 全部展示位置接入图表与表格增强"
```

---

### Task 6: 样式、文档与整体验证

**Files:**
- Modify: `shared/markdown.css`
- Modify: `AGENTS.md`

- [ ] **Step 1: 补样式**

在 `shared/markdown.css` 的 `.md-body .mermaid-err` 之后追加：

```css
.md-body .md-el-table { margin: 0.9em 0; }
.md-body .md-echart { width: 100%; height: 320px; margin: 0.9em 0; }
```

- [ ] **Step 2: 更新 AGENTS 目录速览**

在 `AGENTS.md`「目录速览」小节补一行：

```markdown
- Markdown 增强：`web/src/markdown-enhance/`（`enhanceMarkdown` 在 v-html 后把简单表格换成 `el-table`、把 Mermaid `xychart-beta`/`pie` 换成 ECharts，其余 Mermaid 仍走 `renderMermaid`；`useMarkdownEnhance` 供各 Markdown 展示位置接入）。
```

- [ ] **Step 3: 跑完整测试**

Run: `npm.cmd test`

Expected: server + web 全部 PASS（web 至少 121 个文件、690+ 测试）。

- [ ] **Step 4: 跑类型与 i18n 检查**

Run: `npm.cmd run typecheck`

Expected: PASS。

Run: `npm.cmd run check:i18n`

Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 5: 提交**

```powershell
git add shared/markdown.css AGENTS.md
git commit -m "style(markdown): 增强表格/图表间距并补充目录说明"
```

---

## 自检

- [ ] 规格覆盖：xychart/pie → Task 1/2；表格 → Task 3；所有展示位置 → Task 5；样式/文档 → Task 6
- [ ] 无占位符：每个任务都给出可执行代码与命令
- [ ] 类型一致：`ChartSpec`、`ChartHandle`、`TableData`、`enhanceMarkdown`、`useMarkdownEnhance` 在任务间命名一致
- [ ] 失败回落：图表解析/渲染失败保留 `pre.mermaid`，由 `renderMermaid` 处理
