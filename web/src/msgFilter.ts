import type { HistoryMessage } from './useMessageHistory';
import type { CenterTab } from './useCenter';
import type { SessionProjectMap } from './sessionProjects';

// 左侧「消息」页的筛选：仅当前会话 / 全部会话，二者互斥。
// 「仅当前会话」按 sessionId 匹配；没有活跃会话时退化为当前项目（项目归属优先查活跃会话，
// 服务端重启后查 session-projects.json 映射，查不到的老消息照常显示）。
// 「全部会话」不过滤，显示所有消息。
export interface FilterInput {
  messages: HistoryMessage[];
  filterOn: boolean;
  sessionId: string | null;                              // 当前会话页签对应的会话 id
  tabName: string | null;                                // 当前会话页签的显示名
  projectId: string | null;                              // 当前项目
  liveProjectBySession: Record<string, string | null>;   // 来自 terminal.state.sessions
  map: SessionProjectMap;                                // 来自 /api/session-projects
}

export function sessionOfActiveTab(tab: CenterTab | null): { sessionId: string; tabName: string } | null {
  if (!tab || tab.kind !== 'session' || !tab.id.startsWith('s:')) return null;
  return { sessionId: tab.id.slice(2), tabName: tab.label };
}

export function resolveProject(
  msg: HistoryMessage,
  liveProjectBySession: Record<string, string | null>,
  map: SessionProjectMap,
): string | null {
  const sid = msg.sessionId;
  if (!sid) return null;
  const live = liveProjectBySession[sid];
  if (typeof live === 'string' && live) return live;
  const saved = map[sid];
  if (typeof saved === 'string' && saved) return saved;
  return null;
}

export function filterMessages(input: FilterInput): HistoryMessage[] {
  const { messages, filterOn, sessionId, tabName, projectId, liveProjectBySession, map } = input;
  if (!filterOn) return messages;   // 全部会话：不过滤
  if (sessionId) {
    return messages.filter((m) => (m.sessionId ? m.sessionId === sessionId : !!tabName && m.tabName === tabName));
  }
  if (!projectId) return messages;
  return messages.filter((m) => {
    const p = resolveProject(m, liveProjectBySession, map);
    return p === null || p === projectId;   // 无法归属的老消息照常显示
  });
}
