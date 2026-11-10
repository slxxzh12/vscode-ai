<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import './styles/index.css';
import { useMarkdownViewer, type MarkdownViewerOptions } from './useMarkdownViewer';
import { createPptController } from './ppt';
import { resolveMessages } from '../core/i18n';
import type { PptPresenter } from '../core/markdown-ppt.js';

const props = withDefaults(defineProps<MarkdownViewerOptions>(), {
  content: '',
  html: '',
  theme: 'auto',
  locale: 'zh-CN',
  flowchartEditable: false,
  ppt: false,
});

const emit = defineEmits<{ ready: []; error: [unknown]; linkClick: [string] }>();

const body = ref<HTMLElement | null>(null);
const theme = computed(() => props.theme || 'auto');

useMarkdownViewer(body, () => ({
  content: props.content,
  html: props.html,
  theme: props.theme,
  locale: props.locale,
  messages: props.messages,
  sanitize: props.sanitize,
  assetSrc: props.assetSrc,
  extraStyleBlocks: props.extraStyleBlocks,
  flowchartEditable: props.flowchartEditable,
  ppt: props.ppt,
  readAsset: props.readAsset,
}));

let ppt: PptPresenter | null = null;

onMounted(() => {
  if (!props.ppt || !props.content) return;
  const messages = resolveMessages(props.locale || 'zh-CN', props.messages);
  ppt = createPptController({
    content: props.content,
    title: 'Markdown',
    locale: props.locale || 'zh-CN',
    messages,
    theme: theme.value === 'light' ? 'light' : 'dark',
    readAsset: props.readAsset,
    onError: (e) => emit('error', e),
  });
});

onBeforeUnmount(() => {
  ppt?.destroy();
  ppt = null;
});

function onClick(event: MouseEvent) {
  const target = (event.target as HTMLElement | null)?.closest('a[data-md-link]');
  if (!target) return;
  const rel = target.getAttribute('data-md-link');
  if (rel) emit('linkClick', rel);
}
</script>

<template>
  <div class="mdv" :data-mdv-theme="theme" @click="onClick">
    <slot name="toolbar" />
    <div ref="body" class="mdv-body md-body" />
    <slot name="empty" />
  </div>
</template>
