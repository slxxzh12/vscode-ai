import type { CollabUsage } from './types';

export const ONLINE_WINDOW_MS = 3 * 60 * 60 * 1000;   // 上报间隔上限 90 分钟 × 2

export function isOnline(receivedAt?: number, now = Date.now()): boolean {
  return !!receivedAt && now - receivedAt < ONLINE_WINDOW_MS;
}

export function fmtNum(n?: number): string {
  if (n == null) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function machineLabel(u: CollabUsage): string {
  return (u?.employeeId || u?.username || u?.machineId || '').trim();
}

export type SortKey = 'machine' | 'sessions' | 'days' | 'messages' | 'input' | 'output' | 'cost' | 'receivedAt';
export type SortDir = 'asc' | 'desc';

const NUM_KEYS: SortKey[] = ['sessions', 'days', 'messages', 'input', 'output', 'cost', 'receivedAt'];

function sortValue(u: CollabUsage, key: SortKey): number | string | null {
  if (key === 'machine') return machineLabel(u) || null;
  const raw = key === 'cost' ? u?.totalCost : (u as any)?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

// 表头排序：缺失值恒排最后；同值用 machine 标签兜底，保证顺序稳定可预期
export function sortRows(rows: CollabUsage[], key: SortKey, dir: SortDir): CollabUsage[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...(rows || [])].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return machineLabel(a).localeCompare(machineLabel(b));
    if (va === null) return 1;
    if (vb === null) return -1;
    let cmp: number;
    if (typeof va === 'string' || typeof vb === 'string') cmp = String(va).localeCompare(String(vb));
    else cmp = va < vb ? -1 : va > vb ? 1 : 0;
    if (cmp === 0) return machineLabel(a).localeCompare(machineLabel(b));
    return cmp * sign;
  });
}

// 点表头：同列切换方向；换列时数值列先降序（大在前），machine 列先升序
export function nextSort(current: { key: SortKey; dir: SortDir }, clicked: SortKey): { key: SortKey; dir: SortDir } {
  if (current.key === clicked) return { key: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key: clicked, dir: NUM_KEYS.includes(clicked) ? 'desc' : 'asc' };
}

// 默认视图顺序：按 messages 降序（消息多的在前）
export function sortPeers(peers: Record<string, CollabUsage>): CollabUsage[] {
  return sortRows(Object.values(peers || {}), 'messages', 'desc');
}

export function usageCells(u: CollabUsage): string[] {
  if (!u || u.error) return ['-', '-', '-', '-', '-', '-'];
  return [fmtNum(u.sessions), fmtNum(u.days), fmtNum(u.messages), fmtNum(u.input), fmtNum(u.output), u.totalCost == null ? '-' : String(u.totalCost)];
}
