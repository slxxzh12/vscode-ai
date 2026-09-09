// 从文本中解析第一条 curl 命令 → 结构化 HTTP 请求（方法/URL/请求头/请求体）。

export interface CurlRequest {
  method: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
  body: string;
  raw: string;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
    i += 1;
  }
  if (cur) out.push(cur);
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseCurl(text: string): CurlRequest | null {
  const idx = text.search(/curl[\s"'`]/);
  if (idx < 0) return null;
  // 截到 curl 之后的命令（处理跨行反斜杠续行）
  const after = text.slice(idx + 4);
  const joined = after.replace(/\\[\r\n]+/g, ' ');
  const tokens = tokenize(joined).map(stripQuotes);
  let url = '';
  let method = '';
  const headers: Array<{ name: string; value: string }> = [];
  const bodyParts: string[] = [];
  let skipNext = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (skipNext) { skipNext = false; continue; }
    if (t === '-X' || t === '--request' || t === '--method') { method = tokens[++i] || method; continue; }
    if (t.startsWith('-X') && t.length > 2) { method = t.slice(2); continue; }
    if (t === '-H' || t === '--header') {
      const h = tokens[++i];
      if (h) {
        const c = h.indexOf(':');
        if (c > 0) headers.push({ name: h.slice(0, c).trim(), value: h.slice(c + 1).trim() });
      }
      continue;
    }
    if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
      const d = tokens[++i];
      if (d && !d.startsWith('@')) bodyParts.push(d);
      continue;
    }
    if (t.startsWith('-d@') || t.startsWith('--data-raw@')) continue; // 文件读取场景略过
    if (t.startsWith('-') || t === '--') continue; // 其余参数忽略
    if (!url) url = t;
  }

  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  if (!method) method = bodyParts.length ? 'POST' : 'GET';
  const body = bodyParts.join('&');
  if (body && !headers.some((h) => h.name.toLowerCase() === 'content-type') && bodyParts.length > 1) {
    headers.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' });
  }
  return { method: method.toUpperCase(), url, headers, body, raw: text.slice(idx, idx + 200).trim() };
}
