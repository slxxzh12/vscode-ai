import { ref } from 'vue';

// 输入历史共享状态（服务端存于用户数据目录的 message-history.jsonc）。
// 模块级单例：TerminalView 负责 push，App/HistoryList 负责展示与清空。
const MAX = 200;
const messages = ref<string[]>([]);
let loadPromise: Promise<void> | null = null;

async function load(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const r = await fetch('/api/history').then((x) => x.json());
      if (Array.isArray(r?.messages)) messages.value = r.messages.filter((x: unknown) => typeof x === 'string');
    } catch { /* ignore */ }
  })();
  return loadPromise;
}

async function persist(): Promise<void> {
  try {
    await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.value.slice(0, MAX) }),
    });
  } catch { /* ignore */ }
}

export function useMessageHistory() {
  async function push(text: string) {
    const t = text.trim();
    if (!t) return;
    await load();
    if (messages.value[0] === t) return;                 // 连续重复不记录
    messages.value = [t, ...messages.value.filter((x) => x !== t)].slice(0, MAX);
    await persist();
  }
  function clear() { messages.value = []; void persist(); }
  return { messages, load, push, clear };
}
