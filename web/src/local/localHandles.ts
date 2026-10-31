// 拖入本地文件的纯函数工具（无副作用，便于单测）。

const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);

export const MAX_TEXT_BYTES = 10 * 1024 * 1024;
export const MAX_DROP_FILES = 20;

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function kindOf(name: string): 'image' | 'pdf' | 'text' {
  const e = extOf(name);
  if (IMG.has(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  return 'text';
}

export function isTooLarge(size: number): boolean {
  return size > MAX_TEXT_BYTES;
}

// POSIX 风格相对路径 → 段数组；越界（.. 穿出根）返回 null
export function splitRel(path: string): string[] | null {
  const segs: string[] = [];
  for (const part of String(path ?? '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!segs.length) return null;
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  return segs;
}

export function joinRel(dir: string, name: string): string {
  const segs = splitRel(`${dir}/${name}`);
  return segs ? segs.join('/') : '';
}

export function supportsHandles(): boolean {
  return typeof DataTransferItem !== 'undefined'
    && 'getAsFileSystemHandle' in DataTransferItem.prototype;
}

export function isProbablyBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 64 * 1024);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function partitionHandles(handles: Array<{ kind: string; name: string } | null>): {
  dirs: FileSystemDirectoryHandle[];
  files: FileSystemFileHandle[];
} {
  const dirs: FileSystemDirectoryHandle[] = [];
  const files: FileSystemFileHandle[] = [];
  for (const h of handles) {
    if (!h) continue;
    if (h.kind === 'directory') dirs.push(h as unknown as FileSystemDirectoryHandle);
    else files.push(h as unknown as FileSystemFileHandle);
  }
  return { dirs, files };
}
