import type { HistoryMessage } from './useMessageHistory';
import type { CenterTab } from './useCenter';
import type { SessionProjectMap } from './sessionProjects';

// 左侧「消息」页的筛选：默认只看当前会话；关掉看当前项目。
// 项目归属优先查活跃会话，服务端重启后查 session-projects.json 映射；
// 两者都查不到的（升级前的老消息）视为「无法归属」——关闭筛选时照常显示，避免看起来像被清空。
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
  if (filterOn && sessionId) {
    return messages.filter((m) => (m.sessionId ? m.sessionId === sessionId : !!tabName && m.tabName === tabName));
  }
  if (!projectId) return messages;
  return messages.filter((m) => {
    const p = resolveProject(m, liveProjectBySession, map);
    return p === null || p === projectId;   // 无法归属的老消息照常显示
  });
}
