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

export function sortPeers(peers: Record<string, CollabUsage>): CollabUsage[] {
  return Object.values(peers || {}).sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
}

export function usageCells(u: CollabUsage): string[] {
  if (!u || u.error) return ['-', '-', '-', '-', '-', '-'];
  return [fmtNum(u.sessions), fmtNum(u.days), fmtNum(u.messages), fmtNum(u.input), fmtNum(u.output), u.totalCost == null ? '-' : String(u.totalCost)];
}
