// 静态页轻量表格增强：点击表头排序（编辑器预览用 Element Plus 表格）。
export function enhanceSimpleTables(container) {
  const tables = Array.from(container.querySelectorAll('table.md-table'));
  for (const table of tables) {
    if (table.dataset.dfSortable === '1') continue;
    const head = table.tHead && table.tHead.rows[0];
    const body = table.tBodies && table.tBodies[0];
    if (!head || !body || !head.cells.length) continue;
    table.dataset.dfSortable = '1';
    Array.from(head.cells).forEach((th, idx) => {
      th.classList.add('df-sortable');
      th.dataset.dfSort = 'none';
      th.addEventListener('click', () => {
        const dir = th.dataset.dfSort === 'asc' ? -1 : 1;
        Array.from(head.cells).forEach((cell) => {
          cell.dataset.dfSort = 'none';
          cell.classList.remove('df-sort-asc', 'df-sort-desc');
        });
        th.dataset.dfSort = dir === 1 ? 'asc' : 'desc';
        th.classList.add(dir === 1 ? 'df-sort-asc' : 'df-sort-desc');
        const rows = Array.from(body.rows);
        rows.sort((a, b) => {
          const av = (a.cells[idx] && a.cells[idx].textContent || '').trim();
          const bv = (b.cells[idx] && b.cells[idx].textContent || '').trim();
          const an = Number(av);
          const bn = Number(bv);
          const cmp = Number.isFinite(an) && Number.isFinite(bn)
            ? an - bn
            : av.localeCompare(bv, 'zh-CN', { numeric: true });
          return cmp * dir;
        });
        rows.forEach((row) => body.appendChild(row));
      });
    });
  }
}
