# 工作流编辑器增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有表单式工作流编辑器上，增加拖拽排序、分组带可视化、`<workflows>` XML 双向实时同步、只读终端效果预览、前端校验与易用性（撤销/重做/复制/未保存守卫），并把入口改为终端底部带文字的「编辑工作流」按钮。

**Architecture:** 抽 `shared/workflow-xml.js` 作纯解析/序列化唯一事实源（server 与 web 共用）；新增 `web/src/workflowModel.ts` 纯逻辑（校验/分组/排序）；`WorkflowEditor.vue` 改造成全屏标签页宿主（单一 `model` 事实源 + 历史栈 + 保存），拆出 Form/Xml/Preview 三个子组件。存储协议不变（仍 `POST /api/workflows` → 写活动 XML）。

**Tech Stack:** Node ESM、Vue 3 `<script setup>` + TS、CodeMirror 6（`@codemirror/lang-xml`）、vitest、node:test、原生 HTML5 DnD。

**Spec:** `docs/superpowers/specs/2026-09-12-workflow-editor-enhancement-design.md`

**约定：** Windows + PowerShell 5.1，无 bash；npm 一律 `npm.cmd`。所有命令在仓库根 `D:\root\devflow\devflow` 执行。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| `shared/workflow-xml.js`（新增） | 纯函数：解析/序列化工作流 XML，无依赖 |
| `shared/workflow-xml.d.ts`（新增） | 类型声明 |
| `shared/package.json`（改） | 新增子路径导出 `./workflow-xml` |
| `server/workflow-xml.js`（改） | 保留 `fallbackWorkflows`；`parseWorkflowXml` 从 shared re-export |
| `server/devflow-config.js`（改） | 删本地 `serializeWorkflow`/`decode`/`attr`，改用 shared |
| `server/test/shared-workflow-xml.test.js`（新增） | shared 往返/转义/整份配置解析测试（勿动既有 `workflow-xml.test.js`） |
| `web/src/workflowModel.ts`（新增） | 纯逻辑：类型、校验、分组带、排序、复制、新建、sanitize |
| `web/src/workflowModel.test.ts`（新增） | 上述纯逻辑单测 |
| `shared/i18n/zh-CN.js`、`en.js`（改） | 新增 `wfe.*` 词条 |
| `web/src/components/WorkflowXmlTab.vue`（新增） | CodeMirror XML 片段编辑 + 双向同步 |
| `web/src/components/WorkflowPreviewTab.vue`（新增） | 只读终端效果预览 |
| `web/src/components/WorkflowFormTab.vue`（新增） | 表单：拖拽排序 + 分组带 |
| `web/src/components/WorkflowEditor.vue`（重写） | 全屏宿主 + 标签页 + 历史 + 保存/导入/导出 |
| `web/src/components/TerminalView.vue`（改） | 入口按钮改为带文字的「编辑工作流」 |

---

## Task 1: shared 工作流 XML 纯模块

**Files:**
- Create: `shared/workflow-xml.js`
- Create: `shared/workflow-xml.d.ts`
- Modify: `shared/package.json`
- Test: `server/test/shared-workflow-xml.test.js`（新增；**不要覆盖**既有 `server/test/workflow-xml.test.js`）

- [ ] **Step 1: 在 `shared/package.json` 的 `exports` 增加子路径**

把 `exports` 改为（新增 `./workflow-xml` 项）：

```json
  "exports": {
    ".": { "types": "./index.d.ts", "default": "./index.js" },
    "./collab": { "types": "./collab.d.ts", "default": "./collab.js" },
    "./scheduler": { "types": "./scheduler.d.ts", "default": "./scheduler.js" },
    "./i18n": { "types": "./i18n/index.d.ts", "default": "./i18n/index.js" },
    "./workflow-xml": { "types": "./workflow-xml.d.ts", "default": "./workflow-xml.js" }
  }
```

- [ ] **Step 2: 写失败测试 `server/test/workflow-xml.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowsXml, serializeWorkflowsFragment, serializeWorkflow, escXml, decode } from '@devflow/shared/workflow-xml';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const sample = [
  { id: 'dev', label: '开发工作流', stages: [
    { id: 'design', label: '需求设计', group: '需求', prompts: ['第一句', '第二句'] },
    { id: 'code', label: '代码实现', group: '开发交付', prompts: ['写代码'] },
    { id: 'plain', label: '无分组', group: '', prompts: [] },
  ] },
  { id: 'test', label: '测试工作流', stages: [
    { id: 'run', label: '执行验证', group: '', prompts: ['跑测试'] },
  ] },
];

test('serialize → parse 往返深度相等', () => {
  const xml = serializeWorkflowsFragment(sample);
  assert.deepEqual(parseWorkflowsXml(xml), sample);
});

test('特殊字符与换行转义往返', () => {
  const tricky = [{ id: 'x&1', label: 'a<b>"c"', stages: [
    { id: 's\'1', label: 'l&l', group: 'g<1>', prompts: ['line1\nline2 & <tag> "q" \'a\''] },
  ] }];
  const xml = serializeWorkflowsFragment(tricky);
  assert.ok(xml.includes('&amp;') && xml.includes('&lt;') && xml.includes('&quot;'));
  assert.deepEqual(parseWorkflowsXml(xml), tricky);
});

test('空提示语被过滤', () => {
  const xml = '<workflows><workflow id="a" label="A"><stage id="s" label="S"><prompt>  </prompt><prompt>ok</prompt></stage></workflow></workflows>';
  assert.deepEqual(parseWorkflowsXml(xml)[0].stages[0].prompts, ['ok']);
});

test('无 stage 的 workflow 被丢弃', () => {
  const xml = '<workflows><workflow id="a" label="A"></workflow></workflows>';
  assert.deepEqual(parseWorkflowsXml(xml), []);
});

test('对整份 devflow.xml 解析得到期望工作流', () => {
  const full = fs.readFileSync(path.join(repoRoot, 'config', 'devflow.xml'), 'utf8');
  const wfs = parseWorkflowsXml(full);
  assert.equal(wfs[0].id, 'dev');
  assert.ok(wfs.some((w) => w.id === 'test'));
  assert.ok(wfs[0].stages.every((s) => s.id && s.label));
});

test('escXml/decode 互逆', () => {
  const s = 'a&b<c>d"e\'f';
  assert.equal(decode(escXml(s)), s);
});

test('serializeWorkflow 是 fragment 的子串', () => {
  const one = serializeWorkflow(sample[0]);
  assert.ok(serializeWorkflowsFragment([sample[0]]).includes(one));
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL — `Cannot find module '@devflow/shared/workflow-xml'` 或找不到导出。

- [ ] **Step 4: 实现 `shared/workflow-xml.js`**

```js
// 工作流配置 XML 的纯解析/序列化（无依赖、无 i18n）。
// server 与 web 共用，避免两份实现漂移。

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? decode(m[1]) : '';
}

