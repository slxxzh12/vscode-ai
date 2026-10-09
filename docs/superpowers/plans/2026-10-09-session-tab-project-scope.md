# 会话页签按目录显隐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **提交约定（AGENTS.md）：** 未明确要求不得 commit；下列 Commit 步骤仅为检查点。

**Goal:** 会话页签绑定创建目录；切换目录时隐藏不匹配的会话页签（进程保留），切回原目录自动重现。

**Architecture:** `useCenter` 增 `scopeProjectId` 与 `visibleTabs`（非 session 页签放行，session 按目录过滤），活动兜底改为基于 `visibleTabs`；`TerminalView` 写入每个会话的 `projectId`、渲染 `visibleTabs`、在项目变化时同步作用域并纠正活动页签。

**Tech Stack:** Vue3 + TS（vitest）。

---

## File Structure

- `web/src/useCenter.ts` — `scopeProjectId` / `visibleTabs` / 带 `projectId` 的 `ensureSession`、`activateSession` / 作用域内兜底。
- `web/src/useCenter.test.ts` — 对应用例。
- `web/src/components/TerminalView.vue` — 写入 `projectId`、渲染 `visibleTabs`、`showWelcome`、项目变化处理。

---

## Task 1: useCenter 项目作用域

**Files:** Modify `web/src/useCenter.ts`; Test `web/src/useCenter.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/useCenter.test.ts` 末尾追加：

```ts
test('visibleTabs 按 scopeProjectId 过滤会话页签，文件/工具始终可见', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running', 'p1');
  c.ensureSession('b', 'B', 'running', 'p2');
  c.openFile('p1', 'x.ts', 'x.ts');
  c.openTool('notepad');
  c.scopeProjectId.value = 'p1';
  expect(c.visibleTabs.value.map((t) => t.id)).toEqual(['s:a', 'f:p1|x.ts', 't:notepad']);
  c.scopeProjectId.value = 'p2';
  expect(c.visibleTabs.value.map((t) => t.id)).toEqual(['s:b', 'f:p1|x.ts', 't:notepad']);
});

test('visibleTabs：null 与空串视为同作用域', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running', '');
  c.scopeProjectId.value = null;
  expect(c.visibleTabs.value.some((t) => t.id === 's:a')).toBe(true);
});

test('关闭活动文件页签兜底不落到隐藏会话页签', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running', 'p1');
  c.ensureSession('b', 'B', 'running', 'p2');
  c.scopeProjectId.value = 'p1';
  c.activateSession('a', 'p1');
  c.openFile('p1', 'x.ts', 'x.ts');
  c.closeById('f:p1|x.ts');
  expect(c.activeId.value).toBe('s:a');
});
```

- [ ] **Step 2: 运行确认失败**

Run（工作目录 `web`）: `npx.cmd vitest run src/useCenter.test.ts`
Expected: FAIL（`scopeProjectId`/`visibleTabs` 不存在）

- [ ] **Step 3: 实现**

`web/src/useCenter.ts` 关键改动：

1. `ensureSession` / `activateSession` 增可选 `projectId`：

```ts
  function ensureSession(sessionId: string, label: string, state: string, projectId?: string | null) {
    const t: CenterTab = { id: sid(sessionId), kind: 'session', label, sub: state, projectId: projectId ?? null };
    upsert(t);
  }
```

```ts
  function activateSession(sessionId: string, projectId?: string | null) {
    const id = sid(sessionId);
    if (!tabs.value.some((t) => t.id === id)) {
      tabs.value.push({ id, kind: 'session', label: sessionId, sub: 'running', projectId: projectId ?? null });
    }
    setActive(id);
  }
```

2. 增作用域与可见集合（放在 `activeId` 之后）：

```ts
  const scopeProjectId = ref<string | null>(null);
  const sameScope = (a: string | null | undefined, b: string | null | undefined) => (a ?? '') === (b ?? '');
  const visibleTabs = computed(() => tabs.value.filter((t) => t.kind !== 'session' || sameScope(t.projectId, scopeProjectId.value)));
```

