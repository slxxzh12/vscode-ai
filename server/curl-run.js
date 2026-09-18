import { execFile } from 'node:child_process';

// 小工具「Postman」后端：把用户输入的 curl 命令解析成 argv 并执行（不经 shell，只允许 curl）
export const CURL_TIMEOUT_MS = 60_000;
export const CURL_MAX_OUTPUT = 4 * 1024 * 1024;

// 把一条 curl 命令切成 argv：支持单/双引号、反斜杠转义；不经过 shell，避免命令注入
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
        const nx = s[i + 1];
        if ('"\\$`'.includes(nx)) { cur += nx; i += 1; continue; }
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < s.length) { cur += s[i + 1]; i += 1; has = true; continue; }
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

export function runCurl(text, { timeoutMs = CURL_TIMEOUT_MS, cwd = process.cwd() } = {}) {
  const args = buildCurlArgs(text);
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
      resolve({
        ok: !err,
        code,
        error,
        timedOut: !!(err && err.killed),
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}