export function parseWorkflowsXml(xml) {
  const workflows = [];
  if (typeof xml !== 'string') return workflows;
  const wfRe = /<workflow\b([^>]*)>([\s\S]*?)<\/workflow>/g;
  let wm;
  while ((wm = wfRe.exec(xml))) {
    const wf = {
      id: attr(wm[1], 'id') || `wf-${workflows.length}`,
      label: attr(wm[1], 'label') || attr(wm[1], 'id'),
      stages: [],
    };
    const stRe = /<stage\b([^>]*)>([\s\S]*?)<\/stage>/g;
    let sm;
    while ((sm = stRe.exec(wm[2]))) {
      const st = {
        id: attr(sm[1], 'id') || `st-${wf.stages.length}`,
        label: attr(sm[1], 'label') || attr(sm[1], 'id'),
        group: attr(sm[1], 'group') || '',
        prompts: [],
      };
      const prRe = /<prompt>([\s\S]*?)<\/prompt>/g;
      let pm;
      while ((pm = prRe.exec(sm[2]))) { const text = decode(pm[1]); if (text) st.prompts.push(text); }
      wf.stages.push(st);
    }
    if (wf.stages.length) workflows.push(wf);
  }
  return workflows;
}

export function serializeWorkflow(w) {
  const stages = (w.stages || []).map((s) => {
    const group = s.group ? ` group="${escXml(s.group)}"` : '';
    const prompts = (s.prompts || []).map((p) => `      <prompt>${escXml(p)}</prompt>`).join('\n');
    return `    <stage id="${escXml(s.id)}" label="${escXml(s.label)}"${group}>\n${prompts}\n    </stage>`;
  }).join('\n');
  return `  <workflow id="${escXml(w.id)}" label="${escXml(w.label)}">\n${stages}\n  </workflow>`;
}

export function serializeWorkflowsFragment(workflows) {
  const body = (workflows || []).map(serializeWorkflow).join('\n\n');
  return `<workflows>\n${body}\n</workflows>`;
}

export { escXml, decode };
```

- [ ] **Step 5: 写 `shared/workflow-xml.d.ts`**

```ts
export interface WorkflowStage { id: string; label: string; group?: string; prompts: string[]; }
export interface Workflow { id: string; label: string; stages: WorkflowStage[]; }
export declare function parseWorkflowsXml(xml: string): Workflow[];
export declare function serializeWorkflow(w: Workflow): string;
export declare function serializeWorkflowsFragment(workflows: Workflow[]): string;
export declare function escXml(s: unknown): string;
export declare function decode(s: unknown): string;
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS（新增用例全绿，原有 server 用例不回归）。

- [ ] **Step 7: 提交**

```bash
git add shared/workflow-xml.js shared/workflow-xml.d.ts shared/package.json server/test/workflow-xml.test.js
git commit -m "feat(shared): 工作流 XML 解析/序列化纯模块"
```

---

## Task 2: server 改用 shared 实现

**Files:**
- Modify: `server/workflow-xml.js`
- Modify: `server/devflow-config.js`

- [ ] **Step 1: 改 `server/workflow-xml.js`：删除本地解析，re-export shared**

整体替换为：

```js
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';
import { parseWorkflowsXml } from '@devflow/shared/workflow-xml';

export { parseWorkflowsXml as parseWorkflowXml };

// 内置兜底（配置文件缺失/损坏时使用）
export function fallbackWorkflows() {
  return [
    {
      id: 'dev', label: t('workflowxml.dev.title'),
      stages: [
        { id: 'design', label: t('workflowxml.design.label'), prompts: [t('workflowxml.design.prompt')] },
        { id: 'code', label: t('workflowxml.code.label'), prompts: [t('workflowxml.code.prompt')] },
        { id: 'test', label: t('workflowxml.test.label'), prompts: [t('workflowxml.test.prompt')] },
        { id: 'deploy', label: t('workflowxml.deploy.label'), prompts: [t('workflowxml.deploy.prompt')] },
      ],
    },
  ];
}

export function loadWorkflowXml(file) {
  try {
    if (fs.existsSync(file)) {
      const wfs = parseWorkflowsXml(fs.readFileSync(file, 'utf8'));
      if (wfs.length) return wfs;
    }
  } catch { /* fallthrough */ }
  return fallbackWorkflows();
}

// 默认配置文件位置：仓库根 config/devflow.xml（server/ 的上一级）
export function defaultWorkflowFile(baseDir) {
  return path.join(baseDir, 'config', 'devflow.xml');
}
```

**必须保留** `loadWorkflowXml` 与 `defaultWorkflowFile`：既有 `server/test/workflow-xml.test.js` 依赖它们。
在 `/api/workflows-xml` 路由中优先由 `loadDevflowConfig(configFile).workflows` 提供数据，`loadWorkflowXml` 仅作兜底与兼容。

- [ ] **Step 2: 改 `server/devflow-config.js`：用 shared 的 `serializeWorkflow`，删本地重复**

在第 4 行附近把 import 改为：

```js
import { parseWorkflowXml, fallbackWorkflows } from './workflow-xml.js';
import { serializeWorkflow, decode } from '@devflow/shared/workflow-xml';
```

删除文件内本地的 `serializeWorkflow` 函数（原 80-87 行）与本地 `decode` 函数（原 24-28 行）。
保留本地 `attr`、`escXml`（`escXml` 仍用于 server/agents 序列化）。
`serializeDevflowConfig` 继续调用 `cfg.workflows.map(serializeWorkflow)`。

Run: `rg "decode|serializeWorkflow" server/devflow-config.js`
Expected: 只剩 import 与 `serializeDevflowConfig` 中的调用，无本地定义。

- [ ] **Step 3: 跑 server 测试确认无回归**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add server/workflow-xml.js server/devflow-config.js
git commit -m "refactor(server): 工作流 XML 改用 shared 实现"
```

---

## Task 3: web 纯逻辑 `workflowModel.ts`

**Files:**
- Create: `web/src/workflowModel.ts`
- Test: `web/src/workflowModel.test.ts`

- [ ] **Step 1: 写失败测试 `web/src/workflowModel.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  validateModel, groupBands, moveItem, moveStageToIndex, duplicateWorkflow,
  duplicateStage, newWorkflow, newStage, sanitizeModel,
  type Workflow, type WorkflowStage,
} from './workflowModel';

