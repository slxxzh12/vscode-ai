import { groupMermaidSides, renderMermaid } from '../markdown';
import { parseMermaidChart, renderChart, type ChartHandle } from './charts';
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

export async function enhanceMarkdown(container: HTMLElement): Promise<void> {
  // 同一份 DOM 重复调用时直接跳过，避免把已增强的 Element Plus 表格再处理一次（多表头/表格消失）
  const prev = states.get(container);
  const rawTables = Array.from(container.querySelectorAll('table'))
    .filter((table) => !table.closest('.md-el-table, .el-table'));
  const rawMermaid = container.querySelector('pre.mermaid:not([data-processed="true"])');
  if (prev && prev.items.length && !rawTables.length && !rawMermaid) return;

  disposeMarkdown(container);
  const state: State = { items: [] };
  states.set(container, state);

  // 先按 ```mermaid row 分组，再转换 xychart/pie，保证并排容器里的图表也留在同一行
  groupMermaidSides(container);

  for (const table of Array.from(container.querySelectorAll<HTMLTableElement>('table'))) {
    // 已经增强过的 Element Plus 表格内部也有 <table>，重复 enhance 时不能再包一层（会出现两个表头）
    if (table.closest('.md-el-table, .el-table')) continue;
    const data = extractTable(table);
    if (!data) continue;
    const host = document.createElement('div');
    host.className = 'md-el-table';
    table.replaceWith(host);
    state.items.push({ host, ...mountTable(host, data) });
  }

  for (const pre of Array.from(container.querySelectorAll<HTMLElement>('pre.mermaid'))) {
    const spec = parseMermaidChart(pre.textContent || '');
    if (!spec) continue;
    const host = document.createElement('div');
    host.className = 'md-echart';
    pre.before(host);
    try {
      const chart: ChartHandle = await renderChart(host, spec);
      pre.remove();
      state.items.push({ host, ...chart });
    } catch {
      host.remove();
    }
  }

  await renderMermaid(container);
}
