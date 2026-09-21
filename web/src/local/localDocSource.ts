import type { DocSource, DocReadResult, MarkdownAssetRef } from '../tools/doc/docSource';
import { t } from '../i18n';
import { useLocalSources } from './useLocalSources';
import { kindOf, isTooLarge, isProbablyBinary, splitRel, MAX_TEXT_BYTES } from './localHandles';
import { trackBlob, releaseBlob, releaseBlobs } from './localBlobs';

const MAX_LABEL = `${Math.round(MAX_TEXT_BYTES / 1024 / 1024)} MB`;
const ROOT_READ_SCOPE = 'local-root';
const ROOT_MD_SCOPE = 'local-root-md';

type AnyHandle = { queryPermission?(o: { mode: string }): Promise<string>; requestPermission?(o: { mode: string }): Promise<string> };

async function ensurePermission(handle: unknown, mode: 'read' | 'readwrite'): Promise<void> {
  const h = handle as AnyHandle;
  try {
    if (typeof h.queryPermission === 'function' && (await h.queryPermission({ mode })) === 'granted') return;
  } catch { /* fall through to request */ }
  if (typeof h.requestPermission !== 'function') throw new Error(t('local.write_unsupported'));
  let r: string | undefined;
  try { r = await h.requestPermission({ mode }); } catch { throw new Error(t('local.permission_needed')); }
  if (r !== 'granted') throw new Error(t('local.permission_needed'));
}

async function traverse(dir: FileSystemDirectoryHandle, rel: string): Promise<{ parent: FileSystemDirectoryHandle; leaf: string }> {
  const segs = splitRel(rel);
  if (!segs || !segs.length) throw new Error(t('local.read_failed', { msg: rel || '-' }));
  let cur = dir;
  for (let i = 0; i < segs.length - 1; i++) cur = await cur.getDirectoryHandle(segs[i]);
  return { parent: cur, leaf: segs[segs.length - 1] };
}

async function readText(file: File): Promise<{ content: string; binary: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isProbablyBinary(bytes)) return { content: '', binary: true };
  return { content: new TextDecoder('utf-8').decode(bytes), binary: false };
}

// 每个作用域只保留「当前文件」的 blob URL（图片/PDF 用）
const currentBlob = new Map<string, { path: string; url: string }>();

function recycleCurrent(scope: string): void {
  const cur = currentBlob.get(scope);
  if (cur) { releaseBlob(scope, cur.url); currentBlob.delete(scope); }
}

async function readViaFile(file: File, path: string, scope: string): Promise<DocReadResult> {
  const kind = kindOf(file.name);
  if (kind === 'image' || kind === 'pdf') {
    recycleCurrent(scope);
    const url = trackBlob(scope, URL.createObjectURL(file));
    currentBlob.set(scope, { path, url });
    return { name: file.name, content: '', size: file.size, binary: true };
  }
  if (isTooLarge(file.size)) throw new Error(t('local.too_large', { max: MAX_LABEL }));
  const { content, binary } = await readText(file);
  return { name: file.name, content, size: file.size, binary };
}

async function writeToHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  const w = await handle.createWritable();
  try { await w.write(content); } finally { await w.close(); }
}

let rootSource: DocSource | null = null;

// 本地根来源：单例；路径为根目录下的相对路径。
export function localRootDocSource(): DocSource {
  if (rootSource) return rootSource;
  const { root, activePath } = useLocalSources();
  rootSource = {
    kind: 'local',
    async read(path) {
      const r = root.value;
      const rel = path || activePath.value;
      if (!r?.handle) throw new Error(t('local.read_failed', { msg: rel || '-' }));
      try {
        const { parent, leaf } = await traverse(r.handle, rel);
        const file = await (await parent.getFileHandle(leaf)).getFile();
        return await readViaFile(file, rel, ROOT_READ_SCOPE);
      } catch (e: any) {
        const msg = String(e?.message || rel);
        if (/授权|permission|exceeds|超过/.test(msg)) throw e;
        throw new Error(t('local.read_failed', { msg }));
      }
    },
    async write(path, content) {
      const r = root.value;
      const rel = path || activePath.value;
      if (!r?.handle) throw new Error(t('local.permission_needed'));
      const { parent, leaf } = await traverse(r.handle, rel);
      const fh = await parent.getFileHandle(leaf);
      await ensurePermission(fh, 'readwrite');
      await writeToHandle(fh, content);
    },
    rawUrl(path) {
      const cur = currentBlob.get(ROOT_READ_SCOPE);
      const rel = path || activePath.value;
      return cur && cur.path === rel ? cur.url : '';
    },
    async resolveMarkdownAssets(refs: MarkdownAssetRef[]): Promise<Map<string, string>> {
      const r = root.value;
      const map = new Map<string, string>();
      if (!r?.handle) return map;
      for (const ref of refs) {
        try {
          const { parent, leaf } = await traverse(r.handle, ref.rel);
          const file = await (await parent.getFileHandle(leaf)).getFile();
          map.set(ref.rel, trackBlob(ROOT_MD_SCOPE, URL.createObjectURL(file)));
        } catch { /* 缺失/越界的资源直接跳过 */ }
      }
      return map;
    },
    releaseMarkdownAssets() { releaseBlobs(ROOT_MD_SCOPE); },
  };
  return rootSource;
}

const fileSources = new Map<string, DocSource>();

// 单文件来源（拖入的单个文件）：按 key 缓存，忽略传入 path。
export function localFileDocSource(key: string): DocSource {
  const hit = fileSources.get(key);
  if (hit) return hit;
  const { files } = useLocalSources();
  const src: DocSource = {
    kind: 'local',
    async read(path) {
      const entry = files.value.get(key);
      if (!entry) throw new Error(t('local.read_failed', { msg: path }));
      const file = entry.handle ? await entry.handle.getFile() : entry.file;
      if (!file) throw new Error(t('local.read_failed', { msg: path }));
      return await readViaFile(file, path || entry.name, key);
    },
    async write(_path, content) {
      const entry = files.value.get(key);
      if (!entry?.handle) throw new Error(t('local.write_unsupported'));
      await ensurePermission(entry.handle, 'readwrite');
      await writeToHandle(entry.handle, content);
    },
    rawUrl(path) {
      const entry = files.value.get(key);
      const rel = path || entry?.name || '';
      const cur = currentBlob.get(key);
      return cur && cur.path === rel ? cur.url : '';
    },
  };
  fileSources.set(key, src);
  return src;
}
