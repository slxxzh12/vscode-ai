import type { DocSource } from './tools/doc/docSource';

export function resolveRelPath(fileDir: string, rel: string): string | null {
  const s = String(rel || '').trim();
  if (!s || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|\\)/i.test(s)) return null;
  const segs = fileDir.split('/').filter(Boolean);
  for (const part of s.replace(/[?#].*$/, '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!segs.length) return null;
      segs.pop();
    } else segs.push(part);
  }
  return segs.join('/') || null;
}

export function makeReadAsset(source: DocSource, file: string): (rel: string) => Promise<string> {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  return async (rel: string) => {
    const target = resolveRelPath(dir, rel);
    if (!target) throw new Error('only relative paths are allowed');
    const r = await source.read(target);
    return r.content;
  };
}
