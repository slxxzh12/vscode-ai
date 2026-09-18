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
  if (kind === 'workflow') return 'collab.task.workflow';
  if (kind === 'upload') return 'collab.task.upload';
  return 'collab.task.skills';
}

export function taskItemCount(task: DistTask): number {
  const p = task.payload || {};
  const n = (p.skills?.length || 0) + (p.command?.length || 0) + (p.agent?.length || 0) + (p.workflow?.length || 0);
  return n || Number(p.count) || 0;
}

export interface DistCard { type: string; name: string; url: string; count: number }

// 分发通知（群主广播 kind:'dist'）与上传通知（成员上传 kind:'pkg-upload'）都渲染为卡片
export function distCardOf(msg: { kind?: string; meta?: unknown } | null | undefined): DistCard | null {
  if (!msg || (msg.kind !== 'dist' && msg.kind !== 'pkg-upload') || !msg.meta || typeof msg.meta !== 'object') return null;
  const meta = msg.meta as { type?: string; name?: string; url?: string; count?: number };
  return { type: meta.type || 'skills', name: meta.name || '', url: meta.url || '', count: Number(meta.count) || 0 };
}

// 「去任务页接受」按钮是否展示：自己发的消息一律不展示；
// 群主广播（dist，面向全体）除发送者外都展示；成员上传（pkg-upload）只对群主（toId === me）展示。
export function showAccept(msg: { kind?: string; fromId?: string; toId?: string | null } | null | undefined, meId: string): boolean {
  if (!msg || !msg.kind || !meId || msg.fromId === meId) return false;
  if (msg.kind === 'dist') return true;
  if (msg.kind === 'pkg-upload') return msg.toId === meId;
  return false;
}
