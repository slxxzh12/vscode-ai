import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { useToolFiles, type FileTool } from './files/useToolFiles';
import { toolFileTreeSource } from '../tree/toolFileTreeSource';
import { toolDocSource } from './doc/toolDocSource';
import type { TreeSource, TreeSourceNode } from '../tree/treeSource';
import type { DocSource } from './doc/docSource';

// 工具工作台：按 tool 共享同一份状态，供左侧面板（树）与主区（内容）共用。
export interface ToolWorkbench {
  tool: FileTool;
  files: ReturnType<typeof useToolFiles>;
  treeSource: TreeSource;
  docSource: DocSource;
  activeId: Ref<string>;
  activeFolder: Ref<string>;
  leafName: ComputedRef<string>;
  title: ComputedRef<string>;
  reload(): Promise<void>;
}

const cache = new Map<FileTool, ToolWorkbench>();

export function useToolWorkbench(tool: FileTool): ToolWorkbench {
  const hit = cache.get(tool);
  if (hit) return hit;

  const files = useToolFiles(tool);
  const activeId = ref('');
  const activeFolder = ref('');
  const treeSource = toolFileTreeSource(files, {
    onOpen: (node: TreeSourceNode) => { activeId.value = node.key; },
    onChanged: () => { void files.load(); },
  });
  const docSource = toolDocSource(tool);
  const leafName = computed(() => activeId.value.slice(activeId.value.lastIndexOf('/') + 1));
  const title = computed(() => leafName.value);

  const wb: ToolWorkbench = {
    tool,
    files,
    treeSource,
    docSource,
    activeId,
    activeFolder,
    leafName,
    title,
    reload: () => files.load(),
  };
  cache.set(tool, wb);
  return wb;
}
