import { computed, createApp, defineComponent, h, type PropType } from 'vue';
import { ElTable, ElTableColumn } from 'element-plus';

export type TableData = { headers: string[]; rows: string[][] };

function isPlainCell(node: Element): node is HTMLTableCellElement {
  const tag = node.tagName;
  if (tag !== 'TH' && tag !== 'TD') return false;
  const cell = node as HTMLTableCellElement;
  return cell.rowSpan <= 1 && cell.colSpan <= 1;
}

function cellText(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').trim();
}

function filterOptions(rows: string[][], col: number): Array<{ text: string; value: string }> {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const value = row[col] ?? '';
    if (!seen.has(value)) seen.set(value, cellText(value) || '—');
    if (seen.size > 200) return [];
  }
  if (seen.size > 50) return [];
  return [...seen.entries()].map(([value, text]) => ({ text, value }));
}

function compareCells(a: string, b: string): number {
  const sa = cellText(a);
  const sb = cellText(b);
  const na = Number(sa.replace(/,/g, ''));
  const nb = Number(sb.replace(/,/g, ''));
  if (sa && sb && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

export function extractTable(table: HTMLTableElement): TableData | null {
  if (table.querySelector('table')) return null;
  const headRow = table.querySelector('thead tr');
  if (!headRow) return null;
  const cells = Array.from(headRow.children);
  if (!cells.length || !cells.every(isPlainCell)) return null;
  const headers = cells.map((c) => c.innerHTML.trim());

  const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
  if (!bodyRows.length) return null;
  const rows: string[][] = [];
  for (const tr of bodyRows) {
    const tds = Array.from(tr.children);
    if (tds.length !== headers.length || !tds.every(isPlainCell)) return null;
    rows.push(tds.map((c) => c.innerHTML.trim()));
  }
  return { headers, rows };
}

const TableHost = defineComponent({
  props: {
    headers: { type: Array as PropType<string[]>, required: true },
    rows: { type: Array as PropType<string[][]>, required: true },
  },
  setup(props) {
    const data = computed(() =>
      props.rows.map((cells) => {
        const obj: Record<string, string> = {};
        cells.forEach((cell, i) => {
          obj[`c${i}`] = cell;
        });
        return obj;
      }),
    );
    const filters = computed(() => props.headers.map((_, i) => filterOptions(props.rows, i)));
    return () =>
      h(
        ElTable,
        { data: data.value, border: true, stripe: true, size: 'small', maxHeight: 420 },
        () =>
          props.headers.map((label, i) => {
            const opts = filters.value[i];
            return h(
              ElTableColumn,
              {
                key: i,
                prop: `c${i}`,
                showOverflowTooltip: true,
                sortable: true,
                sortMethod: (a: Record<string, string>, b: Record<string, string>) =>
                  compareCells(a[`c${i}`] ?? '', b[`c${i}`] ?? ''),
                filters: opts.length ? opts : undefined,
                filterMethod: opts.length
                  ? (value: string, row: Record<string, string>) => row[`c${i}`] === value
                  : undefined,
                filterPlacement: 'bottom-end',
              },
              {
                header: () => h('span', { innerHTML: label }),
                default: ({ row }: { row: Record<string, string> }) =>
                  h('span', { innerHTML: row[`c${i}`] ?? '' }),
              },
            );
          }),
      );
  },
});

export function mountTable(host: HTMLElement, data: TableData): { dispose(): void } {
  const app = createApp(TableHost, data);
  app.mount(host);
  return { dispose: () => app.unmount() };
}
