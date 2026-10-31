import { execFile } from 'node:child_process';

// 小工具「Postman」后端：把用户输入的 curl 命令解析成 argv 并执行（不经 shell，只允许 curl）
export const CURL_TIMEOUT_MS = 60_000;
export const CURL_MAX_OUTPUT = 4 * 1024 * 1024;

// 反斜杠 + 换行是 shell 续行（Chrome「Copy as cURL」就是这种写法），应整段吞掉而不是当作参数
function lineSpliceLen(s, i) {
  const nx = s[i + 1];
  if (nx === '\n') return 2;
  if (nx === '\r') return s[i + 2] === '\n' ? 3 : 2;
  return 0;
}

// 把一条 curl 命令切成 argv：支持单/双引号、反斜杠转义与续行；不经过 shell，避免命令注入
export function tokenizeCurl(text) {
  const s = String(text ?? '');
  const args = [];
  let cur = '';
  let quote = null;
  let has = false;
  const push = () => { if (has) { args.push(cur); cur = ''; has = false; } };
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (quote === '"' && ch === '\\' && i + 1 < s.length) {
        const splice = lineSpliceLen(s, i);
        if (splice) { i += splice - 1; continue; }
        const nx = s[i + 1];
        if ('"\\$`'.includes(nx)) { cur += nx; i += 1; continue; }
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < s.length) {
      const splice = lineSpliceLen(s, i);
      if (splice) { i += splice - 1; continue; }
      cur += s[i + 1]; i += 1; has = true; continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { push(); continue; }
    cur += ch;
    has = true;
  }
  if (quote) { const e = new Error('unbalanced quote'); e.code = 'unbalanced-quote'; throw e; }
  push();
  return args;
}

function isCurlWord(word) {
  const w = String(word || '').toLowerCase().replace(/\\/g, '/');
  return w === 'curl' || w === 'curl.exe' || w.endsWith('/curl') || w.endsWith('/curl.exe');
}

// 允许三种写法：`curl ...`、`curl.exe ...`、或直接 `-X POST ...`（自动补 curl）
export function buildCurlArgs(text) {
  const tokens = tokenizeCurl(text);
  if (!tokens.length) { const e = new Error('empty command'); e.code = 'empty'; throw e; }
  if (isCurlWord(tokens[0])) return tokens.slice(1);
  if (tokens[0].startsWith('-')) return tokens;
  const e = new Error('only curl commands are supported');
  e.code = 'not-curl';
  throw e;
}

// 把 curl 输出拆成「响应头 / 响应体 / 状态码」：-D - 会把响应头打到 stdout（可能因重定向出现多段），
// 逐段吞掉以 HTTP/ 开头的头部块，最后一段的状态行即最终状态码，其余为响应体。
export function splitResponse(text) {
  const statusRe = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/;
  let rest = String(text ?? '');
  let headers = '';
  let status = 0;
  for (;;) {
    const start = rest.replace(/^[\r\n]+/, '');
    const m = statusRe.exec(start);
    if (!m) break;
    status = Number(m[1]);
    const crlf = start.indexOf('\r\n\r\n');
    const lf = start.indexOf('\n\n');
    let end;
    if (crlf >= 0 && (lf < 0 || crlf < lf)) end = crlf + 4;
    else if (lf >= 0) end = lf + 2;
    else end = start.length;
    headers += start.slice(0, end);
    if (end >= start.length) { rest = ''; break; }
    rest = start.slice(end);
  }
  return { status, headers: headers.trimEnd(), body: rest };
}

// 补上运行时才需要的参数：-s -S 去掉进度条但保留报错，-D - 把响应头一并带出（用户已给则不覆盖）
function extraArgs(argv) {
  const long = (n) => argv.includes(n);
  const shortHas = (ch) => argv.some((a) => /^-[A-Za-z]+$/.test(a) && a.slice(1).includes(ch));
  const extra = [];
  if (!long('--silent') && !long('--verbose') && !shortHas('s') && !shortHas('v')) extra.push('-s', '-S');
  if (!long('--dump-header') && !argv.some((a) => a.startsWith('--dump-header=')) && !shortHas('D')) extra.push('-D', '-');
  return extra;
}

export function runCurl(text, { timeoutMs = CURL_TIMEOUT_MS, cwd = process.cwd() } = {}) {
  const base = buildCurlArgs(text);
  const args = [...base, ...extraArgs(base)];
  return new Promise((resolve) => {
    execFile('curl', args, { timeout: timeoutMs, maxBuffer: CURL_MAX_OUTPUT, windowsHide: true, cwd }, (err, stdout, stderr) => {
      let code = 0;
      let error = '';
      if (err) {
        if (typeof err.code === 'number') code = err.code;
        else if (err.code === 'ENOENT') { code = -1; error = 'curl-not-found'; }
        else if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') { code = -1; error = 'output-too-large'; }
        else { code = -1; error = String(err.code || err.message); }
      }
      const { status, headers, body } = splitResponse(stdout);
      resolve({
        ok: !err,
        code,
        error,
        timedOut: !!(err && err.killed),
        status,
        headers,
        body,
        stdout: body,
        stderr: String(stderr ?? ''),
      });
    });
  });
}
