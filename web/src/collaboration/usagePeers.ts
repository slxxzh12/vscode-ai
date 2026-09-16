import type { CollabUsage } from './types';

export const ONLINE_WINDOW_MS = 3 * 60 * 60 * 1000;   // 上报间隔上限 90 分钟 × 2

export interface MachineRow extends Partial<CollabUsage> {
  machineId: string;
  inGroup: boolean;
}

export function isOnline(receivedAt?: number, now = Date.now()): boolean {
  return !!receivedAt && now - receivedAt < ONLINE_WINDOW_MS;
}

export function fmtNum(n?: number): string {
  if (n == null) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function machineLabel(u?: Partial<CollabUsage>): string {
  return (u?.employeeId || u?.username || u?.machineId || '').trim();
}

// 群成员与用量上报合并成一张表：群成员即使没上报也要有一行（数据列显示 -）
export function mergeMachines(
  peers: Record<string, CollabUsage> | undefined,
  members: { machineId?: string }[] | undefined,
): MachineRow[] {
  const out = new Map<string, MachineRow>();
  for (const [id, u] of Object.entries(peers || {})) {
    const machineId = String(u?.machineId || id || '');
    if (!machineId) continue;
    out.set(machineId, { ...u, machineId, inGroup: false });
  }
  for (const m of members || []) {
    const machineId = String(m?.machineId || '');
    if (!machineId) continue;
    const prof = m as { username?: string; employeeId?: string; host?: string; port?: number };
    // 成员资料优先（工号/主机更权威），用量数字仍取上报那一份
    const identity: Partial<MachineRow> = {
      ...(prof.username ? { username: prof.username } : {}),
      ...(prof.employeeId ? { employeeId: prof.employeeId } : {}),
      ...(prof.host ? { host: prof.host } : {}),
      ...(prof.port ? { port: prof.port } : {}),
    };
    const cur = out.get(machineId);
    out.set(machineId, cur
      ? { ...cur, ...identity, inGroup: true }
      : { ...identity, machineId, inGroup: true });
  }
  return [...out.values()];
}
