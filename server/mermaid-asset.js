import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 静态站点的 Markdown 页面用它按相对路径引用脚本；serveStatic 拦截该文件名直出
export const MERMAID_SCRIPT_NAME = '__devflow_mermaid__.js';
// Web / 静态页面共用的 Mermaid 增强代码（分组 + 渲染），也由 serveStatic 直出
export const MARKDOWN_CLIENT_SCRIPT_NAME = '__devflow_markdown__.js';

let cached = null;
let clientCached = null;
let clientMtime = 0;

function resolveMermaidScript() {
  const vendor = path.join(HERE, 'vendor', 'mermaid.min.js');
  if (fs.existsSync(vendor)) return vendor;
  const require = createRequire(import.meta.url);
  return require.resolve('mermaid/dist/mermaid.min.js');
}

export function readMermaidScript() {
  if (!cached) cached = fs.readFileSync(resolveMermaidScript());
  return cached;
}

export function readMarkdownClientScript() {
  const require = createRequire(import.meta.url);
  const sharedDir = path.dirname(require.resolve('@devflow/shared'));
  const file = path.join(sharedDir, 'markdown-client.js');
  const mtime = fs.statSync(file).mtimeMs;
  if (!clientCached || mtime !== clientMtime) {
    clientMtime = mtime;
    clientCached = fs.readFileSync(file);
  }
  return clientCached;
}
