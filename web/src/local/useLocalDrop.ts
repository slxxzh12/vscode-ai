import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';
import { partitionHandles } from './localHandles';

export interface LocalDropPayload {
  dirHandles: FileSystemDirectoryHandle[];
  fileHandles: FileSystemFileHandle[];
  files: File[];
}

type HandleLike = { kind: string; name: string } | null;

// window 级拖拽监听：只在拖入文件时介入，避免影响浏览器默认行为与应用内拖拽。
export function useLocalDrop(onDrop: (p: LocalDropPayload) => void): { dragging: Ref<boolean> } {
  const dragging = ref(false);
  let depth = 0;
  const hasFiles = (e: DragEvent): boolean =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  function onEnter(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    dragging.value = true;
  }
  function onOver(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
  function onLeave(e: DragEvent): void {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dragging.value = false;
  }
  async function onDropEvt(e: DragEvent): Promise<void> {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dragging.value = false;
    const dt = e.dataTransfer;
    if (!dt) return;
    const items = Array.from(dt.items || []).filter((i) => i.kind === 'file');
    // 必须同步快照：drop 事件结束后 DataTransfer 失效
    const pending = items.map((i) => {
      const fn = (i as unknown as { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle;
      return typeof fn === 'function' ? Promise.resolve(fn.call(i)) : Promise.resolve(null);
    });
    const handles = (await Promise.all(pending)) as HandleLike[];
    const { dirs, files: fileHandles } = partitionHandles(handles);
    onDrop({ dirHandles: dirs, fileHandles, files: Array.from(dt.files || []) });
  }

  onMounted(() => {
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropEvt);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('dragenter', onEnter);
    window.removeEventListener('dragover', onOver);
    window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('drop', onDropEvt);
  });

  return { dragging };
}
