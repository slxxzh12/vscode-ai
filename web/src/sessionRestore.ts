import type { SessionSummary } from './useTerminal';

// 每个会话最后一条用户消息的时间（用户真正在哪个窗口聊天，比 agent 后台输出更准）。
export function latestMessageBySession(messages: { sessionId?: string; ts?: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of messages) {
    if (!m.sessionId) continue;
    const ts = Number(m.ts) || 0;
    if (ts > (out[m.sessionId] || 0)) out[m.sessionId] = ts;
  }
  return out;
}

// 恢复会话的挑选逻辑抽成纯函数，便于单测；服务端负责注入续会话命令，前端只认领与展示。
// 多个已恢复 agent 时选“最近用过”的那个：用户消息时间优先，其次 lastActiveAt（服务端按会话日志 mtime 算），
// 不能按数组顺序/创建时间挑，否则会打开很早创建但早已不用的会话。
export function pickRestoredAgent(
  sessions: SessionSummary[],
  latestMessageAt: Record<string, number> = {},
): SessionSummary | null {
  let best: SessionSummary | null = null;
  let bestAt = -1;
  for (const s of sessions) {
    if (!s.restored || s.kind !== 'agent') continue;
    const activity = Number(s.lastActiveAt) || Number(s.createdAt) || 0;
    const at = Math.max(Number(latestMessageAt[s.id]) || 0, activity);
    if (at > bestAt) { best = s; bestAt = at; }
  }
  return best;
}

export function restoredAgentIds(sessions: SessionSummary[]): string[] {
  return sessions.filter((s) => !!s.restored && s.kind === 'agent').map((s) => s.id);
}

export interface OpenRestoredSessionDeps {
  restore: (sessionId: string) => Promise<SessionSummary | null>;
  activate: (sessionId: string) => void;
  error: () => string;
  onFailed: (reason: string) => void;
  onFreshAgent: () => void;
  onRecreated: () => void;
}

// 打开历史会话：恢复成功后必须显式激活中心页签，不能只依赖 activeSessionId 变化触发 watcher。
// 再次打开当前活动会话时 id 不变，watcher 不触发 → 右侧会一直停在文件页签，看不到会话。
export async function openRestoredSession(sessionId: string, deps: OpenRestoredSessionDeps): Promise<SessionSummary | null> {
  const s = await deps.restore(sessionId);
  if (!s) { deps.onFailed(deps.error() || 'restore-failed'); return null; }
  deps.activate(s.id);
  if (s.recreated) deps.onRecreated();
  else if (s.restored && s.kind === 'agent' && s.resumed === false) deps.onFreshAgent();
  return s;
}
