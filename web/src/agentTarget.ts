export interface TargetSession {
  id: string;
  kind?: 'agent' | 'shell' | 'workflow';
  agentId?: string | null;
  projectId?: string | null;
}

export function needsSelectedAgentSession(active: TargetSession | null, selectedAgentId: string): boolean {
  if (!active) return true;
  if (active.kind !== 'agent') return false;
  return String(active.agentId || '') !== String(selectedAgentId || '');
}

export function canReuseAgentSession(
  session: TargetSession | null,
  selectedAgentId: string,
  projectId: string | null,
): boolean {
  if (!session) return false;
  if (String(session.agentId || '') !== String(selectedAgentId || '')) return false;
  return (session.projectId ?? null) === (projectId ?? null);
}
