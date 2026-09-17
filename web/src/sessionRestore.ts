import type { SessionSummary } from './useTerminal';

// 恢复会话的挑选逻辑抽成纯函数，便于单测；服务端负责注入续会话命令，前端只认领与展示。
export function pickRestoredAgent(sessions: SessionSummary[]): SessionSummary | null {
  return sessions.find((s) => !!s.restored && s.kind === 'agent') || null;
}

export function restoredAgentIds(sessions: SessionSummary[]): string[] {
  return sessions.filter((s) => !!s.restored && s.kind === 'agent').map((s) => s.id);
}
