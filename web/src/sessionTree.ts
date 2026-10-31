import type { HistoryMessage } from './useMessageHistory';

export interface SessionExtra { id: string; name?: string; updatedAt?: number; }
export interface SessionNode {
  key: string;
  label: string;
  sessionId: string | null;
  messages: HistoryMessage[];
  sortTs: number;
}

const UNKNOWN_KEY = '__unknown__';
export const MAX_SESSION_NODES = 30;

// 把历史消息按会话分组（sessionId 优先，其次 tabName，最后未知组），并合并「运行中/账本」
// 会话来源（extras，按 id 去重）：即使没有历史消息也生成节点，可被打开。
// 组内消息倒序；组间按 (最新消息 ts, extra.updatedAt) 取大者倒序；默认最多 MAX_SESSION_NODES 个。
export function buildSessionTree(
  messages: HistoryMessage[],
  unknownLabel = 'unknown',
  extras: SessionExtra[] = [],
  limit = MAX_SESSION_NODES,
): SessionNode[] {
  const groups = new Map<string, { sessionId: string | null; messages: HistoryMessage[]; extra?: SessionExtra }>();
  for (const msg of messages) {
    const sid = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : null;
    const name = typeof msg.tabName === 'string' && msg.tabName ? msg.tabName : null;
    const key = sid || (name ? `name:${name}` : UNKNOWN_KEY);
    let g = groups.get(key);
    if (!g) { g = { sessionId: sid, messages: [] }; groups.set(key, g); }
    g.messages.push(msg);
  }
  for (const ex of extras) {
    if (!ex || typeof ex.id !== 'string' || !ex.id) continue;
    let g = groups.get(ex.id);
    if (!g) { g = { sessionId: ex.id, messages: [] }; groups.set(ex.id, g); }
    g.extra = ex;
  }
  const nodes: SessionNode[] = [];
  for (const [key, g] of groups) {
    g.messages.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const named = g.messages.find((x) => typeof x.tabName === 'string' && x.tabName);
    const latest = g.messages[0]?.ts || 0;
    const extraTs = g.extra?.updatedAt || 0;
    nodes.push({
      key,
      label: named?.tabName || g.extra?.name || g.sessionId || unknownLabel,
      sessionId: g.sessionId,
      messages: g.messages,
      sortTs: Math.max(latest, extraTs),
    });
  }
  nodes.sort((a, b) => (b.sortTs || 0) - (a.sortTs || 0));
  return nodes.slice(0, limit);
}
