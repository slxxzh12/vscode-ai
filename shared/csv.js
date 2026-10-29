// RFC4180 解析：支持 BOM、CRLF/LF、引号内逗号/换行、"" 转义；忽略尾部空行。
export function parseCsv(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const all = [];
  let row = [];
  let field = '';
  let quoted = false;
  const pushField = () => { row.push(field); field = ''; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { pushField(); continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      pushField();
      all.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length) { pushField(); all.push(row); }
  const rows = all.filter((r) => !(r.length === 1 && r[0] === ''));
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const headers = (rows[0] || []).slice();
  while (headers.length < maxCols) headers.push('');
  const data = rows.slice(1).map((r) => {
    const out = r.slice();
    while (out.length < maxCols) out.push('');
    return out;
  });
  return { headers, rows: data };
}