3. `activeSessionTab` 改为基于可见集合：

```ts
  const activeSessionTab = computed(() => visibleTabs.value.find((t) => t.kind === 'session') || null);
```

4. 兜底把 `tabs.value[0]` 换成 `visibleTabs.value[0]`：`removeSession` 保持 `activeSessionTab?.id ?? null`；`closeFile`、`closeById` 的 `f:`/`t:`/`l:` 分支用 `visibleTabs.value[0]?.id ?? null`。

5. `return` 对象加入 `scopeProjectId, visibleTabs`。

- [ ] **Step 4: 运行确认通过**

Run（工作目录 `web`）: `npx.cmd vitest run src/useCenter.test.ts`
Expected: PASS（含既有 18 个用例）

---

## Task 2: TerminalView 写入目录并渲染可见页签

**Files:** Modify `web/src/components/TerminalView.vue`

- [ ] **Step 1: 增 `sessionProjectId` 辅助（`~135` `sessionLabel` 旁）**

```ts
function sessionProjectId(id: string): string | null {
  return props.terminal.state.sessions.find((s) => s.id === id)?.projectId ?? null;
}
```

- [ ] **Step 2: 所有 `ensureSession`/`activateSession` 调用补目录**

把这些调用补上对应 `sessionProjectId(id)`（对 `id` 为会话 id 的调用）：
`~204`（onTabDialogConfirm）、`~502`（createNew，用 `s.id`）、`~611`（startAgent，用 `s.id`）、`~1103`（knownSessions watcher，用 `id`）、`~1116`（tabNames watcher，用 `s.id`）、`~1125`（activeSessionId watcher，用 `id`）、`~1126`（同处 activateSession）、`~1170`（onTabClick，用 `sid`）。

例：`props.center.ensureSession(sid, tabLabel(sid), sessionState(sid), sessionProjectId(sid));`
`props.center.activateSession(sid, sessionProjectId(sid));`

- [ ] **Step 3: 页签条渲染可见集合**

模板 `~1398`：

```html
      <div v-for="t in center.visibleTabs.value" :key="t.id" class="tab"
```

- [ ] **Step 4: `showWelcome` 基于可见集合（`~653`）**

```ts
const showWelcome = computed(() => !props.phone && props.center.visibleTabs.value.length === 0);
```

- [ ] **Step 5: 项目变化处理（`~646`）**

```ts
watch(() => props.projectId, (nid, oid) => {
  if (nid === oid) return;
  props.center.scopeProjectId.value = nid ?? null;
  const visible = props.center.visibleTabs.value;
  if (!visible.some((t) => t.id === props.center.activeId.value)) {
    const pref = visible.find((t) => t.kind === 'session' && t.id === `s:${agentSid.value}`) || visible[0] || null;
    if (pref) {
      props.center.setActive(pref.id);
      if (pref.kind === 'session') props.terminal.switchTo(pref.id.slice(2));
    } else {
      props.center.setActive(null);
      props.terminal.setOutput(null);
    }
  }
});
```

- [ ] **Step 6: 挂载时初始化作用域**

`onMounted`（`~1209` `init()` 之前/之后）：

```ts
  props.center.scopeProjectId.value = props.projectId ?? null;
```

- [ ] **Step 7: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 8: 回归现有 web 测试**

Run: `npm.cmd run test:web`
Expected: PASS

---

## Task 3: 全量验证

- [ ] **Step 1:** `npm.cmd test` → PASS
- [ ] **Step 2:** `npm.cmd run typecheck` → PASS
- [ ] **Step 3（手工）:** 项目 A 开 2 个会话 → 切到项目 B：A 的会话页签消失、B 无页签显示欢迎页 → 切回 A：A 的会话页签（含进程输出）原样重现；文件/工具页签始终在。
