// 分发任务/分发通知的前端纯逻辑（便于单测；组件只做渲染与交互）

export interface DistTaskPayload {
  skills?: string[];
  command?: string[];
  agent?: string[];
  workflow?: { id: string; label: string }[];
  count?: number;
  size?: number;
  skillsUpdatedAt?: number;
  workflowUpdatedAt?: number;
  lastError?: string;
}

export interface DistTask {
  id: string;
  groupId: string;
  hubId?: string;
  kind: string;
  hash: string;
  name?: string;
  url?: string;
  status: string;
  messageId?: string;
  createdAt?: number;
  updatedAt?: number;
  payload?: DistTaskPayload;
}

export interface DistTaskGroups {
  pending: DistTask[];
  done: DistTask[];
  ignored: DistTask[];
  failed: DistTask[];
}

export function groupTasksByStatus(list: DistTask[]): DistTaskGroups {
  const out: DistTaskGroups = { pending: [], done: [], ignored: [], failed: [] };
  for (const t of list || []) {
    const bucket = (out as unknown as Record<string, DistTask[]>)[t.status];
    if (bucket) bucket.push(t);
  }
  return out;
}

export function kindKeyOf(kind: string): string {
  return kind === 'workflow' ? 'collab.task.workflow' : 'collab.task.skills';
}

export function taskItemCount(task: DistTask): number {
  const p = task.payload || {};
  const n = (p.skills?.length || 0) + (p.command?.length || 0) + (p.agent?.length || 0) + (p.workflow?.length || 0);
  return n || Number(p.count) || 0;
}

export interface DistCard { type: string; name: string; url: string; count: number }

export function distCardOf(msg: { kind?: string; meta?: unknown } | null | undefined): DistCard | null {
  if (!msg || msg.kind !== 'dist' || !msg.meta || typeof msg.meta !== 'object') return null;
  const meta = msg.meta as { type?: string; name?: string; url?: string; count?: number };
  return { type: meta.type || 'skills', name: meta.name || '', url: meta.url || '', count: Number(meta.count) || 0 };
}
