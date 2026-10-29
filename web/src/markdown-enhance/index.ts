import { renderMermaid } from '../markdown';
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
  disposeMarkdown(container);
  const state: State = { items: [] };
  states.set(container, state);

  for (const table of Array.from(container.querySelectorAll<HTMLTableElement>('table'))) {
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
