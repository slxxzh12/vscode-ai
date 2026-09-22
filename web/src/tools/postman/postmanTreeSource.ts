import { copyText } from '../../clipboard';
import type { TreeSource, TreeSourceNode, SearchEvent, SearchNameHit, SearchLine, SearchHit } from '../../tree/treeSource';
import type { PostmanRecord } from './usePostmanHistory';

export interface PostmanTreeDeps {
  history: () => PostmanRecord[];
  folders: () => string[];
  statusOf: (id: string) => 'pass' | 'fail' | undefined;
  recordById: (id: string) => PostmanRecord | null;
  openRecord: (r: PostmanRecord) => void;
  createFolder: (parent: string, name: string) => Promise<unknown>;
  renameFolder: (path: string, name: string) => Promise<unknown>;
  renameRecord: (id: string, title: string) => Promise<unknown>;
  removeFolder: (path: string) => Promise<unknown>;
  removeRecord: (id: string) => Promise<unknown>;
  moveRecord: (id: string, folder: string) => Promise<unknown>;
  runRecord: (r: PostmanRecord) => void;
  runFolder: (path: string) => void;
}

function labelOf(r: PostmanRecord): string {
  return (r.title && r.title.trim()) || r.command;
}

function splitTerms(query: string, caseSensitive: boolean): string[] {
  const out: string[] = [];
  for (const raw of String(query).trim().split(/\s+/)) {
    if (raw.length < 2) continue;
    const t = caseSensitive ? raw : raw.toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function postmanTreeSource(deps: PostmanTreeDeps): TreeSource {
  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  };
  const dirsOf = (dirKey: string) => {
    const prefix = dirKey ? `${dirKey}/` : '';
    return deps.folders()
      .filter((f) => (dirKey ? f.startsWith(prefix) : true))
      .filter((f) => (dirKey ? f.slice(prefix.length) : f).split('/').length === 1)
      .map((f) => ({ key: f, name: f.slice(f.lastIndexOf('/') + 1), kind: 'dir' as const }));
  };
  const leavesOf = (dirKey: string) => deps.history()
    .filter((r) => (r.folder || '') === dirKey)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map((r) => ({ key: r.id, name: labelOf(r), kind: 'item' as const, time: fmt(r.updatedAt), status: deps.statusOf(r.id) }));

  return {
    async loadChildren(dirKey: string): Promise<TreeSourceNode[]> {
      return [...dirsOf(dirKey), ...leavesOf(dirKey)];
    },
    open(node) { const r = deps.recordById(node.key); if (r) deps.openRecord(r); },
    async createFolder(dirKey, name) { await deps.createFolder(dirKey, name); },
    async rename(node, name) {
      if (node.kind === 'dir') await deps.renameFolder(node.key, name);
      else await deps.renameRecord(node.key, name);
    },
    async remove(node) {
      if (node.kind === 'dir') await deps.removeFolder(node.key);
      else await deps.removeRecord(node.key);
    },
    async move(node, dirKey) { await deps.moveRecord(node.key, dirKey); },
    run(node) { const r = deps.recordById(node.key); if (r) deps.runRecord(r); },
    runFolder(dirKey) { deps.runFolder(dirKey); },
    copyName(node) { void copyText(node.name); },
    copyPath(node) { void copyText(node.key); },
    async *search(query, o): AsyncGenerator<SearchEvent> {
      void o.all;
      const terms = splitTerms(query, o.caseSensitive);
      if (!terms.length || (!o.name && !o.content)) { yield { type: 'done', scanned: 0 }; return; }
      const hayOf = (s: string) => (o.caseSensitive ? s : s.toLowerCase());
      const nameHits: SearchNameHit[] = [];
      let scanned = 0;
      for (const r of deps.history()) {
        scanned++;
        const label = labelOf(r);
        if (o.name && terms.some((t) => hayOf(label).includes(t))) nameHits.push({ path: r.id, name: label });
        if (o.content) {
          const lines = JSON.stringify(r, null, 2).split('\n');
          const hitLines: SearchLine[] = [];
          for (let i = 0; i < lines.length; i++) if (terms.some((t) => hayOf(lines[i]).includes(t))) hitLines.push({ line: i + 1, text: lines[i] });
          if (hitLines.length) yield { type: 'content', path: r.id, name: label, lines: hitLines };
        }
      }
      if (nameHits.length) yield { type: 'name', hits: nameHits };
      yield { type: 'done', scanned };
    },
    openHit(hit: SearchHit) { const r = deps.recordById(hit.path); if (r) deps.openRecord(r); },
  };
}
