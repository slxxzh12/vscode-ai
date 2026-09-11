import { ref } from 'vue';

// 输入历史共享状态（服务端存于用户数据目录的 message-history.jsonc）。
// 模块级单例：TerminalView 负责 push，App/HistoryList 负责展示与清空。
// 内存优先：所有增删改只改内存，随后防抖刷盘，避免频繁请求。
export interface HistoryMessage { text: string; ts: number; }

const MAX = 200;
const messages = ref<HistoryMessage[]>([]);
let loadPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function norm(x: unknown): HistoryMessage | null {
  if (typeof x === 'string') return { text: x, ts: 0 };
  if (x && typeof (x as { text?: unknown }).text === 'string') {
    return { text: (x as { text: string }).text, ts: Number((x as { ts?: unknown }).ts) || 0 };
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
  async function push(text: string) {
    const t = text.trim();
    if (!t) return;
    await load();
    if (messages.value[0]?.text === t) return;           // 连续重复不记录
    messages.value = [{ text: t, ts: Date.now() }, ...messages.value.filter((x) => x.text !== t)].slice(0, MAX);
    scheduleFlush();
  }
  function remove(msg: HistoryMessage) {
    messages.value = messages.value.filter((x) => x !== msg);
    scheduleFlush();
  }
  function clear() { messages.value = []; scheduleFlush(); }
  return { messages, load, push, remove, clear, flush };
}
