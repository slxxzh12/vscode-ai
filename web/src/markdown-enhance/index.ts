import { enhanceMarkdown as enhanceShared, type MermaidLike } from '@devflow/shared/markdown-client';
import { t } from '../i18n';
import { loadEcharts } from './charts';
import { extractTable, mountTable } from './table';

type Item = { host: HTMLElement; dispose(): void };
type State = { items: Item[] };

const states = new WeakMap<HTMLElement, State>();

export function disposeMarkdown(container: HTMLElement): void {
  const prev = states.get(container);
  if (!prev) return;
  for (const item of prev.items) {
    try {
      item.dispose();
    } catch {
      /* ignore */
    }
    if (item.host.isConnected) item.host.remove();
  }
  states.delete(container);
}

export async function enhanceMarkdown(
  container: HTMLElement,
  opts: { readAsset?: (rel: string) => Promise<string> } = {},
): Promise<void> {
  // 同一份 DOM 重复调用时直接跳过，避免把已增强的 Element Plus 表格再处理一次（多表头/表格消失）
  const prev = states.get(container);
  const rawTables = Array.from(container.querySelectorAll('table'))
    .filter((table) => !table.closest('.md-el-table, .el-table'));
  const rawMermaid = container.querySelector('pre.mermaid:not([data-processed="true"])');
  if (prev && prev.items.length && !rawTables.length && !rawMermaid) return;

  disposeMarkdown(container);
  const state: State = { items: [] };
  states.set(container, state);

  const items = await enhanceShared(container, {
    loadEcharts,
    loadFlowX6: () => import('@devflow/shared/markdown-flowchart-x6'),
    loadMermaid: async () => (await import('mermaid')).default as unknown as MermaidLike,
    theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark',
    errorText: (msg) => t('markdown.mermaid_error', { msg }),
    dataErrorText: (msg) => t('markdown.data_error', { msg }),
    readAsset: opts.readAsset,
    enhanceTables: (root) => {
      const out: Item[] = [];
      for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table'))) {
        // 已经增强过的 Element Plus 表格内部也有 <table>，重复 enhance 时不能再包一层（会出现两个表头）
        if (table.closest('.md-el-table, .el-table')) continue;
        const data = extractTable(table);
        if (!data) continue;
        const host = document.createElement('div');
        host.className = 'md-el-table';
        const width = table.getAttribute('data-md-table-width');
        if (width) host.style.setProperty('--md-table-width', width);
        table.replaceWith(host);
        out.push({ host, ...mountTable(host, data) });
      }
      return out;
    },
  });
  state.items.push(...items);
}
