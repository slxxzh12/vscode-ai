# Mermaid 流程图 X6 编辑器（第二期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 双击流程图打开全屏 X6 编辑器，支持拖拽/连线/增删/改标签/子图编辑，并把结果连同 `%% x6-positions` 保存回 Mermaid。

**Architecture:** 共享层新增「模型 + 原文保留 + 序列化」模块；编辑器为框架无关的 DOM 浮层，Web 与静态页共用；Web 回写 `.md`，静态页复制 + 下载当前块。

**Tech Stack:** `@antv/x6`、markdown 解析、现有 DocSource 写入能力、Vitest。

---

### Task 1: Mermaid 模型与往返序列化

**Files:**
- Create: `shared/markdown-flowchart-model.js`
- Create: `shared/markdown-flowchart-model.d.ts`
- Test: `web/src/markdown-enhance/flowchart-model.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from 'vitest';
import { parseFlowchartModel, serializeFlowchartModel, replaceMermaidBlock } from '@devflow/shared/markdown-flowchart-model';

const SRC = [
  'flowchart TD',
  '  A[开始] --> B{判断}',
  '  B -->|是| C[完成]',
  '  classDef done fill:#2ea043;',
  '  class C done;',
].join('\n');

it('解析后原样序列化（未改动不丢属性）', () => {
  const m = parseFlowchartModel(SRC);
  expect(serializeFlowchartModel(m)).toContain('A[开始] --> B{判断}');
  expect(serializeFlowchartModel(m)).toContain('classDef done fill:#2ea043;');
});

it('改标签/加节点后生成合法 Mermaid + 坐标注释', () => {
  const m = parseFlowchartModel(SRC);
  m.nodes.find((n) => n.id === 'A')!.label = '启动';
  m.nodes.push({ id: 'D', label: '新增', x: 10, y: 20, w: 120, h: 44 });
  m.positions.A = { x: 10, y: 20 };
  const out = serializeFlowchartModel(m);
  expect(out).toContain('A[启动]');
  expect(out).toContain('D[新增]');
  expect(out).toContain('%% x6-positions:');
});

it('replaceMermaidBlock 只替换目标块', () => {
  const md = '# x\n```mermaid\na\n```\n```mermaid\nb\n```\n';
  const out = replaceMermaidBlock(md, 1, 'flowchart TD\n  X-->Y');
  expect(out).toContain('flowchart TD\n  X-->Y');
  expect(out.indexOf('```mermaid\na')).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web exec -- vitest run src/markdown-enhance/flowchart-model.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现模型/序列化**

```js
// shared/markdown-flowchart-model.js
import { parseFlowchart } from './markdown-flowchart.js';

export function parseFlowchartModel(code) {
  const lines = String(code || '').replace(/\r\n?/g, '\n').split('\n');
  const spec = parseFlowchart(lines);
  if (!spec) return null;
  const positions = {};
  for (const line of lines) {
    const m = /^%%\s*x6-positions:\s*(\{.*\})\s*$/.exec(line.trim());
    if (m) { try { Object.assign(positions, JSON.parse(m[1])); } catch { /* ignore */ } }
  }
  return { direction: spec.direction, nodes: spec.nodes, edges: spec.edges, groups: spec.groups || [], positions, sourceLines: lines };
}

function posLine(positions) {
  const keys = Object.keys(positions);
  if (!keys.length) return '';
  return '%% x6-positions: ' + JSON.stringify(positions);
}

export function serializeFlowchartModel(model) {
  const lines = [`flowchart ${model.direction || 'TD'}`];
  const grouped = new Set(model.groups.flatMap((g) => g.nodeIds || []));
  for (const g of model.groups) if (g.label) lines.push(`  subgraph ${g.id}["${g.label}"]`);
  for (const n of model.nodes) {
    if (n.shapeRaw) lines.push(`  ${n.id}${n.shapeRaw}`);
    else lines.push(`  ${n.id}[${n.label}]`);
  }
  for (const e of model.edges) {
    const label = e.label ? `|${e.label}|` : '';
    lines.push(`  ${e.source} -->${label} ${e.target}`);
  }
  for (const g of model.groups) if (g.label) lines.push('  end');
  if (model.classDefs) lines.push(...model.classDefs);
  const p = posLine(model.positions);
  if (p) lines.push(p);
  return lines.join('\n');
}

export function replaceMermaidBlock(markdown, blockIndex, newCode) {
  const re = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let i = 0;
  return String(markdown || '').replace(re, (full, body) => {
    if (i++ !== blockIndex) return full;
    return '```mermaid\n' + newCode + '\n```';
  });
}
```

