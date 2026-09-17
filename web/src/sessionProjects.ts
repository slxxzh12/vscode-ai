import { ref } from 'vue';

// sessionId → projectId（服务端 <端口数据目录>/session-projects.json）。
// 服务端重启后 PTY 消失、sessionId 失效，靠这份映射仍能把老消息归属到项目。
export type SessionProjectMap = Record<string, string>;

const map = ref<SessionProjectMap>({});
let loadPromise: Promise<void> | null = null;

export function normalizeMap(input: unknown): SessionProjectMap {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out: SessionProjectMap = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v) out[k] = v;
  return out;
}

export async function fetchSessionProjects(): Promise<SessionProjectMap> {
  try {
    const res = await fetch('/api/session-projects');
    if (!res.ok) return {};
    return normalizeMap(await res.json());
  } catch { return {}; }   // 映射只是筛选的兜底，拿不到就退化为「只认活跃会话」
}

export function useSessionProjects() {
  async function load(): Promise<void> {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => { map.value = await fetchSessionProjects(); })();
    return loadPromise;
  }
  return { map, load };
}
