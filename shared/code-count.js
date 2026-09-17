// 源码行数统计的纯函数：不依赖 fs，也不依赖调用方所在目录。
// 被 server（/api 代码统计）与 scripts/count-code.js（CLI）共用，
// 因此必须放在 shared/ 内，随打包一起进入 @devflow/shared。

export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'line') {
      if (c === '\n') { out += c; state = 'code'; } else out += ' ';
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { out += '  '; i += 2; state = 'code'; }
      else { out += c === '\n' ? c : ' '; i++; }
      continue;
    }
    if (state === 'html') {
      if (c === '-' && c2 === '>') { out += '  '; i += 2; state = 'code'; }
      else { out += c === '\n' ? c : ' '; i++; }
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') { out += c2 ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
    if (c === '<' && src.startsWith('<!--', i)) { state = 'html'; out += '    '; i += 4; continue; }
    out += c;
    i++;
  }
  return out;
}

export function countReal(src) {
  const lines = stripComments(src).split(/\r?\n/);
  let total = 0;
  let real = 0;
  for (const line of lines) {
    total++;
    const t = line.trim();
    if (!t) continue;
    if (/^[{}\[\]();,]+$/.test(t)) continue;
    if (!/[A-Za-z]/.test(t)) continue;
    real++;
  }
  return { total, real };
}
