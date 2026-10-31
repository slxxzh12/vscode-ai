import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';
import { disposeMarkdown, enhanceMarkdown } from './index';

export function useMarkdownEnhance(html: Ref<string>, el: Ref<HTMLElement | null>): void {
  watch(
    html,
    async () => {
      await nextTick();
      if (!el.value) return;
      try {
        await enhanceMarkdown(el.value);
      } catch {
        /* 增强失败不影响原始 Markdown 展示 */
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (el.value) disposeMarkdown(el.value);
  });
}
