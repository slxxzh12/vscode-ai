import type { GitFilter } from './gitStat';

export interface CodeFileRow { rel: string; real: number; total: number; firstAuthor?: string; }
export interface CodeGroupRow { key: string; real: number; total: number; files: number; }
export interface CodeTotals { files: number; real: number; total: number; }
export interface CodeStatsResult {
  dir: string;
  files: CodeFileRow[];
  groups: CodeGroupRow[];
  totals: CodeTotals;
  truncated?: boolean;
}
export interface CodeStatsParams { dir: string; filter: GitFilter; }

export function sumCodeTotals(list: CodeTotals[]): CodeTotals {
  const total: CodeTotals = { files: 0, real: 0, total: 0 };
  for (const t of list) {
    total.files += t.files;
    total.real += t.real;
    total.total += t.total;
  }
  return total;
}

export function ratioText(real: number, total: number): string {
  if (!total) return '—';
  return `${((real / total) * 100).toFixed(1)}%`;
}

export async function fetchCodeStats(params: CodeStatsParams): Promise<CodeStatsResult> {
  const res = await fetch('/api/code/stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = (j.error || msg) + (j.message ? `：${j.message}` : '');
    } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<CodeStatsResult>;
}
