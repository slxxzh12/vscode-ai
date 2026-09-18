import { ref } from 'vue';

// 输入历史共享状态（服务端存于用户数据目录的 message-history.jsonc）。
// 模块级单例：TerminalView 负责 push/renameTab，App/HistoryList 负责展示与清空。
// 内存优先：所有增删改只改内存，随后防抖刷盘，避免频繁请求。
export interface HistoryMessage { text: string; ts: number; sessionId?: string; tabName?: string; }

const MAX = 200;
const messages = ref<HistoryMessage[]>([]);
// 会话自定义页签名（sessionId → 名）：改名时同步记录，供左侧「全部会话」树展示。
// 不参与刷盘；持久化由 TerminalView 的 localStorage 负责，挂载时用 setNames 回灌。
const names = ref<Record<string, string>>({});
let loadPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function norm(x: unknown): HistoryMessage | null {
  if (typeof x === 'string') return { text: x, ts: 0 };
  if (x && typeof (x as { text?: unknown }).text === 'string') {
    const o = x as { text: string; ts?: unknown; sessionId?: unknown; tabName?: unknown };
    const m: HistoryMessage = { text: o.text, ts: Number(o.ts) || 0 };
    if (typeof o.sessionId === 'string') m.sessionId = o.sessionId;
    if (typeof o.tabName === 'string') m.tabName = o.tabName;
    return m;
  }
  return null;
}

async function load(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const r = await fetch('/api/history').then((x) => x.json());
      if (Array.isArray(r?.messages)) messages.value = r.messages.map(norm).filter(Boolean) as HistoryMessage[];
    } catch { /* ignore */ }
  })();
  return loadPromise;
}

async function flush(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  try {
    await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.value.slice(0, MAX) }),
      keepalive: true,
    });
  } catch { /* ignore */ }
}

function scheduleFlush(delay = 800): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, delay);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { void flush(); });
}

export function useMessageHistory() {
  async function push(text: string, opts: { sessionId?: string; tabName?: string } = {}) {
    const t = text.trim();
    if (!t) return;
    await load();
    if (messages.value[0]?.text === t) return;           // 连续重复不记录
    const m: HistoryMessage = { text: t, ts: Date.now() };
    if (opts.sessionId) m.sessionId = opts.sessionId;
    if (opts.tabName) m.tabName = opts.tabName;
    messages.value = [m, ...messages.value.filter((x) => x.text !== t)].slice(0, MAX);
    scheduleFlush();
  }
  function remove(msg: HistoryMessage) {
    messages.value = messages.value.filter((x) => x !== msg);
    scheduleFlush();
  }
  function clear() { messages.value = []; scheduleFlush(); }
  // 批量回灌会话自定义名（过滤非法项）
  function setNames(map: Record<string, string>) {
    const next: Record<string, string> = {};
    if (map && typeof map === 'object') {
      for (const [id, name] of Object.entries(map)) {
        if (id && typeof name === 'string' && name.trim()) next[id] = name;
      }
    }
    names.value = next;
  }
  // 页签改名后，把该会话下所有历史消息的页签名一并更新，并记录会话自定义名
  function renameTab(sessionId: string, tabName: string) {
    let changed = false;
    messages.value = messages.value.map((m) => {
      if (m.sessionId === sessionId && m.tabName !== tabName) { changed = true; return { ...m, tabName }; }
      return m;
    });
    if (changed) scheduleFlush();
    if (sessionId && tabName.trim()) names.value = { ...names.value, [sessionId]: tabName };
  }
  return { messages, names, load, push, remove, clear, flush, renameTab, setNames };
}
