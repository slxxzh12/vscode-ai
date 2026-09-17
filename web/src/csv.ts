export type CsvValue = string | number | null | undefined;

// Excel/表格会把以 = + - @ 开头的单元格当公式执行 → 前置单引号强制为文本
const RISKY_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(v: CsvValue): string {
  let s = v == null ? '' : String(v);
  if (RISKY_PREFIX.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// RFC4180 风格：UTF-8 BOM（Excel 中文不乱码）+ CRLF 换行
export function toCsv(header: CsvValue[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

export function zipStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export async function downloadZip(zipName: string, files: { name: string; content: string }[]): Promise<void> {
  const res = await fetch('/api/export/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zipName, files }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch { /* keep status */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
