import type { HistoryMessage } from './useMessageHistory';

export interface SessionNode {
  key: string;
  label: string;
  sessionId: string | null;
  messages: HistoryMessage[];
}

const UNKNOWN_KEY = '__unknown__';

// 把历史消息按会话分组：sessionId 优先，其次 tabName，最后归入未知组。
// 组内消息按时间倒序；组间按各自最新消息时间倒序；标签取该组最新的 tabName。
export function buildSessionTree(messages: HistoryMessage[], unknownLabel = 'unknown'): SessionNode[] {
  const groups = new Map<string, { sessionId: string | null; messages: HistoryMessage[] }>();
  for (const msg of messages) {
    const sid = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : null;
    const name = typeof msg.tabName === 'string' && msg.tabName ? msg.tabName : null;
    const key = sid || (name ? `name:${name}` : UNKNOWN_KEY);
    let g = groups.get(key);
    if (!g) { g = { sessionId: sid, messages: [] }; groups.set(key, g); }
    g.messages.push(msg);
  }
  const nodes: SessionNode[] = [];
  for (const [key, g] of groups) {
    g.messages.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const named = g.messages.find((x) => typeof x.tabName === 'string' && x.tabName);
    nodes.push({ key, label: named?.tabName || g.sessionId || unknownLabel, sessionId: g.sessionId, messages: g.messages });
  }
  nodes.sort((a, b) => (b.messages[0]?.ts || 0) - (a.messages[0]?.ts || 0));
  return nodes;
}
