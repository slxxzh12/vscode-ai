import { ref } from 'vue';

// 服务端会话账本（<端口数据目录>/sessions.json，≤30 条）：含已关闭的会话。
// 历史面板「全部会话」用它把没有历史消息的会话也列出来。
export interface LedgerSession {
  id: string; name: string; projectId: string | null;
  kind?: string; agentId?: string | null;
  state: 'running' | 'exited';
  createdAt?: number; updatedAt?: number;
}

const sessions = ref<LedgerSession[]>([]);
let loadPromise: Promise<void> | null = null;

export function normalizeLedgerSessions(input: unknown): LedgerSession[] {
  const list = input && typeof input === 'object' && !Array.isArray(input) ? (input as { sessions?: unknown }).sessions : null;
  if (!Array.isArray(list)) return [];
  const out: LedgerSession[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    out.push({
      id: o.id,
      name: typeof o.name === 'string' && o.name ? o.name : o.id,
      projectId: typeof o.projectId === 'string' ? o.projectId : null,
      kind: typeof o.kind === 'string' ? o.kind : undefined,
      agentId: typeof o.agentId === 'string' ? o.agentId : null,
      state: o.state === 'exited' ? 'exited' : 'running',
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : undefined,
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : undefined,
    });
  }
  return out;
}

export async function fetchLedgerSessions(): Promise<LedgerSession[]> {
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) return [];
    return normalizeLedgerSessions(await res.json());
  } catch { return []; }
}

export function useLedgerSessions() {
  async function load(force = false): Promise<void> {
    if (loadPromise && !force) return loadPromise;
    loadPromise = (async () => { sessions.value = await fetchLedgerSessions(); })();
    return loadPromise;
  }
  return { sessions, load };
}
