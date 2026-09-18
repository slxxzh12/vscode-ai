// 手机页（远程访问）模式的纯判定：是否 Agent 会话、无会话时的空态提示词条。
export interface PhoneSession {
  id: string;
  kind?: 'agent' | 'shell' | 'workflow';
  agentId?: string | null;
  state?: 'running' | 'exited';
}

// Agent 会话判定：kind 为 agent，或带 agentId（恢复的会话可能只留 agentId）
export function isAgentSession(session: PhoneSession | null | undefined): boolean {
  return !!session && (session.kind === 'agent' || !!session.agentId);
}

// 未选会话时给空态提示：有运行中会话 → 让用户点页签；没有 → 让用户去桌面开
export function phoneHintKey(input: {
  sessions: PhoneSession[];
  activeSessionId: string | null;
}): 'remote.pick_session' | 'remote.no_sessions' | null {
  if (input.activeSessionId) return null;
  return input.sessions.some((s) => s.state === 'running') ? 'remote.pick_session' : 'remote.no_sessions';
}
