import { enhanceMarkdown as enhanceShared, type MermaidLike } from '../core/markdown-client.js';
import { loadEcharts } from '../core/charts-loader';
import { resolveMessages, translate, type MarkdownLocale, type MarkdownMessages } from '../core/i18n';
import { applyTableAttrs, createElementTableRenderer, extractTable } from './table-renderer';

type Item = { host: HTMLElement; dispose(): void };

const states = new WeakMap<HTMLElement, Item[]>();

export interface EnhanceElementOptions {
  locale?: MarkdownLocale;
  messages?: Partial<MarkdownMessages>;
  theme?: 'dark' | 'light';
  readAsset?: (rel: string) => Promise<string>;
}

export function disposeElementMarkdown(container: HTMLElement): void {
  const items = states.get(container);
  if (!items) return;
  for (const item of items) {
    try {
      item.dispose();
    } catch {
      /* ignore */
    }
    if (item.host.isConnected) item.host.remove();
  }
  states.delete(container);
}

export async function enhanceElementMarkdown(
  container: HTMLElement,
  options: EnhanceElementOptions = {},
): Promise<void> {
  const prev = states.get(container);
  const rawTables = Array.from(container.querySelectorAll('table'))
    .filter((table) => !table.closest('.md-el-table, .el-table'));
  const rawMermaid = container.querySelector('pre.mermaid:not([data-processed="true"])');
  if (prev && prev.length && !rawTables.length && !rawMermaid) return;
  disposeElementMarkdown(container);
  const locale = options.locale || 'zh-CN';
  const messages = resolveMessages(locale, options.messages);
  const renderer = createElementTableRenderer(() => locale, () => messages);
  const items = await enhanceShared(container, {
    loadEcharts,
    loadFlowX6: () => import('../core/markdown-flowchart-x6.js'),
    loadMermaid: async () => (await import('mermaid')).default as unknown as MermaidLike,
    theme: options.theme === 'light' ? 'default' : 'dark',
    dark: options.theme !== 'light',
    errorText: (msg) => translate(messages, 'markdown.mermaid_error', { msg }),
    dataErrorText: (msg) => translate(messages, 'markdown.data_error', { msg }),
    readAsset: options.readAsset,
    enhanceTables: (root) => {
      const out: Item[] = [];
      for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table'))) {
        if (table.closest('.md-el-table, .el-table')) continue;
        if (table.parentElement?.closest('table')) continue;
        const data = extractTable(table);
        if (!data) continue;
        const host = document.createElement('div');
        host.className = 'md-el-table';
        applyTableAttrs(table, host);
        table.replaceWith(host);
        out.push({ host, ...renderer(host, data) });
      }
      return out;
    },
  });
  states.set(container, items as Item[]);
}
