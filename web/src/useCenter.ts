import { ref, computed } from 'vue';
import { useLocalSources } from './local/useLocalSources';

export interface CenterTab {
  id: string;
  kind: 'session' | 'file' | 'tool' | 'local';
  label: string;
  sub?: string;
  projectId?: string | null;
  path?: string;
  tool?: string;
}

const sid = (s: string) => `s:${s}`;
const fid = (p: string, path: string) => `f:${p}|${path}`;
const tid = (tool: string) => `t:${tool}`;
const lidRoot = 'l:root';
const lidFile = (key: string) => `l:f:${key}`;

export function useCenter() {
  const tabs = ref<CenterTab[]>([]);
  const activeId = ref<string | null>(null);
  const active = computed(() => tabs.value.find((t) => t.id === activeId.value) || null);
  const activeKind = computed(() => active.value?.kind ?? 'session');
  const scopeProjectId = ref<string | null>(null);
  const sameScope = (a: string | null | undefined, b: string | null | undefined) => (a ?? '') === (b ?? '');
  const visibleTabs = computed(() => tabs.value.filter((t) => t.kind !== 'session' || sameScope(t.projectId, scopeProjectId.value)));
  const activeSessionTab = computed(() => visibleTabs.value.find((t) => t.kind === 'session') || null);

  function setActive(id: string | null) {
    if (!id || tabs.value.some((t) => t.id === id)) activeId.value = id;
  }
  function upsert(tab: CenterTab) {
    const ex = tabs.value.find((t) => t.id === tab.id);
    if (ex) { ex.label = tab.label; ex.sub = tab.sub; return; }
    tabs.value.push(tab);
  }
  function ensureSession(sessionId: string, label: string, state: string, projectId?: string | null) {
    const t: CenterTab = { id: sid(sessionId), kind: 'session', label, sub: state, projectId: projectId ?? null };
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
  function openFile(projectId: string, path: string, label: string, activate = true) {
    const id = fid(projectId, path);
    upsert({ id, kind: 'file', label, projectId, path });
    if (activate) setActive(id);
  }
  function closeFile(projectId: string, path: string) {
    const id = fid(projectId, path);
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) {
      const s = activeSessionTab.value;
      setActive(s ? s.id : visibleTabs.value[0]?.id ?? null);
    }
  }
  function openTool(tool: string, label?: string) {
    const id = tid(tool);
    upsert({ id, kind: 'tool', label: label ?? tool, tool });
    setActive(id);
  }
  function openLocalRoot(label: string) {
    const ex = tabs.value.find((t) => t.id === lidRoot);
    if (ex) { ex.label = label || ex.label; setActive(lidRoot); return; }
    tabs.value.push({ id: lidRoot, kind: 'local', label: label || 'local' });
    setActive(lidRoot);
  }
  function openLocalFile(key: string, label: string) {
    const id = lidFile(key);
    const ex = tabs.value.find((t) => t.id === id);
    if (ex) { ex.label = label || ex.label; setActive(id); return; }
    tabs.value.push({ id, kind: 'local', label });
    setActive(id);
  }
  function activateSession(sessionId: string, projectId?: string | null) {
    const id = sid(sessionId);
    // 已存在的页签只激活，不改写 label/state（否则会覆盖用户双击重命名的页签名）
    if (!tabs.value.some((t) => t.id === id)) {
      tabs.value.push({ id, kind: 'session', label: sessionId, sub: 'running', projectId: projectId ?? null });
    }
    setActive(id);
  }
  function activateFileTab(id: string) { setActive(id); }
  function closeById(id: string) {
    if (id.startsWith('l:')) {
      const local = useLocalSources();
      if (id === lidRoot) local.unmountRoot();
      else local.removeFile(id.slice('l:f:'.length));
      tabs.value = tabs.value.filter((x) => x.id !== id);
      if (activeId.value === id) {
        const s = activeSessionTab.value;
        setActive(s ? s.id : visibleTabs.value[0]?.id ?? null);
      }
      return;
    }
    if (id.startsWith('f:')) {
      const t = tabs.value.find((x) => x.id === id);
      if (t && t.projectId && t.path) closeFile(t.projectId, t.path);
      return;
    }
    if (id.startsWith('t:')) {
      tabs.value = tabs.value.filter((x) => x.id !== id);
      if (activeId.value === id) { const s = activeSessionTab.value; setActive(s ? s.id : visibleTabs.value[0]?.id ?? null); }
      return;
    }
    tabs.value = tabs.value.filter((x) => x.id !== id);
    if (activeId.value === id) { const s = activeSessionTab.value; setActive(s ? s.id : null); }
  }

  return { tabs, activeId, active, activeKind, visibleTabs, scopeProjectId, ensureSession, hasSession, removeSession, activateSession, openFile, closeFile, closeById, setActive, activateFileTab, openTool, openLocalRoot, openLocalFile };
}
