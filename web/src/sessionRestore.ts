import type { SessionSummary } from './useTerminal';

// 恢复会话的挑选逻辑抽成纯函数，便于单测；服务端负责注入续会话命令，前端只认领与展示。
export function pickRestoredAgent(sessions: SessionSummary[]): SessionSummary | null {
  return sessions.find((s) => !!s.restored && s.kind === 'agent') || null;
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
