import { computed, createApp, defineComponent, h, type PropType } from 'vue';
import { ElTable, ElTableColumn } from 'element-plus';

export type TableData = { headers: string[]; rows: string[][] };

function isPlainCell(node: Element): node is HTMLTableCellElement {
  const tag = node.tagName;
  if (tag !== 'TH' && tag !== 'TD') return false;
  const cell = node as HTMLTableCellElement;
  return cell.rowSpan <= 1 && cell.colSpan <= 1;
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
    return () =>
      h(
        ElTable,
        { data: data.value, border: true, stripe: true, size: 'small', maxHeight: 420 },
        () =>
          props.headers.map((label, i) =>
            h(
              ElTableColumn,
              { key: i, prop: `c${i}`, showOverflowTooltip: true },
              {
                header: () => h('span', { innerHTML: label }),
                default: ({ row }: { row: Record<string, string> }) =>
                  h('span', { innerHTML: row[`c${i}`] ?? '' }),
              },
            ),
          ),
      );
  },
});

export function mountTable(host: HTMLElement, data: TableData): { dispose(): void } {
  const app = createApp(TableHost, data);
  app.mount(host);
  return { dispose: () => app.unmount() };
}
