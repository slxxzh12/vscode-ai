import { t } from './i18n';

export type GitStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitFileChange { status: GitStatus; path: string; oldPath?: string; added?: number; deleted?: number; }
export interface GitCommit {
  hash: string; short: string; author: string; email: string; date: string; subject: string; files: GitFileChange[];
}
export interface GitSummaryRow { path: string; status: GitStatus; oldPath?: string; touches: number; lastDate: string; lastAuthor: string; lastEmail: string; added: number; deleted: number; }
export interface GitStats { commits: number; files: number; added: number; modified: number; deleted: number; renamed: number; }
export interface GitChangesResult {
  repo: { path: string; branch: string | null; cloned?: boolean };
  range: { since: string; until: string };
  stats: GitStats;
  summary: GitSummaryRow[];
  commits: GitCommit[];
  truncated?: boolean;
}
export interface GitChangesParams { repo: string; since: string; until: string; }

const LABELS: Record<GitStatus, string> = { added: 'git.status.added', modified: 'git.status.modified', deleted: 'git.status.deleted', renamed: 'git.status.renamed' };

export function statusLabel(s: GitStatus): string { return LABELS[s] ? t(LABELS[s]) : s; }
export function statusClass(s: GitStatus): string { return `st-${s}`; }

function pad(n: number): string { return String(n).padStart(2, '0'); }
function fmt(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function defaultRange(today: Date = new Date()): { since: string; until: string } {
  const until = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const since = new Date(until);
  since.setDate(since.getDate() - 6);
  return { since: fmt(since), until: fmt(until) };
}

export async function fetchGitChanges(params: GitChangesParams): Promise<GitChangesResult> {
  const res = await fetch('/api/git/changes', {
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
  return res.json() as Promise<GitChangesResult>;
}
