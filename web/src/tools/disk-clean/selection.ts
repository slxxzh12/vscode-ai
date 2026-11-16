import type { DiskCategory } from './types';

export function defaultSelection(categories: DiskCategory[]): Set<string> {
  return new Set(categories.filter((c) => c.defaultChecked).map((c) => c.id));
}

export function selectionTotals(categories: DiskCategory[], selected: Set<string>) {
  const picked = categories.filter((c) => selected.has(c.id));
  return { count: picked.length, bytes: picked.reduce((s, c) => s + (c.bytes || 0), 0) };
}

export function missingRiskyConfirmations(categories: DiskCategory[], selected: Set<string>, confirmed: Set<string>): string[] {
  return categories
    .filter((c) => selected.has(c.id) && c.risk === 'risky' && !confirmed.has(c.id))
    .map((c) => c.id);
}

export function formatBytes(n: number): string {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = v / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(1)} ${units[i]}`;
}
