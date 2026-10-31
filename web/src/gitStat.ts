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
  hugeCommits?: number;
  truncated?: boolean;
}
export interface GitFilter { codeOnly: boolean; exts?: string[]; excludeDirs?: string[]; excludeTestFiles: boolean; hugeCommitLimit?: number; }
export interface GitChangesParams { repo: string; since: string; until: string; filter?: GitFilter; }
export interface GitAuthorRow {
  author: string; email: string; commits: number; files: number;
  added: number; modified: number; deleted: number; renamed: number;
  linesAdded: number; linesDeleted: number;
}

const LABELS: Record<GitStatus, string> = { added: 'git.status.added', modified: 'git.status.modified', deleted: 'git.status.deleted', renamed: 'git.status.renamed' };

export function statusLabel(s: GitStatus): string { return LABELS[s] ? t(LABELS[s]) : s; }
export function statusClass(s: GitStatus): string { return `st-${s}`; }

export function sumStats(list: GitStats[]): GitStats {
  const total: GitStats = { commits: 0, files: 0, added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const s of list) {
    total.commits += s.commits;
    total.files += s.files;
    total.added += s.added;
    total.modified += s.modified;
    total.deleted += s.deleted;
    total.renamed += s.renamed;
  }
  return total;
}

interface AuthorAcc {
  author: string; email: string; commits: number;
  added: number; modified: number; deleted: number; renamed: number;
  linesAdded: number; linesDeleted: number; files: Set<string>;
}

// 按修改人（邮箱优先，其次姓名）叠加：提交数、各状态文件数、增删行数、去重文件数
export function aggregateByAuthor(commits: GitCommit[]): GitAuthorRow[] {
  const map = new Map<string, AuthorAcc>();
  for (const c of commits) {
    const key = c.email || c.author || '';
    let row = map.get(key);
    if (!row) {
      row = { author: c.author, email: c.email, commits: 0, added: 0, modified: 0, deleted: 0, renamed: 0, linesAdded: 0, linesDeleted: 0, files: new Set() };
      map.set(key, row);
    }
    row.commits += 1;
    for (const f of c.files) {
      row.files.add(f.path);
      if (f.status === 'added') row.added += 1;
      else if (f.status === 'modified') row.modified += 1;
      else if (f.status === 'deleted') row.deleted += 1;
      else if (f.status === 'renamed') row.renamed += 1;
      row.linesAdded += f.added || 0;
      row.linesDeleted += f.deleted || 0;
    }
  }
  return [...map.values()]
    .map((r) => ({
      author: r.author, email: r.email, commits: r.commits, files: r.files.size,
      added: r.added, modified: r.modified, deleted: r.deleted, renamed: r.renamed,
      linesAdded: r.linesAdded, linesDeleted: r.linesDeleted,
    }))
    .sort((a, b) => b.commits - a.commits || b.linesAdded - a.linesAdded || a.author.localeCompare(b.author));
}

function pad(n: number): string { return String(n).padStart(2, '0'); }
function fmt(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function defaultRange(today: Date = new Date()): { since: string; until: string } {
  const until = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const since = new Date(today.getFullYear(), today.getMonth(), 1);
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
