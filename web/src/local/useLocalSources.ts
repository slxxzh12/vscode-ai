import { ref, type Ref } from 'vue';
import { releaseBlobs } from './localBlobs';
import { MAX_DROP_FILES } from './localHandles';

export interface LocalRoot { name: string; handle: FileSystemDirectoryHandle | null }
export interface LocalFile { key: string; name: string; handle: FileSystemFileHandle | null; file: File | null }
export interface LocalFileInput { name: string; handle: FileSystemFileHandle | null; file: File | null }

export const ROOT_SCOPE = 'local-root';
export { MAX_DROP_FILES };

// 模块级单例：同一会话内跨组件共享；刷新页面自然清空。
const root = ref<LocalRoot | null>(null);
const files = ref<Map<string, LocalFile>>(new Map());
const activePath = ref('');
let seq = 0;

export function useLocalSources(): {
  root: Ref<LocalRoot | null>;
  files: Ref<Map<string, LocalFile>>;
  activePath: Ref<string>;
  mountFolder: (handle: FileSystemDirectoryHandle) => void;
  addFiles: (entries: LocalFileInput[]) => { keys: string[]; truncated: number };
  unmountRoot: () => void;
  removeFile: (key: string) => void;
  clearAll: () => void;
} {
  function mountFolder(handle: FileSystemDirectoryHandle): void {
    releaseBlobs(ROOT_SCOPE);
    root.value = { name: handle.name, handle };
    activePath.value = '';
  }

  function addFiles(entries: LocalFileInput[]): { keys: string[]; truncated: number } {
    const list = entries.slice(0, MAX_DROP_FILES);
    const next = new Map(files.value);
    const keys: string[] = [];
    for (const e of list) {
      const key = String(++seq);
      next.set(key, { key, name: e.name, handle: e.handle, file: e.file });
      keys.push(key);
    }
    files.value = next;
    return { keys, truncated: entries.length - list.length };
  }

  function unmountRoot(): void {
    releaseBlobs(ROOT_SCOPE);
    root.value = null;
    activePath.value = '';
  }

  function removeFile(key: string): void {
    releaseBlobs(key);
    const next = new Map(files.value);
    next.delete(key);
    files.value = next;
  }

  function clearAll(): void {
    releaseBlobs(ROOT_SCOPE);
    for (const k of [...files.value.keys()]) releaseBlobs(k);
    root.value = null;
    files.value = new Map();
    activePath.value = '';
  }

  return { root, files, activePath, mountFolder, addFiles, unmountRoot, removeFile, clearAll };
}