> 说明：保留原属性的完整实现需要给每个节点/边记录 `originalLine`，序列化时未改动项直接输出原行；本任务先保证拓扑、标签、坐标与 classDef 往返，后续在编辑器任务中补齐原行保留。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web exec -- vitest run src/markdown-enhance/flowchart-model.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add shared/markdown-flowchart-model.js shared/markdown-flowchart-model.d.ts web/src/markdown-enhance/flowchart-model.test.ts shared/package.json
git commit -m "feat(flowchart): 新增 Mermaid 模型与往返序列化"
```

---

### Task 2: 全屏编辑器（框架无关）

**Files:**
- Create: `shared/markdown-flowchart-editor.js`
- Create: `shared/markdown-flowchart-editor.d.ts`
- Test: `web/src/markdown-enhance/flowchart-editor.test.ts`

- [ ] **Step 1: 实现编辑器浮层**

```js
import { Graph } from '@antv/x6';
import { buildFlowGraphModel } from './markdown-flowchart-graph.js';
import { parseFlowchartModel, serializeFlowchartModel } from './markdown-flowchart-model.js';

export function openFlowchartEditor({ code, onSave, onCancel }) {
  const model = parseFlowchartModel(code);
  if (!model) return null;
  const root = document.createElement('div');
  root.className = 'df-flowedit';
  root.innerHTML = '<div class="df-flowedit-head"><span>流程图编辑</span><button data-act="save">保存</button><button data-act="cancel">取消</button></div><div class="df-flowedit-canvas"></div>';
  document.body.appendChild(root);
  const canvas = root.querySelector('.df-flowedit-canvas');
  const graph = new Graph({ container: canvas, width: canvas.clientWidth, height: canvas.clientHeight, grid: { visible: true }, panning: true, mousewheel: { enabled: true }, connecting: { snap: true, allowBlank: false } });
  graph.fromJSON(buildFlowGraphModel({ ...model, width: 1200, height: 800 }, {}));
  const close = () => { graph.dispose(); root.remove(); };
  root.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); onCancel && onCancel(); });
  root.querySelector('[data-act="save"]').addEventListener('click', () => {
    for (const n of model.nodes) {
      const cell = graph.getCellById(n.id);
      if (cell) { n.x = cell.getPosition().x + cell.getSize().width / 2; n.y = cell.getPosition().y + cell.getSize().height / 2; model.positions[n.id] = { x: cell.getPosition().x, y: cell.getPosition().y }; }
    }
    const out = serializeFlowchartModel(model);
    close();
    onSave && onSave(out);
  });
  return { close };
}
```

- [ ] **Step 2: 写最小测试**

验证模块导出、`openFlowchartEditor` 在无 DOM 时安全返回；模型操作在 Task 1 测试覆盖。

- [ ] **Step 3: 提交**

```bash
git add shared/markdown-flowchart-editor.js shared/markdown-flowchart-editor.d.ts web/src/markdown-enhance/flowchart-editor.test.ts shared/package.json
git commit -m "feat(flowchart): 新增全屏 X6 编辑器骨架"
```

---

### Task 3: Web 集成（双击 + 回写）

**Files:**
- Modify: `shared/markdown-charts.js`（记录块序号、双击事件）
- Modify: `web/src/markdown-enhance/index.ts`
- Modify: `web/src/components/DocViewer.vue`
- Modify: `shared/markdown-charts.d.ts`

- [ ] **Step 1: 图表标记与双击**

`enhanceCharts` 给每个流程图 host 记录 `data-flow-index`，并派发 `df-edit-flowchart` 事件（含 index/code）。

- [ ] **Step 2: DocViewer 接入**

监听 `df-edit-flowchart`，动态 `import('@devflow/shared/markdown-flowchart-editor')` 打开编辑器；保存时：

```ts
const next = replaceMermaidBlock(raw.value, index, code);
await props.source.write?.(props.path, next);
raw.value = next;
applyPreview();
```

无写入能力时复制 + 下载当前块。

- [ ] **Step 3: 测试**

- 双击事件带正确 index；
- `replaceMermaidBlock` 只改目标块；
- 保存不可写时触发复制/下载回调。

- [ ] **Step 4: 提交**

```bash
git commit -m "feat(flowchart): Web 双击编辑并回写 Markdown"
```

---

### Task 4: 静态页编辑（复制 + 下载）

**Files:**
- Modify: `server/mermaid-asset.js`（`__devflow_flowedit__.js`）
- Modify: `server/proxy-static.js`
- Modify: `server/markdown-page.js`
- Test: `server/test/markdown-page.test.js`

- [ ] **Step 1: 资源与脚本**

新增 `FLOW_EDIT_SCRIPT_NAME`，esbuild 打包 `markdown-flowchart-editor.js`；页面注入双击监听，保存时复制 Mermaid 并下载当前块。

- [ ] **Step 2: 测试**

断言页面包含 `__devflow_flowedit__.js` 与双击入口。

- [ ] **Step 3: 提交**

```bash
git commit -m "feat(flowchart): 静态页支持编辑与下载当前块"
```

---

### Task 5: 文档与全量验证

- README 说明双击编辑、坐标注释、保存/下载行为。
- Run: `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 提交：`docs(flowchart): 说明可视化编辑`。

---

## 自审

- 覆盖：模型/序列化、编辑器、Web 回写、静态页复制下载、文档。
- 占位符：编辑器骨架与核心函数已给出；Task 3/4 的 UI 细节需在实现时补齐具体代码。
- 一致性：`parseFlowchartModel`/`serializeFlowchartModel`/`openFlowchartEditor`/`replaceMermaidBlock` 命名统一。
