import { ref, computed } from 'vue';

export interface CenterTab {
  id: string;
  kind: 'session' | 'file' | 'tool';
  label: string;
  sub?: string;
  projectId?: string | null;
  path?: string;
  tool?: string;
}

const sid = (s: string) => `s:${s}`;
const fid = (p: string, path: string) => `f:${p}|${path}`;
const tid = (tool: string) => `t:${tool}`;

export function useCenter() {
  const tabs = ref<CenterTab[]>([]);
  const activeId = ref<string | null>(null);
  const active = computed(() => tabs.value.find((t) => t.id === activeId.value) || null);
  const activeKind = computed(() => active.value?.kind ?? 'session');
  const activeSessionTab = computed(() => tabs.value.find((t) => t.kind === 'session') || null);

  function setActive(id: string | null) {
    if (!id || tabs.value.some((t) => t.id === id)) activeId.value = id;
  }
  function upsert(tab: CenterTab) {
    const ex = tabs.value.find((t) => t.id === tab.id);
    if (ex) { ex.label = tab.label; ex.sub = tab.sub; return; }
    tabs.value.push(tab);
  }
  function ensureSession(sessionId: string, label: string, state: string) {
    const t: CenterTab = { id: sid(sessionId), kind: 'session', label, sub: state };
    upsert(t);
  }
  function hasSession(sessionId: string) {
    return tabs.value.some((t) => t.id === sid(sessionId));
  }
  function removeSession(sessionId: string) {
    const id = sid(sessionId);
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) setActive(activeSessionTab.value?.id ?? null);
  }
  function openFile(projectId: string, path: string, label: string) {
    const id = fid(projectId, path);
    upsert({ id, kind: 'file', label, projectId, path });
    setActive(id);
  }
  function closeFile(projectId: string, path: string) {
    const id = fid(projectId, path);
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) {
      const s = activeSessionTab.value;
      setActive(s ? s.id : tabs.value[0]?.id ?? null);
    }
  }
  function openTool(tool: string, label?: string) {
    const id = tid(tool);
    upsert({ id, kind: 'tool', label: label ?? tool, tool });
    setActive(id);
  }
  function activateSession(sessionId: string) {
    const id = sid(sessionId);
    // 已存在的页签只激活，不改写 label/state（否则会覆盖用户双击重命名的页签名）
    if (!tabs.value.some((t) => t.id === id)) {
      tabs.value.push({ id, kind: 'session', label: sessionId, sub: 'running' });
    }
    setActive(id);
  }
  function activateFileTab(id: string) { setActive(id); }
  function closeById(id: string) {
    if (id.startsWith('f:')) {
      const t = tabs.value.find((x) => x.id === id);
      if (t && t.projectId && t.path) closeFile(t.projectId, t.path);
      return;
    }
    if (id.startsWith('t:')) {
      tabs.value = tabs.value.filter((x) => x.id !== id);
      if (activeId.value === id) { const s = activeSessionTab.value; setActive(s ? s.id : tabs.value[0]?.id ?? null); }
      return;
    }
    tabs.value = tabs.value.filter((x) => x.id !== id);
    if (activeId.value === id) { const s = activeSessionTab.value; setActive(s ? s.id : null); }
  }

  return { tabs, activeId, active, activeKind, ensureSession, hasSession, removeSession, activateSession, openFile, closeFile, closeById, setActive, activateFileTab, openTool };
}
