import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import { enhanceMarkdown as enhanceShared, type MermaidLike } from '../core/markdown-client.js';
import { loadEcharts } from '../core/charts-loader';
import { renderMarkdown, type RenderOptions } from '../core/render';
import { resolveMessages, translate, type MarkdownLocale, type MarkdownMessages } from '../core/i18n';
import { createElementTableRenderer, extractTable } from './table-renderer';

export type MarkdownTheme = 'dark' | 'light' | 'auto';

export interface MarkdownViewerOptions extends Omit<RenderOptions, 'html'> {
  content?: string;
  html?: string;
  theme?: MarkdownTheme;
  locale?: MarkdownLocale;
  messages?: Partial<MarkdownMessages>;
  flowchartEditable?: boolean;
  readAsset?: (rel: string) => Promise<string>;
}

type Item = { host: HTMLElement; dispose(): void };

function resolvedTheme(theme: MarkdownTheme): 'dark' | 'light' {
  if (theme === 'dark' || theme === 'light') return theme;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useMarkdownViewer(
  el: Ref<HTMLElement | null>,
  options: () => MarkdownViewerOptions,
): { enhance: () => Promise<void>; dispose: () => void } {
  let items: Item[] = [];
  let disposed = false;

  const dispose = () => {
    for (const item of items) {
      try {
        item.dispose();
      } catch {
        /* ignore */
      }
    }
    items = [];
  };

  const enhance = async () => {
    if (disposed || !el.value) return;
    dispose();
    const opts = options();
    const locale = opts.locale || 'zh-CN';
    const messages = resolveMessages(locale, opts.messages);
    const theme = resolvedTheme(opts.theme || 'auto');
    const renderer = createElementTableRenderer(() => locale, () => messages);

    const result = await enhanceShared(el.value, {
      loadEcharts,
      loadFlowX6: () => import('../core/markdown-flowchart-x6.js'),
      loadMermaid: async () => (await import('mermaid')).default as unknown as MermaidLike,
      theme: theme === 'light' ? 'default' : 'dark',
      dark: theme === 'dark',
      errorText: (msg) => translate(messages, 'markdown.mermaid_error', { msg }),
      dataErrorText: (msg) => translate(messages, 'markdown.data_error', { msg }),
      readAsset: opts.readAsset,
      enhanceTables: (root) => {
        const out: Item[] = [];
        for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table'))) {
          if (table.closest('.md-el-table, .el-table')) continue;
          if (table.parentElement?.closest('table')) continue;
          const data = extractTable(table);
          if (!data) continue;
          const host = document.createElement('div');
          host.className = 'md-el-table';
          table.replaceWith(host);
          out.push({ host, ...renderer(host, data) });
        }
        return out;
      },
    });
    items = result as Item[];
  };

  const render = async () => {
    await nextTick();
    const opts = options();
    if (!el.value) return;
    const renderOptions: RenderOptions = {
      html: true,
      sanitize: opts.sanitize,
      assetSrc: opts.assetSrc,
      extraStyleBlocks: opts.extraStyleBlocks,
    };
    el.value.innerHTML = opts.html || renderMarkdown(opts.content || '', renderOptions);
    await enhance();
  };

  onMounted(render);
  watch(() => options(), render, { deep: true });

  onBeforeUnmount(() => {
    disposed = true;
    dispose();
  });

  return { enhance, dispose };
}
