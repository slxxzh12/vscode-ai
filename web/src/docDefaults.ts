import type { DocSlot } from './docUpdate';

export interface DocDefaultsResult {
  root?: string;
  paths: Record<DocSlot, string>;
  detected?: Partial<Record<DocSlot, string>>;
  error?: string;
}

export function joinRoot(root: string, rel: string): string {
  const base = String(root || '').replace(/[\\/]+$/, '');
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base}${sep}${rel.replace(/[\\/]+/g, sep)}`;
}

export function defaultDocPaths(root: string): Record<DocSlot, string> {
  return {
    code: String(root || '').replace(/[\\/]+$/, ''),
    knowledge: joinRoot(root, 'docs/knowledge'),
    solution: joinRoot(root, 'docs/version'),
    workflow: joinRoot(root, 'docs/learn'),
    experience: joinRoot(root, 'docs/memory'),
    skills: joinRoot(root, 'skills'),
    rules: joinRoot(root, 'docs/rules'),
  };
}

export async function detectDocDefaults(root: string): Promise<DocDefaultsResult> {
  const res = await fetch(`/api/pipeline/defaults?root=${encodeURIComponent(root)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}