const s = (over: Partial<WorkflowStage> = {}): WorkflowStage => ({ id: 's1', label: 'S', group: '', prompts: ['p'], ...over });
const w = (over: Partial<Workflow> = {}): Workflow => ({ id: 'w1', label: 'W', stages: [s()], ...over });

describe('validateModel', () => {
  it('空 id 与重复 id 报 error', () => {
    const m = [w({ id: '' }), w({ id: 'dup' }), w({ id: 'dup' })];
    const r = validateModel(m);
    expect(r.errors.some((e) => e.key === 'wfe.err.empty_id')).toBe(true);
    expect(r.errors.some((e) => e.key === 'wfe.err.dup_id' && e.params?.id === 'dup')).toBe(true);
  });
  it('同工作流内阶段重复 id 报 error', () => {
    const m = [w({ stages: [s({ id: 'x' }), s({ id: 'x' })] })];
    expect(validateModel(m).errors.some((e) => e.key === 'wfe.err.dup_id')).toBe(true);
  });
  it('空 label 与无提示语报 warning', () => {
    const m = [w({ label: '', stages: [s({ prompts: ['', '  '] })] })];
    const r = validateModel(m);
    expect(r.warnings.some((e) => e.key === 'wfe.warn.empty_label')).toBe(true);
    expect(r.warnings.some((e) => e.key === 'wfe.warn.empty_prompts')).toBe(true);
  });
});

describe('groupBands', () => {
  it('连续同名 group 聚合，异名断开', () => {
    const stages = [s({ id: 'a', group: 'G' }), s({ id: 'b', group: 'G' }), s({ id: 'c', group: '' }), s({ id: 'd', group: 'G' })];
    const bands = groupBands(stages);
    expect(bands.map((b) => b.name)).toEqual(['G', '', 'G']);
    expect(bands[0].stages.map((x) => x.id)).toEqual(['a', 'b']);
    expect(bands[0].startIndex).toBe(0);
    expect(bands[2].startIndex).toBe(3);
  });
});

describe('moveItem / moveStageToIndex', () => {
  it('moveItem 按最终下标移动', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });
  it('moveStageToIndex 可同时改 group', () => {
    const stages = [s({ id: 'a', group: 'G1' }), s({ id: 'b', group: 'G1' }), s({ id: 'c', group: 'G2' })];
    const next = moveStageToIndex(stages, 0, 2, 'G2');
    expect(next.map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(next[2].group).toBe('G2');
  });
});

