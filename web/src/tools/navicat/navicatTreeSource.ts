import { copyText } from '../../clipboard';
import type { TreeSource, TreeSourceNode, SearchEvent, SearchNameHit, SearchLine, SearchHit } from '../../tree/treeSource';
import type { NavicatProfile } from './useNavicat';

export interface NavicatTreeDeps {
  profiles: () => NavicatProfile[];
  profileById: (id: string) => NavicatProfile | null;
  databases: (id: string) => Promise<string[]>;
  tables: (id: string, db: string) => Promise<string[]>;
  openConnection: (id: string) => void;
  openDatabase: (id: string, db: string) => void;
  pickTable: (id: string, db: string, table: string) => void;
  renameConnection: (id: string, name: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
}

const cKey = (id: string) => `c:${id}`;
const dKey = (id: string, db: string) => `d:${id}\u0000${db}`;
const tKey = (id: string, db: string, table: string) => `t:${id}\u0000${db}\u0000${table}`;

function parse(key: string): { kind: string; id: string; db: string; table: string } {
  const parts = key.split('\u0000');
  const [kind, id] = parts[0].split(':');
  return { kind, id, db: parts[1] || '', table: parts[2] || '' };
}

function splitTerms(query: string, caseSensitive: boolean, split = true): string[] {
  const out: string[] = [];
  const src = String(query).trim();
  for (const raw of (split ? src.split(/\s+/) : [src])) {
    if (raw.length < 2) continue;
    const t = caseSensitive ? raw : raw.toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function navicatTreeSource(deps: NavicatTreeDeps): TreeSource {
  return {
    async loadChildren(dirKey: string): Promise<TreeSourceNode[]> {
      if (!dirKey) return deps.profiles().map((p) => ({ key: cKey(String(p.id)), name: p.name, kind: 'dir' as const }));
      const pl = parse(dirKey);
      const p = deps.profileById(pl.id);
      if (!p) return [];
      if (pl.kind === 'c') {
        if (p.type === 'sqlite') {
          const list = await deps.tables(pl.id, p.database || '');
          return list.map((t) => ({ key: tKey(pl.id, p.database || '', t), name: t, kind: 'item' as const }));
        }
        const list = await deps.databases(pl.id);
        if (p.type === 'redis') return list.map((db) => ({ key: dKey(pl.id, db), name: db, kind: 'item' as const }));
        return list.map((db) => ({ key: dKey(pl.id, db), name: db, kind: 'dir' as const }));
      }
      if (pl.kind === 'd') {
        const list = await deps.tables(pl.id, pl.db);
        return list.map((t) => ({ key: tKey(pl.id, pl.db, t), name: t, kind: 'item' as const }));
      }
      return [];
    },
    open(node) {
      const pl = parse(node.key);
      if (pl.kind === 't') deps.pickTable(pl.id, pl.db, pl.table);
      else if (pl.kind === 'd') deps.openDatabase(pl.id, pl.db);
    },
    async rename(node, name) { const pl = parse(node.key); if (pl.kind === 'c') await deps.renameConnection(pl.id, name); },
    async remove(node) { const pl = parse(node.key); if (pl.kind === 'c') await deps.removeConnection(pl.id); },
    copyName(node) { void copyText(node.name); },
    copyPath(node) { void copyText(node.key); },
    async *search(query, o): AsyncGenerator<SearchEvent> {
      void o.all;
      const terms = splitTerms(query, o.caseSensitive, o.split !== false);
      if (!terms.length || (!o.name && !o.content)) { yield { type: 'done', scanned: 0 }; return; }
      const hayOf = (s: string) => (o.caseSensitive ? s : s.toLowerCase());
      const nameHits: SearchNameHit[] = [];
      let scanned = 0;
      for (const p of deps.profiles()) {
        scanned++;
        const key = cKey(String(p.id));
        if (o.name && terms.some((t) => hayOf(p.name).includes(t))) nameHits.push({ path: key, name: p.name });
        if (o.content) {
          const lines = JSON.stringify(p, null, 2).split('\n');
          const hitLines: SearchLine[] = [];
          for (let i = 0; i < lines.length; i++) if (terms.some((t) => hayOf(lines[i]).includes(t))) hitLines.push({ line: i + 1, text: lines[i] });
          if (hitLines.length) yield { type: 'content', path: key, name: p.name, lines: hitLines };
        }
      }
      if (nameHits.length) yield { type: 'name', hits: nameHits };
      yield { type: 'done', scanned };
    },
    openHit(hit: SearchHit) { const pl = parse(hit.path); if (pl.kind === 'c') deps.openConnection(pl.id); },
  };
}
