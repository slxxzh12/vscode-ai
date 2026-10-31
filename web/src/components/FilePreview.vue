<script setup lang="ts">
import { computed } from 'vue';
import DocViewer from './DocViewer.vue';
import { useProjects } from '../useProjects';
import type { DocSource, DocReadResult } from '../tools/doc/docSource';

// 项目文件页签：给通用 DocViewer 注入「项目来源」。
// 项目专有能力（定位资源管理器、运行脚本、外部文件选择、diff 选文件、详情/哈希、markdown 图片解析）都在这里提供。
const props = defineProps<{ projectId: string; path: string; name: string; detailToken?: number; detailPath?: string; locateToken?: number; locatePath?: string; locateLine?: number; locateQuery?: string; locateCaseSensitive?: boolean }>();
const emit = defineEmits<{ (e: 'open-link', rel: string): void }>();
function onOpenLink(rel: string) { emit('open-link', rel); }
const api = useProjects();

const source = computed<DocSource>(() => ({
  kind: 'project',
  async read(p): Promise<DocReadResult> {
    const f = await api.text(props.projectId, p);
    return { name: f.name || props.name, content: f.content, size: f.size, mtime: f.mtime, abs: f.abs, binary: f.binary };
  },
  write: (p, c) => api.write(props.projectId, p, c).then(() => undefined),
  rawUrl: (p) => api.rawUrl(props.projectId, p),
  list: (dir) => api.tree(props.projectId, dir),
  meta: (p) => api.fileMeta(props.projectId, p),
  hash: (p) => api.fileHash(props.projectId, p),
  reveal: (p) => api.reveal(props.projectId, p).then(() => undefined),
  run: (p) => api.runScript(props.projectId, p).then(() => undefined),
  pickExternal: () => api.pickTextFile() as Promise<DocReadResult | { cancelled: true } | { error: string; message?: string | null }>,
  markdownImageBase: { projectId: props.projectId },
}));
</script>

<template>
  <DocViewer :source="source" :path="path" :name="name" :detail-token="detailToken" :detail-path="detailPath"
    :locate-token="locateToken" :locate-path="locatePath" :locate-line="locateLine"
    :locate-query="locateQuery" :locate-case-sensitive="locateCaseSensitive"
    intercept-links @open-link="onOpenLink" />
</template>
