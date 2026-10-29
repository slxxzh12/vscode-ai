import { parseCsv } from '@devflow/shared/csv';
import { escapeHtml } from '@devflow/shared/markdown';
import { t } from './i18n.js';
import { PAGE_THEME_CSS } from './markdown-page.js';

const CSV_CSS = `
.csv-page { max-width: 100%; margin: 0 auto; padding: 18px 22px 60px; box-sizing: border-box; }
.csv-summary { color: var(--tx2); font-size: 12px; margin: 0 0 10px; }
.csv-wrap { overflow: auto; border: 1px solid var(--bd); border-radius: 6px; max-height: calc(100vh - 130px); }
.csv-table { width: 100%; border-collapse: collapse; font: 13px/1.5 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; color: var(--tx); }
.csv-table th, .csv-table td { border-bottom: 1px solid var(--bd); border-right: 1px solid var(--bd); padding: 6px 10px; text-align: left; vertical-align: top; white-space: nowrap; }
.csv-table th { position: sticky; top: 0; z-index: 1; background: linear-gradient(180deg, var(--bg5), var(--bg4)); color: var(--tx1); font-weight: 600; border-bottom: 2px solid var(--ac2); }
.csv-table tr:nth-child(2n) td { background: var(--bg2); }
.csv-table tbody tr:hover td { background: var(--bg3); }
.csv-table tr:last-child td { border-bottom: none; }
.csv-table th:last-child, .csv-table td:last-child { border-right: none; }
.csv-empty { color: var(--tx2); padding: 24px; text-align: center; }
`;

export function isCsvFile(name) {
  return /\.csv$/i.test(String(name || ''));
}

export function renderCsvDocument(text, title, extraHtml = '') {
  const { headers, rows } = parseCsv(text);
  const cols = headers.length;
  const summary = t('fp.csv.summary', { rows: rows.length, cols });
  let table = '';
  if (cols) {
    const head = headers
      .map((h, i) => `<th>${escapeHtml(h || `${t('fp.csv.column')} ${i + 1}`)}</th>`)
      .join('');
    const body = rows
      .map((r) => `<tr>${headers.map((_, i) => `<td>${escapeHtml(r[i] ?? '')}</td>`).join('')}</tr>`)
      .join('');
    table = `<div class="csv-wrap"><table class="csv-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  } else {
    table = `<div class="csv-empty">${escapeHtml(t('fp.csv.empty'))}</div>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${PAGE_THEME_CSS}${CSV_CSS}</style></head><body><main class="csv-page"><div class="csv-summary">${escapeHtml(summary)}</div>${table}</main>${extraHtml}</body></html>`;
}
