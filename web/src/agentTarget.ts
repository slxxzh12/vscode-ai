// 已下线的内置 Agent：从服务端配置与浏览器缓存里一并剔掉
export const RETIRED_AGENT_IDS = ['pi'] as const;

export function isRetiredAgent(id: string | null | undefined): boolean {
  return (RETIRED_AGENT_IDS as readonly string[]).includes(String(id || '').toLowerCase());
}

export interface TargetSession {
  id: string;
  kind?: 'agent' | 'shell' | 'workflow';
  agentId?: string | null;
  projectId?: string | null;
  state?: 'running' | 'exited';
}

export function needsSelectedAgentSession(active: TargetSession | null, selectedAgentId: string): boolean {
  if (!active) return true;
  if (active.kind !== 'agent') return false;
  if (active.state === 'exited') return true;   // 进程已退出：必须重建，否则消息写不进去
  return String(active.agentId || '') !== String(selectedAgentId || '');
}

export function canReuseAgentSession(
  session: TargetSession | null,
  selectedAgentId: string,
  projectId: string | null,
  forceNew = false,
): boolean {
  if (forceNew) return false;                   // 显式新建：不复用已有会话
  if (!session) return false;
  if (session.state === 'exited') return false; // 死会话不可复用
  if (String(session.agentId || '') !== String(selectedAgentId || '')) return false;
  return (session.projectId ?? null) === (projectId ?? null);
}

// 发送输入时是否要先（重新）拉起 Agent：
// 固定 Agent 会话、无活动会话、或当前活动是已退出的 Agent（死进程会把消息吞掉）。
export function needsAgentStart(
  active: TargetSession | null,
  agentSid: string | null,
  selectedAgentId: string,
): boolean {
  const fixedActive = !active || active.id === agentSid || (active.kind === 'agent' && active.state === 'exited');
  return fixedActive && needsSelectedAgentSession(active, selectedAgentId);
}

// Agent 选中项解析：配置热更新（fs.watch → CONFIG_CHANGED）时保留当前选择，
// 避免旧的默认值/在途请求把用户刚选的 Agent 覆盖回去；当前项已不存在才回退到服务端默认。
export function resolveAgentSelection(
  currentId: string | null | undefined,
  agentIds: string[],
  serverDefaultId: string | null | undefined,
  preserve = false,
): string {
  const ids = Array.isArray(agentIds) ? agentIds.filter(Boolean) : [];
  if (!ids.length) return String(currentId || serverDefaultId || '');
  const cur = String(currentId || '');
  if (preserve && cur && ids.includes(cur)) return cur;
  const def = String(serverDefaultId || '');
  if (def && ids.includes(def)) return def;
  return ids[0];
}