describe('duplicate / new / sanitize', () => {
  it('复制生成新 id 且不改原对象', () => {
    const src = w();
    const copy = duplicateWorkflow(src, 'copy');
    expect(copy.id).not.toBe(src.id);
    expect(copy.stages[0].id).not.toBe(src.stages[0].id);
    expect(copy.label).toContain('copy');
    expect(src.label).toBe('W');
  });
  it('newWorkflow/newStage 带唯一 id', () => {
    expect(newWorkflow('x').id).not.toBe(newWorkflow('x').id);
    expect(newStage('y').id).not.toBe(newStage('y').id);
  });
  it('sanitizeModel 过滤空白提示语', () => {
    const m = [w({ stages: [s({ prompts: [' ', 'keep', ''] })] })];
    expect(sanitizeModel(m)[0].stages[0].prompts).toEqual(['keep']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd run test:web`
Expected: FAIL — 找不到 `./workflowModel`。

- [ ] **Step 3: 实现 `web/src/workflowModel.ts`**

```ts
export interface WorkflowStage {
  id: string;
  label: string;
  group?: string;
  prompts: string[];
}
export interface Workflow {
  id: string;
  label: string;
  stages: WorkflowStage[];
}
export interface ModelIssue {
  path: string;
  key: string;
  params?: Record<string, unknown>;
}
export interface GroupBand {
  name: string;
  startIndex: number;
  stages: WorkflowStage[];
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function newWorkflow(label: string): Workflow {
  return { id: uid('wf'), label, stages: [] };
}

export function newStage(label: string): WorkflowStage {
  return { id: uid('st'), label, group: '', prompts: [''] };
}

export function validateModel(model: Workflow[]): { errors: ModelIssue[]; warnings: ModelIssue[] } {
  const errors: ModelIssue[] = [];
  const warnings: ModelIssue[] = [];
  const wfIds = new Set<string>();
  (model || []).forEach((w, wi) => {
    const wp = `workflow[${wi}]`;
    const id = (w.id || '').trim();
    if (!id) errors.push({ path: wp, key: 'wfe.err.empty_id' });
    else if (wfIds.has(id)) errors.push({ path: wp, key: 'wfe.err.dup_id', params: { id } });
    else wfIds.add(id);
    if (!(w.label || '').trim()) warnings.push({ path: wp, key: 'wfe.warn.empty_label' });
    const stIds = new Set<string>();
    (w.stages || []).forEach((st, si) => {
      const sp = `${wp}.stage[${si}]`;
      const sid = (st.id || '').trim();
      if (!sid) errors.push({ path: sp, key: 'wfe.err.empty_id' });
      else if (stIds.has(sid)) errors.push({ path: sp, key: 'wfe.err.dup_id', params: { id: sid } });
      else stIds.add(sid);
      if (!(st.prompts || []).some((p) => String(p).trim() !== '')) warnings.push({ path: sp, key: 'wfe.warn.empty_prompts' });
    });
  });
  return { errors, warnings };
}

export function groupBands(stages: WorkflowStage[]): GroupBand[] {
  const out: GroupBand[] = [];
  (stages || []).forEach((st, i) => {
    const name = (st.group || '').trim();
    const last = out[out.length - 1];
    if (!last || last.name !== name) out.push({ name, startIndex: i, stages: [st] });
    else last.stages.push(st);
  });
  return out;
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length) return arr.slice();
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  const idx = Math.max(0, Math.min(next.length, to));
  next.splice(idx, 0, x);
  return next;
}

export function moveStageToIndex(stages: WorkflowStage[], from: number, finalIndex: number, group?: string): WorkflowStage[] {
  if (from < 0 || from >= stages.length) return stages.slice();
  const next = stages.slice();
  const [x] = next.splice(from, 1);
  const moved = group === undefined ? x : { ...x, group };
  const idx = Math.max(0, Math.min(next.length, finalIndex));
  next.splice(idx, 0, moved);
  return next;
}

export function duplicateStage(s: WorkflowStage): WorkflowStage {
  return { id: uid('st'), label: s.label, group: s.group || '', prompts: (s.prompts || []).slice() };
}

export function duplicateWorkflow(w: Workflow, suffix = ''): Workflow {
  const tail = suffix ? ` ${suffix}` : '';
  return { id: uid('wf'), label: `${w.label}${tail}`, stages: (w.stages || []).map(duplicateStage) };
}

export function sanitizeModel(model: Workflow[]): Workflow[] {
  return (model || []).map((w) => ({
    id: w.id,
    label: w.label,
    stages: (w.stages || []).map((st) => ({
      id: st.id,
      label: st.label,
      group: st.group || '',
      prompts: (st.prompts || []).map((p) => String(p)).filter((p) => p.trim() !== ''),
    })),
  }));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd run test:web`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/workflowModel.ts web/src/workflowModel.test.ts
git commit -m "feat(web): 工作流编辑器纯逻辑模块"
```

---

## Task 4: i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 在 `shared/i18n/zh-CN.js` 的 `'wfe.prompt'` 行后插入**

```js
  'wfe.open': '编辑工作流',
  'wfe.tab.form': '表单',
  'wfe.tab.xml': 'XML',
  'wfe.tab.preview': '预览',
  'wfe.id_label': 'id',
  'wfe.drag_hint': '拖拽调整顺序',
  'wfe.group_rename_tip': '双击重命名分组',
  'wfe.group_unnamed': '未分组',
  'wfe.duplicate': '复制',
  'wfe.undo': '撤销',
  'wfe.redo': '重做',
  'wfe.del_confirm': '删除后不可撤销，确定删除？',
  'wfe.unsaved': '有未保存的改动，确定关闭？',
  'wfe.dup_suffix': '副本',
  'wfe.err.empty_id': 'id 不能为空',
  'wfe.err.dup_id': 'id 重复：{id}',
  'wfe.warn.empty_label': '名称为空（将以 id 兜底）',
  'wfe.warn.empty_prompts': '该阶段没有提示语',
  'wfe.xml_error': 'XML 解析失败：{msg}',
  'wfe.refresh_from_form': '从表单刷新',
  'wfe.preview.current': '当前阶段',
  'wfe.preview.empty': '没有可预览的工作流',
  'wfe.valid': '校验通过',
```

- [ ] **Step 2: 在 `shared/i18n/en.js` 的 `'wfe.prompt'` 行后插入对应英文**

```js
  'wfe.open': 'Edit workflows',
  'wfe.tab.form': 'Form',
  'wfe.tab.xml': 'XML',
  'wfe.tab.preview': 'Preview',
  'wfe.id_label': 'id',
  'wfe.drag_hint': 'Drag to reorder',
  'wfe.group_rename_tip': 'Double-click to rename group',
  'wfe.group_unnamed': 'Ungrouped',
  'wfe.duplicate': 'Duplicate',
  'wfe.undo': 'Undo',
  'wfe.redo': 'Redo',
  'wfe.del_confirm': 'This cannot be undone. Delete?',
  'wfe.unsaved': 'Unsaved changes. Close anyway?',
  'wfe.dup_suffix': 'copy',
  'wfe.err.empty_id': 'id cannot be empty',
  'wfe.err.dup_id': 'Duplicate id: {id}',
  'wfe.warn.empty_label': 'Empty name (falls back to id)',
  'wfe.warn.empty_prompts': 'This stage has no prompts',
  'wfe.xml_error': 'XML parse error: {msg}',
  'wfe.refresh_from_form': 'Refresh from form',
  'wfe.preview.current': 'Current stage',
  'wfe.preview.empty': 'No workflow to preview',
  'wfe.valid': 'Valid',
```

- [ ] **Step 3: 校验中英键集合对称**

Run: `npm.cmd run check:i18n`
Expected: PASS（无缺失/多余键，用户可见区无硬编码中文）。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n: 工作流编辑器增强词条"
```

---

## Task 5: `WorkflowXmlTab.vue`

**Files:**
- Create: `web/src/components/WorkflowXmlTab.vue`

- [ ] **Step 1: 创建组件（CodeMirror XML + 双向同步）**

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { xml } from '@codemirror/lang-xml';
import { serializeWorkflowsFragment, parseWorkflowsXml } from '@devflow/shared/workflow-xml';
import { useTheme } from '../theme';
import { t } from '../i18n';
import type { Workflow } from '../workflowModel';

const props = defineProps<{ model: Workflow[] }>();
const emit = defineEmits<{ (e: 'update:model', m: Workflow[]): void }>();

const { isDark } = useTheme();
const host = ref<HTMLDivElement | null>(null);
const text = ref(serializeWorkflowsFragment(props.model));
const xmlError = ref('');
let view: EditorView | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let handEdited = false;
let applying = false;
let justEmitted = false;

function wellFormed(s: string): string {
  if (!s.trim()) return '';
  try {
    const doc = new DOMParser().parseFromString(s, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    return err ? (err.textContent || 'parse error') : '';
  } catch (e: any) {
    return String(e?.message || e);
  }
}

function parseNow() {
  const bad = wellFormed(text.value);
  if (bad) { xmlError.value = bad; return; }
  xmlError.value = '';
  const next = parseWorkflowsXml(text.value);
  if (JSON.stringify(next) !== JSON.stringify(props.model)) {
    justEmitted = true;
    emit('update:model', next);
  }
  handEdited = false;
}

function onDocChanged() {
  if (applying || !view) return;
  text.value = view.state.doc.toString();
  handEdited = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(parseNow, 300);
}

function setText(s: string) {
  text.value = s;
  if (!view) return;
  applying = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } });
  applying = false;
}

function mount() {
  if (!host.value || view) return;
  view = new EditorView({
    doc: text.value,
    extensions: [
      basicSetup,
      ...(isDark.value ? [oneDark] : []),
      EditorView.lineWrapping,
      xml(),
      EditorView.updateListener.of((u) => { if (u.docChanged) onDocChanged(); }),
    ],
    parent: host.value,
  });
}

function refreshFromForm() {
  xmlError.value = '';
  handEdited = false;
  setText(serializeWorkflowsFragment(props.model));
}

watch(() => props.model, (m) => {
  if (justEmitted) { justEmitted = false; return; }
  if (!handEdited) setText(serializeWorkflowsFragment(m));
}, { deep: true });

watch(isDark, () => {
  if (!view) return;
  const doc = view.state.doc.toString();
  view.destroy();
  view = null;
  mount();
  setText(doc);
});

onMounted(mount);
onBeforeUnmount(() => { if (timer) clearTimeout(timer); view?.destroy(); view = null; });
</script>

<template>
  <div class="xmlwrap">
    <div class="bar">
      <span class="hint">{{ $t('wfe.drag_hint') }}</span>
      <button class="btn" @click="refreshFromForm">{{ $t('wfe.refresh_from_form') }}</button>
    </div>
    <div v-if="xmlError" class="err">{{ $t('wfe.xml_error', { msg: xmlError }) }}</div>
    <div ref="host" class="editor" />
  </div>
</template>

<style scoped>
.xmlwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.bar { display: flex; align-items: center; gap: 8px; }
.hint { flex: 1; color: var(--tx3); font-size: 12px; }
.err { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); border: 1px solid var(--err); border-radius: 4px; padding: 4px 8px; font-size: 12px; white-space: pre-wrap; }
.editor { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; }
.editor :deep(.cm-editor) { height: 100%; }
.btn { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
.btn:hover { border-color: var(--ac2); color: var(--tx1); }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（若报 `@devflow/shared/workflow-xml` 无类型，确认 Task 1 的 `.d.ts` 与 exports 已落地）。

- [ ] **Step 3: 提交**

```bash
git add web/src/components/WorkflowXmlTab.vue
git commit -m "feat(web): 工作流 XML 标签页（双向同步）"
```

---

## Task 6: `WorkflowPreviewTab.vue`

**Files:**
- Create: `web/src/components/WorkflowPreviewTab.vue`

- [ ] **Step 1: 创建组件（只读终端效果模拟）**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { groupBands, type Workflow } from '../workflowModel';

const props = defineProps<{ model: Workflow[] }>();
const wfIndex = ref(0);
watch(() => props.model.length, () => { if (wfIndex.value >= props.model.length) wfIndex.value = 0; });

const current = computed<Workflow | null>(() => props.model[wfIndex.value] || null);
const bands = computed(() => (current.value ? groupBands(current.value.stages) : []));
const stageIndex = ref(0);
watch(current, () => { stageIndex.value = 0; });
const chips = computed<string[]>(() => current.value?.stages[stageIndex.value]?.prompts || []);

function chipText(s: string) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 40 ? one.slice(0, 40) + '…' : one;
}
function flatIndex(start: number, offset: number) { return start + offset; }
</script>

<template>
  <div class="pv">
    <div v-if="!current" class="empty">{{ $t('wfe.preview.empty') }}</div>
    <template v-else>
      <div class="wfbtns">
        <button v-for="(w, i) in model" :key="w.id" class="wfbtn" :class="{ on: i === wfIndex }" @click="wfIndex = i">{{ w.label }}</button>
      </div>
      <div class="flowbar">
        <template v-for="(g, gi) in bands" :key="gi">
          <div class="fgroup">
            <span v-if="g.name" class="fglabel">{{ g.name }}</span>
            <template v-for="(s, i) in g.stages" :key="s.id">
              <button class="stage" :class="{ on: stageIndex === flatIndex(g.startIndex, i) }" @click="stageIndex = flatIndex(g.startIndex, i)">{{ s.label }}</button>
              <span v-if="i < g.stages.length - 1" class="flowline" />
            </template>
          </div>
          <span v-if="gi < bands.length - 1" class="fgap" />
        </template>
      </div>
      <div v-if="chips.length" class="chipbar">
        <span class="chips-label">{{ $t('wfe.preview.current') }}</span>
        <span v-for="(p, i) in chips" :key="i" class="chip" :title="p"><span class="cdot" />{{ chipText(p) }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pv { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 8px; }
.empty { color: var(--tx3); font-size: 13px; }
.wfbtns { display: flex; gap: 6px; flex-wrap: wrap; }
.wfbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.wfbtn.on { background: var(--ac); color: var(--onac); border-color: var(--ac); }
.flowbar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.fgroup { display: flex; align-items: center; gap: 4px; }
.fglabel { color: var(--tx3); font-size: 11px; margin-right: 4px; }
.stage { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 1px 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
.stage.on { border-color: var(--ac2); color: var(--ac2); }
.flowline { width: 14px; height: 1px; background: var(--bd); display: inline-block; }
.fgap { width: 18px; }
.chipbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; background: var(--bg3); border: 1px solid var(--bd2); border-radius: 6px; padding: 6px 8px; }
.chips-label { color: var(--tx3); font-size: 11px; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 12px; padding: 2px 10px; font-size: 12px; color: var(--tx2); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdot { width: 6px; height: 6px; border-radius: 50%; background: var(--ac2); flex: none; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add web/src/components/WorkflowPreviewTab.vue
git commit -m "feat(web): 工作流预览标签页"
```

---

## Task 7: `WorkflowFormTab.vue`

**Files:**
- Create: `web/src/components/WorkflowFormTab.vue`

- [ ] **Step 1: 创建组件（拖拽 + 分组带 + 行内校验）**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '../i18n';
import {
  groupBands, moveItem, moveStageToIndex, duplicateWorkflow, duplicateStage,
  newWorkflow, newStage, validateModel,
  type Workflow, type WorkflowStage, type ModelIssue, type GroupBand,
} from '../workflowModel';

const props = defineProps<{ model: Workflow[] }>();
const emit = defineEmits<{ (e: 'update:model', m: Workflow[]): void }>();

type Drag =
  | { kind: 'workflow'; index: number }
  | { kind: 'stage'; wfId: string; index: number }
  | { kind: 'prompt'; wfId: string; stageId: string; index: number };

const drag = ref<Drag | null>(null);
const report = computed(() => validateModel(props.model));
const errAt = computed(() => {
  const map = new Map<string, ModelIssue>();
  for (const e of report.value.errors) map.set(e.path, e);
  return map;
});
const warnAt = computed(() => {
  const map = new Map<string, ModelIssue>();
  for (const e of report.value.warnings) map.set(e.path, e);
  return map;
});

function emitModel(next: Workflow[]) { emit('update:model', next); }
function wfPath(wi: number) { return `workflow[${wi}]`; }
function stPath(wi: number, si: number) { return `${wfPath(wi)}.stage[${si}]`; }
function issueText(i?: ModelIssue) { return i ? t(i.key, i.params) : ''; }

function onDragStart(e: DragEvent, d: Drag) {
  drag.value = d;
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', JSON.stringify(d)); }
}
function onDragEnd() { drag.value = null; }

function setWorkflowLabel(wi: number, value: string) {
  const next = props.model.slice(); next[wi] = { ...next[wi], label: value }; emitModel(next);
}
function setWorkflowId(wi: number, value: string) {
  const next = props.model.slice(); next[wi] = { ...next[wi], id: value }; emitModel(next);
}
function addWorkflow() { emitModel([...props.model, newWorkflow(t('wfe.new_workflow'))]); }
function removeWorkflow(wi: number) {
  if (!confirm(t('wfe.del_confirm'))) return;
  emitModel(props.model.filter((_, i) => i !== wi));
}
function copyWorkflow(wi: number) { emitModel([...props.model, duplicateWorkflow(props.model[wi], t('wfe.dup_suffix'))]); }
function dropWorkflow(wi: number) {
  if (drag.value?.kind !== 'workflow') return;
  emitModel(moveItem(props.model, drag.value.index, wi));
  drag.value = null;
}

function updateStages(wi: number, stages: WorkflowStage[]) {
  const next = props.model.slice(); next[wi] = { ...next[wi], stages }; emitModel(next);
}
function setStage(wi: number, si: number, patch: Partial<WorkflowStage>) {
  const stages = props.model[wi].stages.map((s, i) => (i === si ? { ...s, ...patch } : s));
  updateStages(wi, stages);
}
function addStage(wi: number, group = '') {
  updateStages(wi, [...props.model[wi].stages, { ...newStage(t('wfe.new_stage')), group }]);
}
function removeStage(wi: number, si: number) {
  if (!confirm(t('wfe.del_confirm'))) return;
  updateStages(wi, props.model[wi].stages.filter((_, i) => i !== si));
}
function copyStage(wi: number, si: number) {
  const stages = props.model[wi].stages.slice();
  stages.splice(si + 1, 0, duplicateStage(stages[si]));
  updateStages(wi, stages);
}
function renameBand(wi: number, band: GroupBand, name: string) {
  const target = new Set(band.stages.map((s) => s.id));
  const stages = props.model[wi].stages.map((s) => (target.has(s.id) ? { ...s, group: name.trim() } : s));
  updateStages(wi, stages);
}
function bandRenamePrompt(band: GroupBand) {
  const cur = band.name || '';
  const v = window.prompt(t('wfe.group_rename_tip'), cur);
  if (v === null) return;
  return v;
}

// —— 阶段拖拽 ——
function dropOnStage(w: Workflow, wi: number, si: number) {
  if (drag.value?.kind !== 'stage' || drag.value.wfId !== w.id) { drag.value = null; return; }
  const from = drag.value.index;
  const finalIndex = from < si ? si - 1 : si;
  updateStages(wi, moveStageToIndex(w.stages, from, finalIndex, w.stages[si].group || ''));
  drag.value = null;
}
function dropOnBand(w: Workflow, wi: number, band: GroupBand) {
  if (drag.value?.kind !== 'stage' || drag.value.wfId !== w.id) { drag.value = null; return; }
  const from = drag.value.index;
  const end = band.startIndex + band.stages.length;
  const finalIndex = from < end ? end - 1 : end;
  updateStages(wi, moveStageToIndex(w.stages, from, finalIndex, band.name));
  drag.value = null;
}
function addStageInBand(wi: number, band: GroupBand) {
  addStage(wi, band.name);
}

// —— 提示语拖拽 ——
function setPrompt(wi: number, si: number, pi: number, value: string) {
  const prompts = props.model[wi].stages[si].prompts.map((p, i) => (i === pi ? value : p));
  setStage(wi, si, { prompts });
}
function addPrompt(wi: number, si: number) {
  setStage(wi, si, { prompts: [...props.model[wi].stages[si].prompts, ''] });
}
function removePrompt(wi: number, si: number, pi: number) {
  setStage(wi, si, { prompts: props.model[wi].stages[si].prompts.filter((_, i) => i !== pi) });
}
function dropPrompt(wi: number, stage: WorkflowStage, si: number, pi: number) {
  if (drag.value?.kind !== 'prompt' || drag.value.stageId !== stage.id) { drag.value = null; return; }
  setStage(wi, si, { prompts: moveItem(stage.prompts, drag.value.index, pi) });
  drag.value = null;
}
</script>

<template>
  <div class="ft">
    <div v-if="report.errors.length" class="errbar">
      <div v-for="(e, i) in report.errors" :key="i">{{ issueText(e) }}</div>
    </div>
    <div v-else-if="report.warnings.length" class="warnbar">
      <div v-for="(e, i) in report.warnings" :key="i">{{ issueText(e) }}</div>
    </div>
    <div v-else class="okbar">{{ $t('wfe.valid') }}</div>

    <div v-for="(w, wi) in model" :key="w.id" class="wcard"
      :class="{ dragging: drag?.kind === 'workflow' && drag.index === wi }"
      @dragover.prevent @drop="dropWorkflow(wi)">
      <div class="wrow">
        <span class="handle" draggable="true" :title="$t('wfe.drag_hint')"
          @dragstart="onDragStart($event, { kind: 'workflow', index: wi })" @dragend="onDragEnd">⋮⋮</span>
        <input class="in wlabel" :value="w.label" :placeholder="$t('wfe.workflow_label')" @input="setWorkflowLabel(wi, ($event.target as HTMLInputElement).value)" />
        <input class="in id" :value="w.id" :placeholder="$t('wfe.id_label')" @input="setWorkflowId(wi, ($event.target as HTMLInputElement).value)" />
        <button class="mini" @click="copyWorkflow(wi)">{{ $t('wfe.duplicate') }}</button>
        <button class="mini danger" @click="removeWorkflow(wi)">{{ $t('wfe.del') }}</button>
      </div>
      <div v-if="errAt.get(wfPath(wi))" class="ln err">{{ issueText(errAt.get(wfPath(wi))) }}</div>
      <div v-else-if="warnAt.get(wfPath(wi))" class="ln warn">{{ issueText(warnAt.get(wfPath(wi))) }}</div>

      <div v-for="(band, bi) in groupBands(w.stages)" :key="bi" class="band"
        @dragover.prevent @drop="dropOnBand(w, wi, band)">
        <div class="bhead">
          <span class="bname" :class="{ unnamed: !band.name }" :title="$t('wfe.group_rename_tip')"
            @dblclick="() => { const v = bandRenamePrompt(band); if (v !== null) renameBand(wi, band, v); }">
            {{ band.name || $t('wfe.group_unnamed') }}
          </span>
          <button class="mini add" @click="addStageInBand(wi, band)">{{ $t('wfe.add_stage') }}</button>
        </div>
        <div v-for="(s, sInBand) in band.stages" :key="s.id" class="scard"
          :class="{ dragging: drag?.kind === 'stage' && drag.index === band.startIndex + sInBand && drag.wfId === w.id }"
          @dragover.prevent @drop.stop="dropOnStage(w, wi, band.startIndex + sInBand)">
          <div class="srow">
            <span class="handle" draggable="true" :title="$t('wfe.drag_hint')"
              @dragstart="onDragStart($event, { kind: 'stage', wfId: w.id, index: band.startIndex + sInBand })" @dragend="onDragEnd">⋮⋮</span>
            <input class="in" :value="s.label" :placeholder="$t('wfe.stage_label')" @input="setStage(wi, band.startIndex + sInBand, { label: ($event.target as HTMLInputElement).value })" />
            <button class="mini" @click="copyStage(wi, band.startIndex + sInBand)">{{ $t('wfe.duplicate') }}</button>
            <button class="mini danger" @click="removeStage(wi, band.startIndex + sInBand)">{{ $t('wfe.del') }}</button>
          </div>
          <div v-if="errAt.get(stPath(wi, band.startIndex + sInBand))" class="ln err">{{ issueText(errAt.get(stPath(wi, band.startIndex + sInBand))) }}</div>
          <div v-else-if="warnAt.get(stPath(wi, band.startIndex + sInBand))" class="ln warn">{{ issueText(warnAt.get(stPath(wi, band.startIndex + sInBand))) }}</div>
          <div v-for="(p, pi) in s.prompts" :key="pi" class="prow"
            @dragover.prevent @drop.stop="dropPrompt(wi, s, band.startIndex + sInBand, pi)">
            <span class="handle" draggable="true" :title="$t('wfe.drag_hint')"
              @dragstart="onDragStart($event, { kind: 'prompt', wfId: w.id, stageId: s.id, index: pi })" @dragend="onDragEnd">⋮</span>
            <textarea class="ta" rows="2" :value="p" :placeholder="$t('wfe.prompt')" @input="setPrompt(wi, band.startIndex + sInBand, pi, ($event.target as HTMLTextAreaElement).value)" />
            <button class="mini danger" @click="removePrompt(wi, band.startIndex + sInBand, pi)">×</button>
          </div>
          <button class="mini add" @click="addPrompt(wi, band.startIndex + sInBand)">{{ $t('wfe.add_prompt') }}</button>
        </div>
      </div>
    </div>
    <button class="mini add big" @click="addWorkflow">{{ $t('wfe.add_workflow') }}</button>
  </div>
</template>

<style scoped>
.ft { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 4px; }
.errbar { background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); border: 1px solid var(--err); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
.warnbar { background: color-mix(in srgb, var(--warn, #d19a00) 12%, transparent); color: var(--warn, #d19a00); border: 1px solid var(--warn, #d19a00); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
.okbar { color: var(--tx3); font-size: 12px; }
.wcard { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.wcard.dragging, .scard.dragging { opacity: .5; }
.wrow { display: flex; gap: 8px; align-items: center; }
.handle { cursor: grab; color: var(--tx3); user-select: none; }
.band { border: 1px dashed var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--bg3); }
.bhead { display: flex; align-items: center; gap: 8px; }
.bname { font-size: 12px; color: var(--tx2); cursor: text; }
.bname.unnamed { color: var(--tx6); }
.scard { border: 1px solid var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--bg2); }
.srow, .prow { display: flex; gap: 6px; align-items: flex-start; }
.in { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: inherit; box-sizing: border-box; }
.in.wlabel { font-weight: 700; }
.in.id { flex: 0 0 150px; font-family: ui-monospace, Consolas, monospace; color: var(--tx3); }
.ta { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; resize: vertical; box-sizing: border-box; }
.in:focus, .ta:focus { outline: none; border-color: var(--ac2); }
.mini { flex: none; background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: inherit; }
.mini:hover { border-color: var(--ac2); color: var(--tx1); }
.mini.danger:hover { border-color: var(--err); color: var(--err); }
.mini.add { align-self: flex-start; background: none; }
.mini.add.big { margin: 4px 0 8px; }
.ln { font-size: 11px; }
.ln.err { color: var(--err); }
.ln.warn { color: var(--warn, #d19a00); }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（若 `$event.target as HTMLInputElement` 报错，改为内联函数取 `(e) => (e.target as HTMLInputElement).value`）。

- [ ] **Step 3: 提交**

```bash
git add web/src/components/WorkflowFormTab.vue
git commit -m "feat(web): 工作流表单标签页（拖拽+分组）"
```

---

## Task 8: 宿主 `WorkflowEditor.vue` 重写 + `TerminalView.vue` 入口

**Files:**
- Modify (rewrite): `web/src/components/WorkflowEditor.vue`
- Modify: `web/src/components/TerminalView.vue:735`

- [ ] **Step 1: 重写 `WorkflowEditor.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { t } from '../i18n';
import { sanitizeModel, validateModel, type Workflow } from '../workflowModel';
import WorkflowFormTab from './WorkflowFormTab.vue';
import WorkflowXmlTab from './WorkflowXmlTab.vue';
import WorkflowPreviewTab from './WorkflowPreviewTab.vue';

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();
const model = ref<Workflow[]>([]);
const tab = ref<'form' | 'xml' | 'preview'>('form');
const busy = ref(false);
const msg = ref('');
const dirty = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const report = computed(() => validateModel(model.value));
const canSave = computed(() => report.value.errors.length === 0 && !busy.value);

const history = ref<string[]>([]);
const hIndex = ref(-1);

function pushHistory(snapshot: Workflow[]) {
  history.value = history.value.slice(0, hIndex.value + 1);
  history.value.push(JSON.stringify(snapshot));
  if (history.value.length > 50) history.value.shift();
  hIndex.value = history.value.length - 1;
}
function applyModel(next: Workflow[]) {
  if (JSON.stringify(next) === JSON.stringify(model.value)) return;
  pushHistory(next);
  model.value = next;
  dirty.value = true;
}
function undo() {
  if (hIndex.value <= 0) return;
  hIndex.value -= 1;
  model.value = JSON.parse(history.value[hIndex.value]);
  dirty.value = true;
}
function redo() {
  if (hIndex.value >= history.value.length - 1) return;
  hIndex.value += 1;
  model.value = JSON.parse(history.value[hIndex.value]);
  dirty.value = true;
}
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}

async function load() {
  try {
    const r = await fetch('/api/workflows-xml').then((x) => x.json());
    model.value = Array.isArray(r?.workflows) ? JSON.parse(JSON.stringify(r.workflows)) : [];
  } catch { model.value = []; }
  history.value = [JSON.stringify(model.value)];
  hIndex.value = 0;
  dirty.value = false;
}

async function save(): Promise<boolean> {
  if (report.value.errors.length) { msg.value = report.value.errors.map((e) => t(e.key, e.params)).join('；'); return false; }
  busy.value = true; msg.value = '';
  try {
    const payload = sanitizeModel(model.value);
    const res = await fetch('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflows: payload }) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
    if (Array.isArray(j.workflows)) {
      model.value = JSON.parse(JSON.stringify(j.workflows));
      history.value = [JSON.stringify(model.value)];
      hIndex.value = 0;
    }
    dirty.value = false;
    emit('saved');
    msg.value = t('wfe.saved');
    return true;
  } catch (e: any) { msg.value = t('wfe.failed', { msg: String(e?.message || e) }); return false; }
  finally { busy.value = false; }
}

function close() {
  if (dirty.value && !window.confirm(t('wfe.unsaved'))) return;
  emit('close');
}

async function exportXml() {
  if (!(await save())) return;
  try {
    const xml = await fetch('/api/config/xml').then((r) => r.text());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    a.download = 'devflow.xml';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e: any) { msg.value = t('wfe.failed', { msg: String(e?.message || e) }); }
}

function pickFile() { fileInput.value?.click(); }
async function onFile(e: Event) {
  const inp = e.target as HTMLInputElement;
  const f = inp.files?.[0];
  if (!f) return;
  const xml = await f.text();
  busy.value = true; msg.value = '';
  try {
    const res = await fetch('/api/config/xml', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xml }) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
    await load();
    emit('saved');
    msg.value = t('wfe.imported');
  } catch (e2: any) { msg.value = t('wfe.failed', { msg: String(e2?.message || e2) }); }
  finally { busy.value = false; inp.value = ''; }
}

onMounted(() => { load(); window.addEventListener('keydown', onKey); });
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="weoverlay" @click.self="close">
    <div class="webox">
      <header class="weh">
        <span class="wtitle">{{ $t('wfe.title') }}</span>
        <nav class="tabs">
          <button v-for="k in (['form', 'xml', 'preview'] as const)" :key="k" class="tab" :class="{ on: tab === k }" @click="tab = k">{{ $t('wfe.tab.' + k) }}</button>
        </nav>
        <button class="wex" @click="close">×</button>
      </header>
      <div class="web">
        <WorkflowFormTab v-if="tab === 'form'" :model="model" @update:model="applyModel" />
        <WorkflowXmlTab v-else-if="tab === 'xml'" :model="model" @update:model="applyModel" />
        <WorkflowPreviewTab v-else :model="model" />
      </div>
      <footer class="wef">
        <span class="wemsg">{{ msg }}</span>
        <input ref="fileInput" type="file" accept=".xml,text/xml,application/xml" class="hidden" @change="onFile" />
        <button class="webtn" :disabled="busy" @click="pickFile">{{ $t('wfe.import') }}</button>
        <button class="webtn" :disabled="busy" @click="exportXml">{{ $t('wfe.export') }}</button>
        <button class="webtn primary" :disabled="!canSave" @click="save">{{ $t('wfe.save') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.weoverlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 60; }
.webox { width: 94vw; height: 90vh; max-width: 1600px; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.45); display: flex; flex-direction: column; overflow: hidden; }
.weh { display: flex; align-items: center; gap: 14px; padding: 10px 14px; background: var(--bg4); }
.wtitle { font-weight: 700; }
.tabs { display: flex; gap: 4px; margin-left: auto; }
.tab { background: none; border: 1px solid transparent; color: var(--tx3); border-radius: 4px; padding: 3px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.tab.on { background: var(--bg1); border-color: var(--bd); color: var(--tx1); }
.wex { background: none; border: none; color: var(--tx3); font-size: 18px; cursor: pointer; }
.web { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 14px; }
.wef { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--bd2); }
.wemsg { flex: 1; min-width: 0; color: var(--tx3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hidden { display: none; }
.webtn { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-family: inherit; }
.webtn:hover:not(:disabled) { border-color: var(--ac2); }
.webtn:disabled { opacity: .5; cursor: default; }
.webtn.primary { background: var(--ac); color: var(--onac); border-color: var(--ac); }
</style>
```

- [ ] **Step 2: 改 `TerminalView.vue` 入口按钮（第 735 行）**

把：

```html
          <button class="wfbtn edit" :title="$t('wfe.title')" @click="editorOpen = true">✎</button>
```

改为：

```html
          <button class="wfbtn edit" :title="$t('wfe.title')" @click="editorOpen = true">{{ $t('wfe.open') }}</button>
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add web/src/components/WorkflowEditor.vue web/src/components/TerminalView.vue
git commit -m "feat(web): 工作流编辑器全屏标签页宿主与新入口"
```

---

## Task 9: 全量验证与人工验收

- [ ] **Step 1: 跑全套检查**

Run: `npm.cmd test`
Expected: server + web 全绿。

Run: `npm.cmd run typecheck`
Expected: 无错误。

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失键、用户可见区无硬编码中文）。

Run: `npm.cmd run build:web`
Expected: 构建成功，产物 `web/dist`。

- [ ] **Step 2: 启动 dev 服务（异步，勿阻塞）**

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -WorkingDirectory "D:\root\devflow\devflow" -RedirectStandardOutput "D:\root\devflow\devflow\dev-server.log" -RedirectStandardError "D:\root\devflow\devflow\dev-server.err.log"
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:web" -WorkingDirectory "D:\root\devflow\devflow" -RedirectStandardOutput "D:\root\devflow\devflow\dev-web.log" -RedirectStandardError "D:\root\devflow\devflow\dev-web.err.log"
```

访问 http://localhost:5173，进入 Agent 会话。

- [ ] **Step 3: 人工核对验收清单**

1. 底部工作流栏出现带文字「编辑工作流」按钮；点击打开全屏编辑器。
2. 表单页：拖拽工作流/阶段/提示语顺序；双击分组名重命名；跨组拖拽阶段后组归属改变。
3. XML 页：改文本 300ms 后表单页同步；制造非法 XML 显示 `wfe.xml_error` 且表单不变；「从表单刷新」可用。
4. 预览页：切换工作流/阶段，分组与 chips 与表单一致。
5. 有重复/空 id 时保存按钮禁用并显示错误；修正后可保存。
6. 保存后终端底部工作流/阶段/提示语即时更新；重新打开编辑器内容一致。
7. 未保存时点 × 有确认；Ctrl+Z / Ctrl+Y 可撤销重做。
8. 导入/导出 XML 行为与旧版一致。

- [ ] **Step 4: 最终提交（如人工步骤产生修正）**

```bash
git add -A
git commit -m "test: 工作流编辑器增强验收修正"
```

> 若无需修正，跳过本步。

---

## Self-Review 记录

- **Spec 覆盖**：入口（Task 8）、全屏标签页（Task 8）、拖拽（Task 7）、分组带（Task 7 + `groupBands` Task 3）、XML 双向同步（Task 5）、预览（Task 6）、校验（Task 3 + Task 7）、未保存/撤销重做/复制（Task 8/7）、shared 模块（Task 1/2）、i18n（Task 4）、测试（Task 1/3/9）——逐项有对应任务。
- **类型一致**：`Workflow`/`WorkflowStage`/`ModelIssue`/`GroupBand` 在 Task 3 定义，Task 5/6/7/8 一致引用；`moveStageToIndex`、`groupBands`、`validateModel`、`sanitizeModel`、`duplicateWorkflow`、`newWorkflow`、`newStage` 命名前后一致。
- **占位符**：无 TBD/TODO；组件均给出完整代码。
